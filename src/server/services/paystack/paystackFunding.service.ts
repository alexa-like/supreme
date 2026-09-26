/**
 * Alexvya Platform — Paystack Wallet Funding & Payment Lifecycle Service
 * Stage 2.6 Paystack Wallet Funding & Payment Lifecycle
 * 
 * CORE ARCHITECTURAL INVARIANTS:
 * 1. Paystack secret is SERVER ONLY.
 * 2. Paystack API calls happen OUTSIDE Firestore transactions.
 * 3. Browser redirect is NEVER authoritative.
 * 4. Server-side verification is mandatory before wallet credit.
 * 5. Single atomic settlement: Exactly one CREDIT ledger entry, one version increment, no VAS profit.
 * 6. Concurrency lock on payment reference prevents duplicate settlement between redirect and webhook.
 * 7. Rate limit: WALLET_FUNDING_INIT (10/hr).
 * 8. Validation: Integer kobo >= 5,000 (₦50), <= 5,000,000 (₦50,000), wallet capacity <= 1,000,000,000 (₦10,000,000).
 */

import crypto, { randomUUID } from 'crypto';
import { getPaystackClient, PaystackVerifyResponse } from './paystack.adapter.ts';
import { getUserById } from '../../repositories/users.repository.ts';
import { ensureWallet, getWalletByUserId } from '../../repositories/wallets.repository.ts';
import {
  createPaymentAttempt,
  getPaymentAttemptById,
  getPaymentAttemptByReference,
  updatePaymentAttempt,
} from '../../repositories/paymentAttempts.repository.ts';
import {
  createTransaction,
  getTransactionById,
  getTransactionByReference,
  updateTransaction,
} from '../../repositories/transactions.repository.ts';
import {
  createWebhookEvent,
  getWebhookEventById,
  updateWebhookEvent,
} from '../../repositories/webhookEvents.repository.ts';
import { createNotification } from '../../repositories/notifications.repository.ts';
import { NotificationService } from '../notifications/notification.service.ts';
import { creditWallet } from '../../wallet/mutation.service.ts';
import {
  acquireIdempotencyLease,
  completeIdempotencyRecord as completeIdempotency,
  failIdempotencyRecord as failIdempotency,
} from '../idempotency.service.ts';
import { recordAuditEvent } from '../../security/audit.ts';
import { rateLimiter, RATE_LIMIT_CONFIGS } from '../../security/rateLimiter.ts';
import {
  UserRole,
  AccountStatus,
  TransactionType,
  TransactionStatus,
  PaymentGateway,
  PaymentAttemptStatus,
  PaymentChannel,
  VerificationSource,
  LedgerCategory,
  NotificationCategory,
  AuditAction,
  ProviderId,
  WebhookProcessingStatus,
} from '../../../types/enums.ts';

import { IntegerKobo, MONEY_CONSTANTS, isSafeKobo } from '../../../types/money.ts';
import { PaymentAttemptDocument, TransactionDocument } from '../../../types/firestore.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';
import { logger } from '../../../lib/logger/logger.ts';

// Configurable funding limits (Stage 1.4 & 2.6)
export const FUNDING_LIMITS = {
  MIN_AMOUNT_KOBO: 5000 as IntegerKobo, // ₦50.00
  MAX_SINGLE_INIT_KOBO: 5000000 as IntegerKobo, // ₦50,000.00
  MAX_WALLET_BALANCE_KOBO: 1000000000 as IntegerKobo, // ₦10,000,000.00
};

// Settlement Async Mutex to prevent race conditions between redirect and webhook
class SettlementMutex {
  private activeLocks = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const currentPromise = this.activeLocks.get(key) || Promise.resolve();
    let release: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.activeLocks.set(key, nextPromise);

    try {
      await currentPromise;
      return await fn();
    } finally {
      release!();
      if (this.activeLocks.get(key) === nextPromise) {
        this.activeLocks.delete(key);
      }
    }
  }

  clear(): void {
    this.activeLocks.clear();
  }
}

const settlementMutex = new SettlementMutex();

export function resetSettlementMutexes(): void {
  settlementMutex.clear();
}

