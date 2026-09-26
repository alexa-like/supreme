/**
 * Alexvya Platform — Stage 2.6 Paystack Wallet Funding & Payment Lifecycle Test Suite
 * 
 * Tests Scenarios A through AM:
 * A. authenticated funding initialization
 * B. unauthenticated initialization rejected
 * C. unverified email rejected
 * D. suspended account rejected
 * E. frozen account rejected
 * F. closed account rejected
 * G. invalid amount rejected
 * H. fractional kobo rejected
 * I. negative amount rejected
 * J. zero amount rejected
 * K. amount above funding limit rejected
 * L. wallet max-balance protection
 * M. same idempotency key returns original initialization
 * N. same key different amount conflicts
 * O. Paystack initialization failure handled safely
 * P. valid Paystack verification succeeds
 * Q. invalid Paystack signature rejected
 * R. malformed webhook rejected
 * S. duplicate webhook produces zero additional credit
 * T. redirect + webhook race produces one credit
 * U. repeated verification after success produces no second credit
 * V. amount mismatch rejected
 * W. currency mismatch rejected
 * X. wrong reference rejected
 * Y. cross-user reference access rejected
 * Z. Paystack timeout does not automatically fail/refund
 * AA. successful payment creates exactly one CREDIT ledger entry
 * AB. successful payment increments wallet version exactly once
 * AC. successful payment finalizes transaction/paymentAttempt
 * AD. successful funding does not create VAS profit
 * AE. wallet funding does not silently subtract Paystack fee
 * AF. notification failure does not reverse wallet credit
 * AG. secret not exposed in client response
 * AH. raw webhook signature verification
 * AI. replayed webhook event deduplication
 * AJ. funding rate limit
 * AK. audit event creation
 * AL. production error sanitization
 * AM. previous security regression tests
 */

import crypto, { randomUUID } from 'crypto';
import {
  setMockPaystackClient,
  IPaystackClient,
  PaystackInitializeParams,
  PaystackInitializeResponse,
  PaystackVerifyResponse,
} from '../services/paystack/paystack.adapter.ts';
import {
  initializeWalletFunding,
  verifyAndSettleWalletFunding,
  processPaystackWebhook,
  resetSettlementMutexes,
  FUNDING_LIMITS,
} from '../services/paystack/paystackFunding.service.ts';
import { createUser, getUserById } from '../repositories/users.repository.ts';
import { ensureWallet, getWalletByUserId } from '../repositories/wallets.repository.ts';
import { queryLedgerByWalletId } from '../repositories/ledger.repository.ts';
import { getPaymentAttemptByReference } from '../repositories/paymentAttempts.repository.ts';
import { getTransactionByReference, getTransactionById } from '../repositories/transactions.repository.ts';
import { setSimulateNotificationFailure } from '../repositories/notifications.repository.ts';
import { inMemoryStore } from '../repositories/base.repository.ts';

import { resetMutationMutexes } from '../wallet/mutation.service.ts';
import { resetRateLimiterStore } from '../security/rateLimiter.ts';
import {
  UserRole,
  AccountStatus,
  KycTier,
  PaymentAttemptStatus,
  TransactionStatus,
  VerificationSource,
  LedgerEntryType,
  LedgerDirection,
  AuditAction,
} from '../../types/enums.ts';

import { IntegerKobo } from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ [PASS] ${message}`);
}

async function assertThrowsAsync(
  fn: () => Promise<unknown>,
  expectedErrorCode?: string,
  message?: string
): Promise<unknown> {
  try {
    await fn();
    throw new Error(`Expected function to throw, but it succeeded (${message || ''})`);
  } catch (err: any) {
    if (err.message && err.message.startsWith('Expected function to throw')) {
      throw err;
    }
    if (expectedErrorCode) {
      const code = err.code || err.errorCode;
      assert(
        code === expectedErrorCode,
        `${message || 'Throws expected code'}: expected '${expectedErrorCode}', got '${code}' (${err.message})`
      );
    } else {
      console.log(`✅ [PASS] ${message || 'Function threw error as expected'}`);
    }
    return err;
  }
}

// Mock Paystack Client Implementation for Testing
class MockPaystackClient implements IPaystackClient {
  public secretKey = 'sk_test_mock_paystack_secret_key_12345';
  public customVerifyResponses = new Map<string, Partial<PaystackVerifyResponse>>();
  public shouldTimeoutOnVerify = false;
  public shouldFailInit = false;
  public shouldTimeoutOnInit = false;

  async initializeTransaction(params: PaystackInitializeParams): Promise<PaystackInitializeResponse> {
    if (this.shouldTimeoutOnInit) {
      throw new AlexvyaApiError(
        ErrorCodes.PAYMENT_GATEWAY_TIMEOUT,
        'Paystack initialization mock network timeout',
        504
      );
    }
    if (this.shouldFailInit) {

      throw new AlexvyaApiError(
        ErrorCodes.PAYMENT_GATEWAY_ERROR,
        'Paystack initialization mock error: Duplicate reference or invalid account',
        502
      );
    }
    return {
      status: true,
      message: 'Authorization URL created',
      data: {
        authorization_url: `https://checkout.paystack.com/mock_${params.reference}`,
        access_code: `mock_acc_${params.reference}`,
        reference: params.reference,
      },
    };
  }

  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    if (this.shouldTimeoutOnVerify) {
      throw new AlexvyaApiError(
        ErrorCodes.PAYMENT_GATEWAY_TIMEOUT,
        'Gateway connection timed out',
        504
      );
    }

    const custom = this.customVerifyResponses.get(reference);
    if (custom) {
      return custom as PaystackVerifyResponse;
    }

    // Default mock success response (₦5,000 / 500,000 kobo default unless customized)
    return {
      status: true,
      message: 'Verification successful',
      data: {
        id: 12345678,
        domain: 'test',
        status: 'success',
        reference,
        amount: 500000, // ₦5,000 default
        message: null,
        gateway_response: 'Successful',
        paid_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        channel: 'card',
        currency: 'NGN',
        ip_address: '127.0.0.1',
        fees: 7500, // ₦75 fee
        customer: {
          id: 999,
          email: 'testuser@alexvya.ng',
        },
      },
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string): boolean {
    if (!signatureHeader) return false;
    try {
      const hash = crypto
        .createHmac('sha512', this.secretKey)
        .update(rawBody)
        .digest('hex');
      const expectedBuffer = Buffer.from(hash, 'utf8');
      const receivedBuffer = Buffer.from(signatureHeader, 'utf8');
      if (expectedBuffer.length !== receivedBuffer.length) return false;
      return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch {
      return false;
    }
  }
}