export interface InitializeFundingParams {
  userId: string;
  amountKobo: IntegerKobo;
  idempotencyKey?: string;
  ipAddress?: string;
  callbackUrl?: string;
  correlationId?: string;
}

export interface InitializeFundingResult {
  authorization_url: string;
  access_code: string;
  reference: string;
  amount_kobo: IntegerKobo;
  currency: 'NGN';
  status: 'PENDING';
  isIdempotentReplay?: boolean;
}

export interface SettleFundingParams {
  reference: string;
  userId?: string; // If provided, strictly checks customer ownership
  verificationSource: VerificationSource;
  correlationId?: string;
}

export interface SettleFundingResult {
  status: 'SUCCESSFUL' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  amount_kobo: IntegerKobo;
  reference: string;
  transaction_id: string;
  verified_at?: string;
  isIdempotentReplay?: boolean;
  message?: string;
}

/**
 * Normalizes payment channel string to domain enum.
 */
function normalizeChannel(channelStr?: string | null): PaymentChannel {
  if (!channelStr) return PaymentChannel.CARD;
  const upper = channelStr.toUpperCase();
  if (upper.includes('TRANSFER') || upper.includes('BANK')) return PaymentChannel.BANK_TRANSFER;
  if (upper.includes('USSD')) return PaymentChannel.USSD;
  if (upper.includes('QR')) return PaymentChannel.QR;
  return PaymentChannel.CARD;
}

/**
 * 1. Initialize Paystack Wallet Funding
 */
export async function initializeWalletFunding(
  params: InitializeFundingParams
): Promise<InitializeFundingResult> {
  const { userId, amountKobo, idempotencyKey, ipAddress, callbackUrl, correlationId } = params;

  // 1. Amount Validation
  if (
    typeof amountKobo !== 'number' ||
    !Number.isInteger(amountKobo) ||
    !Number.isFinite(amountKobo) ||
    isNaN(amountKobo) ||
    amountKobo <= 0 ||
    !isSafeKobo(amountKobo)
  ) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Funding amount must be a safe, positive integer in kobo',
      400
    );
  }

  if (amountKobo < FUNDING_LIMITS.MIN_AMOUNT_KOBO) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      `Minimum funding amount is ₦${FUNDING_LIMITS.MIN_AMOUNT_KOBO / 100} (${FUNDING_LIMITS.MIN_AMOUNT_KOBO} kobo)`,
      400
    );
  }

  if (amountKobo > FUNDING_LIMITS.MAX_SINGLE_INIT_KOBO) {
    throw new AlexvyaApiError(
      ErrorCodes.DAILY_LIMIT_EXCEEDED,
      `Single funding limit exceeded. Maximum is ₦${FUNDING_LIMITS.MAX_SINGLE_INIT_KOBO / 100} (${FUNDING_LIMITS.MAX_SINGLE_INIT_KOBO} kobo)`,
      400
    );
  }

  // 2. User & Account Status Verification
  const user = await getUserById(userId);
  if (!user) {
    throw new AlexvyaApiError(ErrorCodes.USER_NOT_FOUND, 'User account not found', 404);
  }

  if (user.account_status === AccountStatus.SUSPENDED) {
    throw new AlexvyaApiError(ErrorCodes.ACCOUNT_SUSPENDED, 'Account is suspended', 403);
  }
  if (user.account_status === AccountStatus.FROZEN) {
    throw new AlexvyaApiError(ErrorCodes.ACCOUNT_FROZEN, 'Account is frozen', 403);
  }
  if (user.account_status === AccountStatus.CLOSED) {
    throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, 'Account is closed', 403);
  }

  if (!user.email_verified) {
    throw new AlexvyaApiError(
      ErrorCodes.EMAIL_NOT_VERIFIED,
      'Email verification is required before funding wallet',
      403
    );
  }

  // 3. Rate Limiting Check
  rateLimiter.enforce(userId, RATE_LIMIT_CONFIGS.WALLET_FUNDING_INIT, correlationId);


  // 4. Wallet State & Capacity Check
  const wallet = await ensureWallet(userId);
  const projectedBalance = wallet.available_balance_kobo + amountKobo;
  if (projectedBalance > FUNDING_LIMITS.MAX_WALLET_BALANCE_KOBO) {
    throw new AlexvyaApiError(
      ErrorCodes.MAX_BALANCE_EXCEEDED,
      `Funding would exceed maximum wallet limit of ₦${FUNDING_LIMITS.MAX_WALLET_BALANCE_KOBO / 100}`,
      400
    );
  }

  // 5. Idempotency Check & Lease Acquisition (72-hour TTL for funding initialization)
  const canonicalPayload = {
    amount_kobo: amountKobo,
    user_id: userId,
    email: user.email,
  };

  const idempResult = await acquireIdempotencyLease({
    key: idempotencyKey || `auto_${randomUUID()}`,
    userId,
    requestPath: '/api/v1/wallet/fund/initialize',
    requestPayload: canonicalPayload,
    retentionPolicy: 'PAYSTACK_FUNDING_INIT',
    correlationId,
  });

  if (idempResult.status === 'REPLAY') {
    logger.info(
      `[PaystackFunding] Idempotent replay for key: ${idempResult.key}`,
      undefined,
      correlationId
    );
    return {
      ...(idempResult.responseBody as unknown as InitializeFundingResult),
      isIdempotentReplay: true,
    };
  }

  // 6. Generate Internal Reference & Create Internal State
  const reference = `ALX-FUND-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const transactionId = `tx_${randomUUID()}`;
  const paymentAttemptId = `pa_${randomUUID()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 mins expiry

  // Internal Transaction Record
  const transactionDoc: TransactionDocument = {
    id: transactionId,
    reference,
    user_id: userId,
    user_email_snapshot: user.email,
    type: TransactionType.WALLET_FUNDING,
    status: TransactionStatus.INITIATED,
    currency: 'NGN',
    amount_kobo: amountKobo,
    fee_kobo: 0,
    discount_kobo: 0,
    total_charged_kobo: amountKobo,
    provider_cost_kobo: null,
    gross_profit_kobo: null,
    provider: ProviderId.PAYSTACK,
    provider_reference: reference,
    idempotency_key: idempResult.key,
    service_details: {
      channel: 'PAYSTACK_CHECKOUT',
      ip_address: ipAddress || null,
    },
    failure_reason: null,
    internal_error_code: null,
    created_at: now,
    completed_at: null,
  };
  await createTransaction(transactionDoc);

  // Internal Payment Attempt Record
  const paymentAttemptDoc: PaymentAttemptDocument = {
    id: paymentAttemptId,
    transaction_id: transactionId,
    transaction_reference: reference,
    user_id: userId,
    payment_gateway: PaymentGateway.PAYSTACK,
    gateway_reference: reference,
    amount_kobo: amountKobo,
    gateway_fee_kobo: 0,
    status: PaymentAttemptStatus.PENDING,
    authorization_url: null,
    access_code: null,
    channel: null,
    ip_address: ipAddress || null,
    verified_at: null,
    verification_source: null,
    created_at: now,
    expires_at: expiresAt,
  };
  await createPaymentAttempt(paymentAttemptDoc);

  // 7. Call Paystack API (OUTSIDE Firestore runTransaction)
  try {
    const paystackClient = getPaystackClient();
    const paystackRes = await paystackClient.initializeTransaction(
      {
        email: user.email,
        amountKobo,
        reference,
        callbackUrl,
        metadata: {
          user_id: userId,
          transaction_id: transactionId,
          payment_attempt_id: paymentAttemptId,
        },
      },
      correlationId
    );

    // 8. Update Payment Attempt with Authorization URL
    await updatePaymentAttempt(paymentAttemptId, {
      authorization_url: paystackRes.data.authorization_url,
      access_code: paystackRes.data.access_code,
    });

    const responseData: InitializeFundingResult = {
      authorization_url: paystackRes.data.authorization_url,
      access_code: paystackRes.data.access_code,
      reference,
      amount_kobo: amountKobo,
      currency: 'NGN',
      status: 'PENDING',
    };

    // 9. Complete Idempotency Lease
    await completeIdempotency({
      key: idempResult.key,
      userId,
      responseCode: 200,
      responseBody: responseData as any,
      referenceId: reference,
      referenceType: 'PAYMENT_REFERENCE',
      correlationId,
    });

    // 10. Record Audit Event
    await recordAuditEvent({
      actorId: userId,
      actorRole: UserRole.CUSTOMER,
      action: AuditAction.WALLET_ADJUSTMENT,
      targetId: paymentAttemptId,
      targetCollection: 'paymentAttempts',
      afterData: {
        reference,
        amount_kobo: amountKobo,
        gateway: 'PAYSTACK',
      },
      ipAddress,
      correlationId: correlationId || 'unknown_correlation_id',
    });


    return responseData;
  } catch (err: any) {
    const isTimeoutOrAmbiguous =
      err instanceof AlexvyaApiError &&
      (err.code === ErrorCodes.PAYMENT_GATEWAY_TIMEOUT ||
        err.code === ErrorCodes.TRANSACTION_UNKNOWN ||
        err.statusCode === 504);

    const paymentAttemptStatus = isTimeoutOrAmbiguous
      ? PaymentAttemptStatus.PENDING
      : PaymentAttemptStatus.FAILED;

    const transactionStatus = isTimeoutOrAmbiguous
      ? TransactionStatus.UNKNOWN
      : TransactionStatus.FAILED;

    // Paystack initialization failed: update records, release idempotency if safe, throw
    await updatePaymentAttempt(paymentAttemptId, {
      status: paymentAttemptStatus,
    });
    await updateTransaction(transactionId, {
      status: transactionStatus,
      failure_reason: err.message,
    });
    await failIdempotency({
      key: idempResult.key,
      userId,
      error: err,
      allowImmediateRetry: !isTimeoutOrAmbiguous,
      correlationId,
    });
    throw err;
  }

}