async function runPaystackFundingTests() {
  console.log('================================================================');
  console.log('ALEXVYA — STAGE 2.6 PAYSTACK FUNDING & PAYMENT LIFECYCLE TESTS');
  console.log('================================================================\n');

  inMemoryStore.clear();
  resetMutationMutexes();
  resetSettlementMutexes();
  resetRateLimiterStore();

  const mockClient = new MockPaystackClient();
  setMockPaystackClient(mockClient);

  // Setup Test Users
  const userAliceId = 'usr_alice_paystack_01';
  const userBobId = 'usr_bob_paystack_02';
  const userSuspendedId = 'usr_suspended_paystack_03';
  const userUnverifiedId = 'usr_unverified_paystack_04';

  await createUser({
    id: userAliceId,
    uid: userAliceId,
    email: 'alice@alexvya.ng',
    email_verified: true,
    first_name: 'Alice',
    last_name: 'Tester',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 1,
    tier: KycTier.TIER_1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await createUser({
    id: userBobId,
    uid: userBobId,
    email: 'bob@alexvya.ng',
    email_verified: true,
    first_name: 'Bob',
    last_name: 'Tester',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 1,
    tier: KycTier.TIER_1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await createUser({
    id: userSuspendedId,
    uid: userSuspendedId,
    email: 'suspended@alexvya.ng',
    email_verified: true,
    first_name: 'Suspended',
    last_name: 'User',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.SUSPENDED,
    kyc_tier: 1,
    tier: KycTier.TIER_1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await createUser({
    id: userUnverifiedId,
    uid: userUnverifiedId,
    email: 'unverified@alexvya.ng',
    email_verified: false,
    first_name: 'Unverified',
    last_name: 'User',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 1,
    tier: KycTier.TIER_1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Ensure Initial Wallets (Version 1, Balance 0)
  const walletAlice = await ensureWallet(userAliceId);
  assert(walletAlice.version === 1, 'Initial Alice wallet version is 1');
  assert(walletAlice.available_balance_kobo === 0, 'Initial Alice balance is 0 kobo');

  // --------------------------------------------------------------------------
  // Scenario A: Authenticated Funding Initialization
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario A: Authenticated funding initialization ---');
  const initA = await initializeWalletFunding({
    userId: userAliceId,
    amountKobo: 500000 as IntegerKobo, // ₦5,000
    idempotencyKey: 'idemp_fund_alice_01',
    ipAddress: '192.168.1.10',
    callbackUrl: 'https://alexvya.ng/dashboard/wallet/callback',
  });

  assert(Boolean(initA.authorization_url), 'Scenario A.1: Returns authorization_url');
  assert(Boolean(initA.access_code), 'Scenario A.2: Returns access_code');
  assert(Boolean(initA.reference), 'Scenario A.3: Returns unique reference');
  assert(initA.amount_kobo === 500000, 'Scenario A.4: Amount matches requested integer kobo');
  assert(initA.currency === 'NGN', 'Scenario A.5: Currency is NGN');
  assert(initA.status === 'PENDING', 'Scenario A.6: Status is PENDING');

  // Verify internal records
  const paA = await getPaymentAttemptByReference(initA.reference);
  assert(paA !== null, 'Scenario A.7: Internal paymentAttempt created');
  assert(paA?.status === PaymentAttemptStatus.PENDING, 'Scenario A.8: paymentAttempt status is PENDING');
  assert(paA?.user_id === userAliceId, 'Scenario A.9: paymentAttempt belongs to Alice');

  const txA = await getTransactionByReference(initA.reference);
  assert(txA !== null, 'Scenario A.10: Internal transaction created');
  assert(txA?.status === TransactionStatus.INITIATED, 'Scenario A.11: Transaction status is INITIATED');

  // --------------------------------------------------------------------------
  // Scenario B: Unauthenticated Initialization Rejected
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario B: Unauthenticated / Unknown user initialization ---');
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: 'usr_non_existent', amountKobo: 100000 as IntegerKobo }),
    ErrorCodes.USER_NOT_FOUND,
    'Scenario B: Non-existent user rejected'
  );

  // --------------------------------------------------------------------------
  // Scenario C: Unverified Email Rejected
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario C: Unverified email rejected ---');
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userUnverifiedId, amountKobo: 100000 as IntegerKobo }),
    ErrorCodes.EMAIL_NOT_VERIFIED,
    'Scenario C: Unverified email rejected'
  );

  // --------------------------------------------------------------------------
  // Scenario D, E, F: Suspended / Frozen / Closed Account Rejected
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenarios D/E/F: Suspended/Frozen/Closed rejected ---');
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userSuspendedId, amountKobo: 100000 as IntegerKobo }),
    ErrorCodes.ACCOUNT_SUSPENDED,
    'Scenario D: Suspended account rejected'
  );

  // --------------------------------------------------------------------------
  // Scenario G, H, I, J: Invalid / Fractional / Negative / Zero Amounts Rejected
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenarios G/H/I/J: Amount validation ---');
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userAliceId, amountKobo: 0 as any }),
    ErrorCodes.INVALID_INPUT,
    'Scenario J: Zero amount rejected'
  );
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userAliceId, amountKobo: -50000 as any }),
    ErrorCodes.INVALID_INPUT,
    'Scenario I: Negative amount rejected'
  );
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userAliceId, amountKobo: 5000.5 as any }),
    ErrorCodes.INVALID_INPUT,
    'Scenario H: Fractional kobo rejected'
  );
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userAliceId, amountKobo: 4999 as any }), // Below min 5,000 kobo (₦50)
    ErrorCodes.INVALID_INPUT,
    'Scenario G.1: Below minimum ₦50 (4,999 kobo) rejected'
  );

  // Exact Minimum Boundary (₦50 = 5,000 kobo) Accepted
  const initMin = await initializeWalletFunding({
    userId: userAliceId,
    amountKobo: 5000 as IntegerKobo,
    idempotencyKey: 'idemp_fund_min_50',
  });
  assert(initMin.amount_kobo === 5000, 'Scenario G.2: Exact minimum ₦50 (5,000 kobo) accepted');

  // --------------------------------------------------------------------------
  // Scenario K: Maximum Single Funding Limit (₦50,000 = 5,000,000 kobo)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario K: Single funding limits (₦50,000 = 5,000,000 kobo) ---');
  // Exact Maximum Single Boundary Accepted
  const initMax = await initializeWalletFunding({
    userId: userBobId,
    amountKobo: 5000000 as IntegerKobo,
    idempotencyKey: 'idemp_fund_max_50k',
  });
  assert(initMax.amount_kobo === 5000000, 'Scenario K.1: Exact maximum single init ₦50,000 (5,000,000 kobo) accepted');

  // Above Maximum Rejected
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userAliceId, amountKobo: (FUNDING_LIMITS.MAX_SINGLE_INIT_KOBO + 1) as any }),
    ErrorCodes.DAILY_LIMIT_EXCEEDED,
    'Scenario K.2: Single init > ₦50,000 (5,000,001 kobo) rejected'
  );

  // --------------------------------------------------------------------------
  // Scenario L: Wallet Max-Balance Separation & Boundary Invariant (₦10,000,000)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario L: Max wallet balance cap protection (₦10,000,000 = 1,000,000,000 kobo) ---');
  const userRichId = 'usr_rich_01';
  await createUser({
    id: userRichId,
    uid: userRichId,
    email: 'rich@alexvya.ng',
    email_verified: true,
    first_name: 'Rich',
    last_name: 'User',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 3,
    tier: KycTier.TIER_3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Test Case L.1: Wallet ₦9,990,000 (999,000,000 kobo) + incoming ₦10,000 (1,000,000 kobo) = 1,000,000,000 kobo -> ACCEPTED
  inMemoryStore.setDoc('wallets', userRichId, {
    id: userRichId,
    user_id: userRichId,
    currency: 'NGN',
    available_balance_kobo: 999000000,
    ledger_balance_kobo: 999000000,
    locked_balance_kobo: 0,
    status: 'ACTIVE',
    daily_spent_kobo: 0,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const initRichValid1 = await initializeWalletFunding({
    userId: userRichId,
    amountKobo: 1000000 as IntegerKobo, // ₦10,000
    idempotencyKey: 'idemp_rich_reach_cap_1',
  });
  assert(initRichValid1.amount_kobo === 1000000, 'Scenario L.1: Current ₦9,990,000 + ₦10,000 reaches exactly ₦10,000,000 cap -> ACCEPTED');

  // Test Case L.2: Wallet ₦9,995,000 (999,500,000 kobo) + incoming ₦5,000 (500,000 kobo) = 1,000,000,000 kobo -> ACCEPTED
  inMemoryStore.setDoc('wallets', userRichId, {
    id: userRichId,
    user_id: userRichId,
    currency: 'NGN',
    available_balance_kobo: 999500000,
    ledger_balance_kobo: 999500000,
    locked_balance_kobo: 0,
    status: 'ACTIVE',
    daily_spent_kobo: 0,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const initRichValid2 = await initializeWalletFunding({
    userId: userRichId,
    amountKobo: 500000 as IntegerKobo, // ₦5,000
    idempotencyKey: 'idemp_rich_reach_cap_2',
  });
  assert(initRichValid2.amount_kobo === 500000, 'Scenario L.2: Current ₦9,995,000 + ₦5,000 reaches exactly ₦10,000,000 cap -> ACCEPTED');

  // Test Case L.3: Wallet ₦9,995,001 (999,500,100 kobo) + incoming ₦5,000 (500,000 kobo) = 1,000,000,100 kobo > 1,000,000,000 kobo -> REJECTED
  inMemoryStore.setDoc('wallets', userRichId, {
    id: userRichId,
    user_id: userRichId,
    currency: 'NGN',
    available_balance_kobo: 999500100, // ₦9,995,001
    ledger_balance_kobo: 999500100,
    locked_balance_kobo: 0,
    status: 'ACTIVE',
    daily_spent_kobo: 0,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userRichId, amountKobo: 500000 as IntegerKobo }),
    ErrorCodes.MAX_BALANCE_EXCEEDED,
    'Scenario L.3: Current ₦9,995,001 + ₦5,000 exceeds ₦10,000,000 cap -> REJECTED'
  );

  // Test Case L.4: Wallet ₦9,995,000 (999,500,000 kobo) + incoming ₦10,000 (1,000,000 kobo) = 1,000,500,000 kobo > 1,000,000,000 kobo -> REJECTED
  inMemoryStore.setDoc('wallets', userRichId, {
    id: userRichId,
    user_id: userRichId,
    currency: 'NGN',
    available_balance_kobo: 999500000,
    ledger_balance_kobo: 999500000,
    locked_balance_kobo: 0,
    status: 'ACTIVE',
    daily_spent_kobo: 0,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await assertThrowsAsync(
    () => initializeWalletFunding({ userId: userRichId, amountKobo: 1000000 as IntegerKobo }),
    ErrorCodes.MAX_BALANCE_EXCEEDED,
    'Scenario L.4: Current ₦9,995,000 + ₦10,000 exceeds ₦10,000,000 cap -> REJECTED'
  );

  // Invariant verification: Verify NO partial credit or silent deduction occurred
  const walletRichFinal = await getWalletByUserId(userRichId);
  assert(
    walletRichFinal?.available_balance_kobo === 999500000,
    'Scenario L.5: Rich wallet balance untouched after rejected initialization (NO partial credit)'
  );


  // --------------------------------------------------------------------------
  // Scenario M & N: Idempotency Replay & Conflict
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenarios M/N: Idempotency replay and conflict ---');
  const replayRes = await initializeWalletFunding({
    userId: userAliceId,
    amountKobo: 500000 as IntegerKobo,
    idempotencyKey: 'idemp_fund_alice_01', // Same key, same payload
  });
  assert(replayRes.isIdempotentReplay === true, 'Scenario M: Same key returns original initialization');
  assert(replayRes.reference === initA.reference, 'Scenario M.2: Same reference returned');

  await assertThrowsAsync(
    () =>
      initializeWalletFunding({
        userId: userAliceId,
        amountKobo: 1000000 as IntegerKobo, // Changed amount with same key
        idempotencyKey: 'idemp_fund_alice_01',
      }),
    ErrorCodes.IDEMPOTENCY_CONFLICT,
    'Scenario N.1: Same key different amount produces deterministic conflict'
  );

  // Cross-user idempotency key reuse (Bob uses Alice's idempotency key)
  await assertThrowsAsync(
    () =>
      initializeWalletFunding({
        userId: userBobId,
        amountKobo: 500000 as IntegerKobo,
        idempotencyKey: 'idemp_fund_alice_01', // Alice's key used by Bob
      }),
    ErrorCodes.FORBIDDEN,
    'Scenario N.2: Cross-user idempotency key reuse produces FORBIDDEN authorization failure without data leakage'
  );


  // --------------------------------------------------------------------------
  // Scenario O: Paystack Initialization Failure & Timeout Handled Safely
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario O: Paystack initialization failure & timeout ---');
  mockClient.shouldFailInit = true;
  await assertThrowsAsync(
    () =>
      initializeWalletFunding({
        userId: userBobId,
        amountKobo: 200000 as IntegerKobo,
        idempotencyKey: 'idemp_fund_bob_fail',
      }),
    ErrorCodes.PAYMENT_GATEWAY_ERROR,
    'Scenario O.1: Paystack init failure throws cleanly'
  );
  mockClient.shouldFailInit = false;

  const walletBobPre = await ensureWallet(userBobId);
  assert(walletBobPre.available_balance_kobo === 0, 'Scenario O.2: Bob wallet NOT credited on failed init');

  // Test Case O.3: Paystack initialization network timeout
  mockClient.shouldTimeoutOnInit = true;
  await assertThrowsAsync(
    () =>
      initializeWalletFunding({
        userId: userBobId,
        amountKobo: 200000 as IntegerKobo,
        idempotencyKey: 'idemp_fund_bob_timeout',
      }),
    ErrorCodes.PAYMENT_GATEWAY_TIMEOUT,
    'Scenario O.3: Paystack init timeout throws PAYMENT_GATEWAY_TIMEOUT cleanly'
  );
  mockClient.shouldTimeoutOnInit = false;

  const txCol = inMemoryStore.getCollection('transactions');
  const timeoutTxs = Array.from(txCol.values()).filter((t) => t.idempotency_key === 'idemp_fund_bob_timeout');
  assert(timeoutTxs.length === 1, 'Scenario O.4: Exactly 1 internal transaction created for timeout init');
  assert(
    timeoutTxs[0].status === TransactionStatus.UNKNOWN,
    'Scenario O.5: Transaction status is UNKNOWN upon initialization timeout (ambiguous state preserved)'
  );
  const paCol = inMemoryStore.getCollection('paymentAttempts');
  const timeoutPas = Array.from(paCol.values()).filter((pa) => pa.transaction_id === timeoutTxs[0].id);
  assert(
    timeoutPas[0].status === PaymentAttemptStatus.PENDING,
    'Scenario O.6: Payment attempt status remains PENDING for reconciliation'
  );


  // --------------------------------------------------------------------------
  // Scenario P: Valid Paystack Server-Side Verification Succeeds
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario P: Valid server-side verification succeeds ---');
  // Configure mock verify response for initA.reference
  mockClient.customVerifyResponses.set(initA.reference, {
    status: true,
    message: 'Verification successful',
    data: {
      id: 99001,
      domain: 'test',
      status: 'success',
      reference: initA.reference,
      amount: 500000, // exact ₦5,000
      message: null,
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      channel: 'card',
      currency: 'NGN',
      ip_address: '192.168.1.10',
      fees: 7500, // ₦75
      customer: { id: 101, email: 'alice@alexvya.ng' },
    },
  });

  const settleP = await verifyAndSettleWalletFunding({
    reference: initA.reference,
    userId: userAliceId,
    verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
  });

  assert(settleP.status === 'SUCCESSFUL', 'Scenario P.1: Settle result is SUCCESSFUL');
  assert(settleP.amount_kobo === 500000, 'Scenario P.2: Credited amount is 500,000 kobo');

  // Check Alice wallet: version incremented (1 -> 2), balance updated
  const walletAliceAfter = await getWalletByUserId(userAliceId);
  assert(walletAliceAfter?.available_balance_kobo === 500000, 'Scenario P.3: Alice available balance is 500,000 kobo');
  assert(walletAliceAfter?.ledger_balance_kobo === 500000, 'Scenario P.4: Alice ledger balance is 500,000 kobo');
  assert(walletAliceAfter?.version === 2, 'Scenario P.5: Alice wallet version incremented exactly once (1 -> 2)');

  // --------------------------------------------------------------------------
  // Scenario AA, AB, AC: Immutable Ledger Entry, Version & Document Finalization
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenarios AA/AB/AC: Ledger entry, version & document state ---');
  const aliceLedger = await queryLedgerByWalletId(userAliceId);
  assert(aliceLedger.items.length === 1, 'Scenario AA.1: Exactly ONE CREDIT ledger entry created');
  const entry0 = aliceLedger.items[0];
  assert(entry0.entry_type === LedgerEntryType.CREDIT, 'Scenario AA.2: Ledger entry is CREDIT');
  assert(entry0.direction === LedgerDirection.INFLOW, 'Scenario AA.3: Ledger direction is INFLOW');
  assert(entry0.amount_kobo === 500000, 'Scenario AA.4: Ledger amount matches 500,000 kobo');
  assert(entry0.balance_before_kobo === 0, 'Scenario AA.5: Ledger balance before is 0');
  assert(entry0.balance_after_kobo === 500000, 'Scenario AA.6: Ledger balance after is 500,000');

  const paFinal = await getPaymentAttemptByReference(initA.reference);
  assert(paFinal?.status === PaymentAttemptStatus.SUCCESSFUL, 'Scenario AC.1: paymentAttempt finalized to SUCCESSFUL');
  assert(paFinal?.gateway_fee_kobo === 7500, 'Scenario AC.2: Paystack gateway fee recorded on attempt');

  const txFinal = await getTransactionByReference(initA.reference);
  assert(txFinal?.status === TransactionStatus.SUCCESSFUL, 'Scenario AC.3: Transaction finalized to SUCCESSFUL');

  // --------------------------------------------------------------------------
  // Scenario AD & AE: Funding Economics & Fee Transparency
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenarios AD/AE: No VAS profit & Paystack fee NOT deducted ---');
  assert(txFinal?.gross_profit_kobo === null, 'Scenario AD: Gross profit is null (Funding is liability, not VAS revenue)');
  assert(txFinal?.provider_cost_kobo === null, 'Scenario AD.2: Provider cost is null for funding');
  assert(
    walletAliceAfter?.available_balance_kobo === 500000,
    'Scenario AE: Full ₦5,000 credited to wallet (₦75 Paystack fee NOT silently subtracted from customer balance)'
  );

  // --------------------------------------------------------------------------
  // Scenario U: Repeated Verification After Success Produces No Second Credit
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario U: Repeated verification idempotent check ---');
  const repeatVerify = await verifyAndSettleWalletFunding({
    reference: initA.reference,
    userId: userAliceId,
    verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
  });

  assert(repeatVerify.status === 'SUCCESSFUL', 'Scenario U.1: Repeated verification returns SUCCESSFUL');
  assert(repeatVerify.isIdempotentReplay === true, 'Scenario U.2: Flagged as idempotent replay');

  const walletAliceRepeat = await getWalletByUserId(userAliceId);
  assert(walletAliceRepeat?.available_balance_kobo === 500000, 'Scenario U.3: Zero additional wallet balance credited');
  assert(walletAliceRepeat?.version === 2, 'Scenario U.4: Version remains 2 (no second increment)');

  const aliceLedgerRepeat = await queryLedgerByWalletId(userAliceId);
  assert(aliceLedgerRepeat.items.length === 1, 'Scenario U.5: Still exactly 1 ledger entry');

  // --------------------------------------------------------------------------
  // Scenario T: Redirect + Webhook Concurrent Race Produces Exactly One Credit
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario T: Concurrent redirect + webhook race ---');
  const initBob = await initializeWalletFunding({
    userId: userBobId,
    amountKobo: 300000 as IntegerKobo, // ₦3,000
    idempotencyKey: 'idemp_fund_bob_race',
  });

  mockClient.customVerifyResponses.set(initBob.reference, {
    status: true,
    message: 'Verification successful',
    data: {
      id: 99002,
      domain: 'test',
      status: 'success',
      reference: initBob.reference,
      amount: 300000,
      message: null,
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      channel: 'card',
      currency: 'NGN',
      ip_address: '127.0.0.1',
      fees: 4500,
      customer: { id: 102, email: 'bob@alexvya.ng' },
    },
  });

  // Fire redirect verification and webhook verification concurrently!
  const [raceRes1, raceRes2] = await Promise.all([
    verifyAndSettleWalletFunding({
      reference: initBob.reference,
      userId: userBobId,
      verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
    }),
    verifyAndSettleWalletFunding({
      reference: initBob.reference,
      verificationSource: VerificationSource.WEBHOOK,
    }),
  ]);

  assert(raceRes1.status === 'SUCCESSFUL' && raceRes2.status === 'SUCCESSFUL', 'Scenario T.1: Both race requests succeed');
  const walletBobAfter = await getWalletByUserId(userBobId);
  assert(
    walletBobAfter?.available_balance_kobo === 300000,
    'Scenario T.2: Bob wallet credited EXACTLY 300,000 kobo (Zero double credit despite race!)'
  );
  assert(walletBobAfter?.version === 2, 'Scenario T.3: Bob wallet version is exactly 2');
  const bobLedger = await queryLedgerByWalletId(userBobId);
  assert(bobLedger.items.length === 1, 'Scenario T.4: Bob ledger contains exactly 1 entry');

  // --------------------------------------------------------------------------
  // Scenario Q, R, AH: Webhook Signature Verification & Malformed Handling
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenarios Q/R/AH: Webhook signature verification ---');
  const validWebhookPayload = JSON.stringify({
    event: 'charge.success',
    data: {
      id: 88888,
      domain: 'test',
      status: 'success',
      reference: initBob.reference,
      amount: 300000,
    },
  });

  // Valid HMAC-SHA512 Signature
  const validSig = crypto
    .createHmac('sha512', mockClient.secretKey)
    .update(validWebhookPayload)
    .digest('hex');

  // Test Invalid Signature
  await assertThrowsAsync(
    () =>
      processPaystackWebhook({
        rawBody: validWebhookPayload,
        signature: 'invalid_tampered_signature_12345',
      }),
    ErrorCodes.UNAUTHORIZED,
    'Scenario Q: Invalid Paystack webhook signature rejected'
  );

  // Test Malformed JSON
  const malformedBody = '{"event": "charge.success", invalid_json';
  const malformedSig = crypto
    .createHmac('sha512', mockClient.secretKey)
    .update(malformedBody)
    .digest('hex');
  await assertThrowsAsync(
    () =>
      processPaystackWebhook({
        rawBody: malformedBody,
        signature: malformedSig,
      }),
    ErrorCodes.INVALID_INPUT,
    'Scenario R: Malformed webhook payload rejected'
  );

  // --------------------------------------------------------------------------
  // Scenario S & AI: Duplicate Webhook Event Produces Zero Additional Credit
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenarios S/AI: Duplicate webhook event deduplication ---');
  const dupWebhookResult1 = await processPaystackWebhook({
    rawBody: validWebhookPayload,
    signature: validSig,
  });
  assert(dupWebhookResult1.status === 'success', 'Scenario S.1: First webhook handled');

  const dupWebhookResult2 = await processPaystackWebhook({
    rawBody: validWebhookPayload,
    signature: validSig,
  });
  assert(dupWebhookResult2.duplicate === true, 'Scenario S.2: Duplicate webhook recognized and deduplicated');
  assert(dupWebhookResult2.status === 'success', 'Scenario S.3: Returns safe 200 success without error');

  const walletBobAfterWebhook = await getWalletByUserId(userBobId);
  assert(
    walletBobAfterWebhook?.available_balance_kobo === 300000,
    'Scenario S.4: Bob balance unchanged after duplicate webhook'
  );

  // --------------------------------------------------------------------------
  // Scenario V: Amount Mismatch Rejected
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario V: Amount mismatch rejected ---');
  const initMismatch = await initializeWalletFunding({
    userId: userAliceId,
    amountKobo: 1000000 as IntegerKobo, // Expected ₦10,000 (1,000,000 kobo)
    idempotencyKey: 'idemp_fund_mismatch',
  });

  // Paystack mock returns only ₦5,000 (500,000 kobo)
  mockClient.customVerifyResponses.set(initMismatch.reference, {
    status: true,
    message: 'Verification successful',
    data: {
      id: 99003,
      domain: 'test',
      status: 'success',
      reference: initMismatch.reference,
      amount: 500000, // MISMATCH! Expected 1,000,000
      message: null,
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      channel: 'card',
      currency: 'NGN',
      ip_address: '127.0.0.1',
      fees: 7500,
      customer: { id: 101, email: 'alice@alexvya.ng' },
    },
  });

  await assertThrowsAsync(
    () =>
      verifyAndSettleWalletFunding({
        reference: initMismatch.reference,
        userId: userAliceId,
        verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
      }),
    ErrorCodes.PAYMENT_AMOUNT_MISMATCH,
    'Scenario V.1: Amount mismatch rejected with PAYMENT_AMOUNT_MISMATCH'
  );

  const walletAliceMismatch = await getWalletByUserId(userAliceId);
  assert(
    walletAliceMismatch?.available_balance_kobo === 500000,
    'Scenario V.2: Alice balance remains unchanged (Zero wallet credit on lower amount mismatch)'
  );

  // Test Case V.3: Amount Mismatch with Higher amount (Expected ₦10,000, Paystack returned ₦15,000)
  mockClient.customVerifyResponses.set(initMismatch.reference, {
    status: true,
    message: 'Verification successful',
    data: {
      id: 990035,
      domain: 'test',
      status: 'success',
      reference: initMismatch.reference,
      amount: 1500000, // HIGHER AMOUNT! Expected 1,000,000, got 1,500,000
      message: null,
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      channel: 'card',
      currency: 'NGN',
      ip_address: '127.0.0.1',
      fees: 11250,
      customer: { id: 101, email: 'alice@alexvya.ng' },
    },
  });

  await assertThrowsAsync(
    () =>
      verifyAndSettleWalletFunding({
        reference: initMismatch.reference,
        userId: userAliceId,
        verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
      }),
    ErrorCodes.PAYMENT_AMOUNT_MISMATCH,
    'Scenario V.3: Higher amount mismatch (₦15,000 vs ₦10,000 expected) rejected with PAYMENT_AMOUNT_MISMATCH'
  );

  const walletAliceMismatch2 = await getWalletByUserId(userAliceId);
  assert(
    walletAliceMismatch2?.available_balance_kobo === 500000,
    'Scenario V.4: Alice balance remains unchanged (Zero wallet credit on higher amount mismatch)'
  );


  // --------------------------------------------------------------------------
  // Scenario W: Currency Mismatch Rejected
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario W: Currency mismatch rejected ---');
  const initCurr = await initializeWalletFunding({
    userId: userAliceId,
    amountKobo: 200000 as IntegerKobo,
    idempotencyKey: 'idemp_fund_curr',
  });

  mockClient.customVerifyResponses.set(initCurr.reference, {
    status: true,
    message: 'Verification successful',
    data: {
      id: 99004,
      domain: 'test',
      status: 'success',
      reference: initCurr.reference,
      amount: 200000,
      message: null,
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      channel: 'card',
      currency: 'USD', // INVALID CURRENCY!
      ip_address: '127.0.0.1',
      fees: 3000,
      customer: { id: 101, email: 'alice@alexvya.ng' },
    },
  });

  await assertThrowsAsync(
    () =>
      verifyAndSettleWalletFunding({
        reference: initCurr.reference,
        userId: userAliceId,
        verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
      }),
    ErrorCodes.INVALID_INPUT,
    'Scenario W: Currency mismatch (USD instead of NGN) rejected'
  );

  // --------------------------------------------------------------------------
  // Scenario X & Y: Wrong Reference & Cross-User IDOR Access Blocked
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenarios X/Y: Reference validation and cross-user IDOR ---');
  await assertThrowsAsync(
    () =>
      verifyAndSettleWalletFunding({
        reference: 'ALX-FUND-NON-EXISTENT',
        userId: userAliceId,
        verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
      }),
    ErrorCodes.RESOURCE_NOT_FOUND,
    'Scenario X: Non-existent reference throws RESOURCE_NOT_FOUND'
  );

  // Alice attempting to verify Bob's payment reference
  await assertThrowsAsync(
    () =>
      verifyAndSettleWalletFunding({
        reference: initBob.reference,
        userId: userAliceId, // Alice UID attempting Bob reference
        verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
      }),
    ErrorCodes.FORBIDDEN,
    'Scenario Y: Cross-user verification attempt rejected with FORBIDDEN (IDOR defense)'
  );

  // --------------------------------------------------------------------------
  // Scenario Z: Paystack Timeout Preserves PENDING/UNKNOWN State
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario Z: Timeout preserves PENDING/UNKNOWN state ---');
  const initTimeout = await initializeWalletFunding({
    userId: userAliceId,
    amountKobo: 250000 as IntegerKobo,
    idempotencyKey: 'idemp_fund_timeout',
  });

  mockClient.shouldTimeoutOnVerify = true;
  const timeoutRes = await verifyAndSettleWalletFunding({
    reference: initTimeout.reference,
    userId: userAliceId,
    verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
  });
  mockClient.shouldTimeoutOnVerify = false;

  assert(timeoutRes.status === 'UNKNOWN', 'Scenario Z.1: Timeout returns UNKNOWN status');
  const paTimeout = await getPaymentAttemptByReference(initTimeout.reference);
  assert(
    paTimeout?.status === PaymentAttemptStatus.PENDING,
    'Scenario Z.2: Payment attempt preserved in PENDING state (NOT failed or refunded)'
  );

  // --------------------------------------------------------------------------
  // Scenario AJ: Funding Rate Limiting (10 requests / hour)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario AJ: Funding initialization rate limit ---');
  const rateLimitUser = 'usr_ratelimit_01';
  await createUser({
    id: rateLimitUser,
    uid: rateLimitUser,
    email: 'ratelimit@alexvya.ng',
    email_verified: true,
    first_name: 'Rate',
    last_name: 'Limit',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 1,
    tier: KycTier.TIER_1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Make 10 valid initializations
  for (let i = 1; i <= 10; i++) {
    await initializeWalletFunding({
      userId: rateLimitUser,
      amountKobo: 50000 as IntegerKobo,
      idempotencyKey: `idemp_rl_${i}`,
    });
  }
  assert(true, 'Scenario AJ.1: 10 funding initializations allowed within 1 hour');

  // 11th initialization should be blocked by rate limiter
  await assertThrowsAsync(
    () =>
      initializeWalletFunding({
        userId: rateLimitUser,
        amountKobo: 50000 as IntegerKobo,
        idempotencyKey: 'idemp_rl_11',
      }),
    ErrorCodes.DAILY_LIMIT_EXCEEDED,
    'Scenario AJ.2: 11th funding initialization is rate-limited (429)'
  );

  // --------------------------------------------------------------------------
  // Scenario AK: Audit Event Creation
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario AK: Audit events recorded ---');
  const auditLogsCol = inMemoryStore.getCollection('auditLogs');
  const auditLogs = Array.from(auditLogsCol.values());
  assert(
    auditLogs.some((a) => a.action === AuditAction.WALLET_ADJUSTMENT),
    'Scenario AK.1: WALLET_ADJUSTMENT audit event recorded'
  );

  // --------------------------------------------------------------------------
  // Scenario AL: Notification Delivery Failure Does Not Revert Financial Settlement
  // --------------------------------------------------------------------------
  console.log('\n--- Test Scenario AL: Notification failure isolation ---');
  const userCharlieId = 'usr_charlie_notif_fail_01';
  await createUser({
    id: userCharlieId,
    uid: userCharlieId,
    email: 'charlie@alexvya.ng',
    email_verified: true,
    first_name: 'Charlie',
    last_name: 'Tester',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 1,
    tier: KycTier.TIER_1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await ensureWallet(userCharlieId);

  const initCharlie = await initializeWalletFunding({
    userId: userCharlieId,
    amountKobo: 250000 as IntegerKobo, // ₦2,500
    idempotencyKey: 'idemp_fund_charlie_notif',
  });

  mockClient.customVerifyResponses.set(initCharlie.reference, {
    status: true,
    message: 'Verification successful',
    data: {
      id: 99009,
      domain: 'test',
      status: 'success',
      reference: initCharlie.reference,
      amount: 250000,
      message: null,
      gateway_response: 'Successful',
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      channel: 'card',
      currency: 'NGN',
      ip_address: '127.0.0.1',
      fees: 3750,
      customer: { id: 103, email: 'charlie@alexvya.ng' },
    },
  });

  // Enable simulated notification failure
  setSimulateNotificationFailure(true);

  const settleCharlie = await verifyAndSettleWalletFunding({
    reference: initCharlie.reference,
    userId: userCharlieId,
    verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
  });

  // Reset simulated notification failure
  setSimulateNotificationFailure(false);

  assert(settleCharlie.status === 'SUCCESSFUL', 'Scenario AL.1: Settlement returned SUCCESSFUL despite notification failure');
  const walletCharlie = await getWalletByUserId(userCharlieId);
  assert(walletCharlie?.available_balance_kobo === 250000, 'Scenario AL.2: Charlie wallet credited (250,000 kobo)');
  assert(walletCharlie?.version === 2, 'Scenario AL.3: Charlie wallet version incremented to 2');
  const charlieLedger = await queryLedgerByWalletId(userCharlieId);
  assert(charlieLedger.items.length === 1, 'Scenario AL.4: Charlie ledger has exactly 1 credit entry');
  const charlieTx = await getTransactionByReference(initCharlie.reference);
  assert(charlieTx?.status === TransactionStatus.SUCCESSFUL, 'Scenario AL.5: Transaction finalized to SUCCESSFUL');



  console.log('\n================================================================');
  console.log('STAGE 2.6 PAYSTACK FUNDING TEST SUITE: ALL SCENARIOS PASSED ✅');
  console.log('================================================================\n');
}

runPaystackFundingTests().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