/**
 * 2. Authoritatively Verify and Settle Paystack Wallet Funding
 * Thread-safe: Acquires mutex on `reference` to prevent race conditions between redirect and webhook.
 */
export async function verifyAndSettleWalletFunding(
  params: SettleFundingParams
): Promise<SettleFundingResult> {
  const { reference, userId, verificationSource, correlationId } = params;

  if (!reference || typeof reference !== 'string' || reference.trim() === '') {
    throw new AlexvyaApiError(ErrorCodes.INVALID_INPUT, 'Valid payment reference is required', 400);
  }

  return settlementMutex.runExclusive(reference, async () => {
    // 1. Locate Internal Payment Attempt
    let paymentAttempt = await getPaymentAttemptByReference(reference);
    if (!paymentAttempt) {
      // Try by ID fallback
      paymentAttempt = await getPaymentAttemptById(reference);
    }

    if (!paymentAttempt) {
      throw new AlexvyaApiError(
        ErrorCodes.RESOURCE_NOT_FOUND,
        `Payment attempt not found for reference: ${reference}`,
        404
      );
    }

    // 2. Ownership Verification (IDOR Defense)
    if (userId && paymentAttempt.user_id !== userId) {
      throw new AlexvyaApiError(
        ErrorCodes.FORBIDDEN,
        'Access denied: payment attempt belongs to another customer',
        403
      );
    }

    // 3. If already SUCCESSFUL, return existing settled state idempotently (Zero double credit)
    if (paymentAttempt.status === PaymentAttemptStatus.SUCCESSFUL) {
      logger.info(
        `[PaystackFunding] Payment ${reference} is already settled. Returning cached successful state.`,
        undefined,
        correlationId
      );
      return {
        status: 'SUCCESSFUL',
        amount_kobo: paymentAttempt.amount_kobo,
        reference: paymentAttempt.gateway_reference,
        transaction_id: paymentAttempt.transaction_id,
        verified_at: paymentAttempt.verified_at || undefined,
        isIdempotentReplay: true,
        message: 'Payment already verified and settled successfully',
      };
    }

    // 4. Call Paystack Server-Side Verification Endpoint
    const paystackClient = getPaystackClient();
    let verifyRes: PaystackVerifyResponse;
    try {
      verifyRes = await paystackClient.verifyTransaction(paymentAttempt.gateway_reference, correlationId);
    } catch (err: any) {
      if (err.statusCode === 504 || err.code === ErrorCodes.PAYMENT_GATEWAY_TIMEOUT) {
        // Network timeout / Gateway unreachable: preserve PENDING / UNKNOWN state. DO NOT FAIL OR REFUND.
        logger.warn(
          `[PaystackFunding] Paystack verification timed out for ${reference}. Preserving PENDING state.`,
          undefined,
          correlationId
        );
        return {
          status: 'UNKNOWN',
          amount_kobo: paymentAttempt.amount_kobo,
          reference: paymentAttempt.gateway_reference,
          transaction_id: paymentAttempt.transaction_id,
          message: 'Payment status currently pending verification with payment provider. Please retry shortly.',
        };
      }
      throw err;
    }

    const verifyData = verifyRes.data;

    // 5. Validate Paystack Result
    // Check Status
    if (verifyData.status !== 'success') {
      logger.warn(
        `[PaystackFunding] Paystack returned non-success status '${verifyData.status}' for ${reference}`,
        undefined,
        correlationId
      );
      await updatePaymentAttempt(paymentAttempt.id, {
        status: PaymentAttemptStatus.FAILED,
        channel: normalizeChannel(verifyData.channel),
      });
      await updateTransaction(paymentAttempt.transaction_id, {
        status: TransactionStatus.FAILED,
        failure_reason: verifyData.gateway_response || 'Payment was not completed successfully',
      });
      return {
        status: 'FAILED',
        amount_kobo: paymentAttempt.amount_kobo,
        reference: paymentAttempt.gateway_reference,
        transaction_id: paymentAttempt.transaction_id,
        message: verifyData.gateway_response || 'Payment failed or abandoned',
      };
    }

    // Check Amount (Must match expected integer kobo exactly)
    if (verifyData.amount !== paymentAttempt.amount_kobo) {
      logger.error(
        `[PaystackFunding] CRITICAL: Amount mismatch on ${reference}! Expected: ${paymentAttempt.amount_kobo} kobo, Got: ${verifyData.amount} kobo`,
        undefined,
        correlationId
      );
      await updatePaymentAttempt(paymentAttempt.id, {
        status: PaymentAttemptStatus.FAILED,
      });
      await updateTransaction(paymentAttempt.transaction_id, {
        status: TransactionStatus.UNKNOWN,
        failure_reason: `Amount mismatch: expected ${paymentAttempt.amount_kobo}, verified ${verifyData.amount}`,
      });
      await recordAuditEvent({
        actorId: 'system',
        actorRole: 'SYSTEM',
        action: AuditAction.WALLET_ADJUSTMENT,
        targetId: paymentAttempt.id,
        targetCollection: 'paymentAttempts',
        afterData: {
          expected_kobo: paymentAttempt.amount_kobo,
          received_kobo: verifyData.amount,
          reference,
        },
        correlationId: correlationId || 'unknown_correlation_id',
      });
      throw new AlexvyaApiError(
        ErrorCodes.PAYMENT_AMOUNT_MISMATCH,
        'Payment amount does not match expected funding amount',
        400
      );
    }


    // Check Currency (Must be 'NGN')
    if (verifyData.currency !== 'NGN') {
      logger.error(
        `[PaystackFunding] CRITICAL: Currency mismatch on ${reference}! Expected: NGN, Got: ${verifyData.currency}`,
        undefined,
        correlationId
      );
      await updatePaymentAttempt(paymentAttempt.id, {
        status: PaymentAttemptStatus.FAILED,
      });
      await updateTransaction(paymentAttempt.transaction_id, {
        status: TransactionStatus.FAILED,
        failure_reason: `Currency mismatch: expected NGN, received ${verifyData.currency}`,
      });
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        `Invalid payment currency: ${verifyData.currency}. Expected NGN.`,
        400
      );
    }

    // Check Reference
    if (verifyData.reference !== paymentAttempt.gateway_reference) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'Payment reference mismatch between gateway and internal attempt',
        400
      );
    }

    // 6. Max Wallet Balance Safety Check Before Credit
    const currentWallet = await ensureWallet(paymentAttempt.user_id);
    if (currentWallet.available_balance_kobo + paymentAttempt.amount_kobo > FUNDING_LIMITS.MAX_WALLET_BALANCE_KOBO) {
      logger.error(
        `[PaystackFunding] Wallet cap exceeded for ${paymentAttempt.user_id} upon settlement. Moving to UNKNOWN for manual resolution.`,
        undefined,
        correlationId
      );
      await updateTransaction(paymentAttempt.transaction_id, {
        status: TransactionStatus.UNKNOWN,
        failure_reason: 'Wallet balance cap exceeded upon settlement',
      });
      throw new AlexvyaApiError(
        ErrorCodes.MAX_BALANCE_EXCEEDED,
        'Wallet capacity exceeded. Transaction placed in review.',
        400
      );
    }

    // 7. Atomic Wallet Credit via Mutation Engine
    // Actor is SYSTEM; idempotency key is tied to internal transaction reference
    const nowIso = new Date().toISOString();
    const mutationResult = await creditWallet({
      userId: paymentAttempt.user_id,
      amountKobo: paymentAttempt.amount_kobo,
      category: LedgerCategory.WALLET_FUNDING,
      description: `Paystack wallet funding (${paymentAttempt.gateway_reference})`,
      transactionId: paymentAttempt.transaction_id,
      transactionReference: paymentAttempt.transaction_reference,
      idempotencyKey: `settle_${paymentAttempt.transaction_id}`,
      actor: {
        type: 'SYSTEM',
        id: verificationSource === VerificationSource.WEBHOOK ? 'paystack_webhook' : 'paystack_verify',
      },
      correlationId,
    });

    // 8. Update Payment Attempt & Internal Transaction to SUCCESSFUL
    await updatePaymentAttempt(paymentAttempt.id, {
      status: PaymentAttemptStatus.SUCCESSFUL,
      gateway_fee_kobo: (verifyData.fees || 0) as IntegerKobo,
      channel: normalizeChannel(verifyData.channel),
      ip_address: verifyData.ip_address || paymentAttempt.ip_address,
      verified_at: nowIso,
      verification_source: verificationSource,
    });

    await updateTransaction(paymentAttempt.transaction_id, {
      status: TransactionStatus.SUCCESSFUL,
      completed_at: nowIso,
      service_details: {
        ...((await getTransactionById(paymentAttempt.transaction_id))?.service_details || {}),
        channel: verifyData.channel,
        gateway_fee_kobo: verifyData.fees || 0,
        paid_at: verifyData.paid_at,
        settlement_source: verificationSource,
      },
    });

    // 9. Dispatch Customer In-App & Email Notification via Unified Notification Service (Failure isolated)
    try {
      const formattedNaira = (paymentAttempt.amount_kobo / 100).toLocaleString('en-NG', {
        minimumFractionDigits: 2,
      });
      await NotificationService.dispatchNotification({
        userId: paymentAttempt.user_id,
        eventType: 'WALLET_FUNDING_SUCCESS',
        title: 'Wallet Funded Successfully',
        message: `Your Supreme wallet has been credited with ₦${formattedNaira}.`,
        category: NotificationCategory.FINANCIAL,
        amountKobo: paymentAttempt.amount_kobo,
        relatedTransactionReference: paymentAttempt.transaction_reference,
        sourceEntityId: paymentAttempt.transaction_reference,
        details: {
          gateway: 'Paystack',
        },
        correlationId,
      });
    } catch (notifErr: any) {
      logger.warn(
        `[PaystackFunding] Notification dispatch failed for ${paymentAttempt.user_id}: ${notifErr.message}`,
        undefined,
        correlationId
      );
    }


    // 10. Record Settlement Audit Log
    await recordAuditEvent({
      actorId: 'paystack',
      actorRole: 'SYSTEM',
      action: AuditAction.WALLET_ADJUSTMENT,
      targetId: paymentAttempt.user_id,
      targetCollection: 'wallets',
      afterData: {
        reference: paymentAttempt.gateway_reference,
        amount_kobo: paymentAttempt.amount_kobo,
        new_balance_kobo: mutationResult.balanceAfterKobo,
        version: mutationResult.newVersion,
        source: verificationSource,
      },
      correlationId: correlationId || 'unknown_correlation_id',
    });


    logger.info(
      `[PaystackFunding] Successfully settled ${paymentAttempt.gateway_reference}: +${paymentAttempt.amount_kobo} kobo to ${paymentAttempt.user_id}. New balance: ${mutationResult.balanceAfterKobo} kobo`,
      undefined,
      correlationId
    );

    return {
      status: 'SUCCESSFUL',
      amount_kobo: paymentAttempt.amount_kobo,
      reference: paymentAttempt.gateway_reference,
      transaction_id: paymentAttempt.transaction_id,
      verified_at: nowIso,
      message: 'Wallet funded successfully',
    };
  });
}

/**
 * 3. Process Public Paystack Webhooks
 * Validates raw body signature, deduplicates events, and triggers authoritative settlement.
 */
export async function processPaystackWebhook(params: {
  rawBody: string | Buffer;
  signature: string;
  correlationId?: string;
}): Promise<{ status: string; message?: string; duplicate?: boolean }> {
  const { rawBody, signature, correlationId } = params;

  // 1. Signature Verification
  const paystackClient = getPaystackClient();
  const isValidSignature = paystackClient.verifyWebhookSignature(rawBody, signature);

  if (!isValidSignature) {
    logger.warn(
      '[PaystackWebhook] Invalid HMAC-SHA512 webhook signature received.',
      undefined,
      correlationId
    );
    throw new AlexvyaApiError(ErrorCodes.UNAUTHORIZED, 'Invalid webhook signature', 401);
  }

  // 2. Safe JSON Parsing
  let eventPayload: any;
  try {
    const rawString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    eventPayload = JSON.parse(rawString);
  } catch (err) {
    throw new AlexvyaApiError(ErrorCodes.INVALID_INPUT, 'Malformed webhook JSON payload', 400);
  }

  const eventName = eventPayload.event;
  const eventData = eventPayload.data;
  const providerEventId = eventData?.id ? String(eventData.id) : `evt_${Date.now()}`;
  const reference = eventData?.reference;

  if (!reference) {
    logger.info(`[PaystackWebhook] Event '${eventName}' ignored (no reference present).`, undefined, correlationId);
    return { status: 'success', message: 'Ignored: No reference in payload' };
  }

  // 3. Deterministic Deduplication: SHA-256('PAYSTACK:' + providerEventId + ':' + reference)
  const webhookEventId = `whe_${crypto
    .createHash('sha256')
    .update(`PAYSTACK:${providerEventId}:${reference}`)
    .digest('hex')}`;

  const existingEvent = await getWebhookEventById(webhookEventId);
  if (existingEvent && existingEvent.processing_status === WebhookProcessingStatus.PROCESSED) {
    logger.info(
      `[PaystackWebhook] Duplicate webhook event ${webhookEventId} ignored.`,
      undefined,
      correlationId
    );
    return { status: 'success', message: 'Duplicate webhook already processed', duplicate: true };
  }

  // 4. Record Webhook Event in 'PROCESSING' status
  const nowIso = new Date().toISOString();
  await createWebhookEvent({
    id: webhookEventId,
    provider: ProviderId.PAYSTACK,
    event_type: eventName,
    external_event_id: providerEventId,
    signature_verified: true,
    processing_status: WebhookProcessingStatus.PROCESSING,
    processing_attempts: 1,
    related_transaction_id: null,
    payload_safe: eventPayload,
    error_message: null,
    received_at: nowIso,
    processed_at: null,
  });

  // 5. Handle 'charge.success'
  if (eventName === 'charge.success') {
    try {
      await verifyAndSettleWalletFunding({
        reference,
        verificationSource: VerificationSource.WEBHOOK,
        correlationId,
      });

      await updateWebhookEvent(webhookEventId, {
        processing_status: WebhookProcessingStatus.PROCESSED,
        processed_at: new Date().toISOString(),
      });
    } catch (settleErr: any) {
      await updateWebhookEvent(webhookEventId, {
        processing_status: WebhookProcessingStatus.FAILED,
        error_message: settleErr.message,
      });
      throw settleErr;
    }
  } else {
    await updateWebhookEvent(webhookEventId, {
      processing_status: WebhookProcessingStatus.IGNORED,
      processed_at: new Date().toISOString(),
    });
  }


  return { status: 'success' };
}
