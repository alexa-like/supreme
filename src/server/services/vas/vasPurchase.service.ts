/**
 * Alexvya Platform — V1 VAS Service Purchase Engine
 * Stage 2.7 V1 VAS Service Purchase Engine
 * 
 * Services Supported:
 * 1. Airtime (VTU)
 * 2. Data (SME & Direct Bundles)
 * 3. Electricity (Prepaid/Postpaid Token Vending)
 * 4. Cable TV (Bouquet Subscriptions)
 * 
 * CORE ARCHITECTURAL INVARIANTS:
 * 1. AUTHORITATIVE PRICING: Server resolves all prices, discounts, fees, provider costs. Client price is discarded.
 * 2. NO FREE VENDING: Wallet debit commits to Firestore BEFORE external provider is called.
 * 3. NO PROVIDER CALLS INSIDE FIRESTORE TRANSACTIONS: External HTTP happens outside transactions.
 * 4. DETERMINISTIC AMBIGUITY HANDLING: Timeout/unknown results in UNKNOWN/PENDING status, NEVER automatic refund or re-vending.
 * 5. ATOMIC REFUND ON CONFIRMED FAILURE: Separate atomic refundWallet() call with immutable REFUND ledger entry.
 * 6. PROFIT RECOGNITION: Expected gross profit is recognized ONLY on confirmed SUCCESSFUL delivery.
 * 7. BINARY FULFILLMENT: 100% fulfilled or 0% fulfilled.
 */

import { randomUUID } from 'crypto';
import {
  getUserById,
} from '../../repositories/users.repository.ts';
import {
  getWalletByUserId,
} from '../../repositories/wallets.repository.ts';
import {
  createTransaction,
  updateTransaction,
} from '../../repositories/transactions.repository.ts';
import {
  createServiceOrder,
  updateServiceOrder,
  createAirtimeOrder,
  createDataOrder,
  createBillOrder,
  updateBillOrder,
} from '../../repositories/serviceOrders.repository.ts';
import {
  createProviderTransaction,
  updateProviderTransaction,
} from '../../repositories/providerTransactions.repository.ts';
import {
  createAuditLog,
} from '../../repositories/auditLogs.repository.ts';
import {
  createNotification,
} from '../../repositories/notifications.repository.ts';
import { NotificationService } from '../notifications/notification.service.ts';
import {
  debitWallet,
  refundWallet,
} from '../../wallet/mutation.service.ts';
import {
  acquireIdempotencyLease,
  completeIdempotencyRecord,
  failIdempotencyRecord,
  computeRequestFingerprint,
} from '../idempotency.service.ts';
import {
  VasPricingService,
  ResolvedPricingResult,
  VAS_FINANCIAL_LIMITS,
} from './vasPricing.service.ts';
import {
  VasValidationService,
} from './vasValidation.service.ts';
import {
  ProviderRouterService,
} from './providerRouter.service.ts';
import {
  TransactionDocument,
  ServiceOrderDocument,
  AirtimeOrderDocument,
  DataOrderDocument,
  BillOrderDocument,
  ProviderTransactionDocument,
} from '../../../types/firestore.ts';
import {
  TransactionStatus,
  TransactionType,
  ServiceOrderStatus,
  ServiceCategory,
  LedgerCategory,
  ProviderId,
  ProviderNormalizedStatus,
  NetworkProvider,
  MeterType,
  AuditAction,
  NotificationCategory,
  AccountStatus,
  WalletStatus,
} from '../../../types/enums.ts';
import { IntegerKobo } from '../../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';
import { logger } from '../../../lib/logger/logger.ts';

// In-Memory Async Mutex for local test environments to ensure strict transaction-like concurrency serialization
class OrderMutex {
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
}

const vasPurchaseMutex = new OrderMutex();

export interface AirtimePurchaseParams {
  userId: string;
  network: NetworkProvider;
  phoneNumber: string;
  amountKobo: IntegerKobo;
  idempotencyKey: string;
  correlationId?: string;
}

export interface DataPurchaseParams {
  userId: string;
  productId: string;
  phoneNumber: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface ElectricityPurchaseParams {
  userId: string;
  disco: string;
  meterNumber: string;
  meterType: MeterType;
  amountKobo: IntegerKobo;
  customerName?: string;
  customerAddress?: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface CableTvPurchaseParams {
  userId: string;
  productId: string;
  smartcardNumber: string;
  customerName?: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface VasPurchaseResponse {
  transaction_id: string;
  order_id: string;
  reference: string;
  service_category: ServiceCategory;
  recipient_identifier: string;
  face_value_kobo: IntegerKobo;
  total_charged_kobo: IntegerKobo;
  discount_kobo: IntegerKobo;
  fee_kobo: IntegerKobo;
  status: TransactionStatus;
  provider: ProviderId;
  operator_reference?: string | null;
  token?: string | null;
  units?: string | null;
  receipt_number?: string | null;
  message: string;
  is_idempotent_replay?: boolean;
}

export class VasPurchaseService {
  /**
   * Helper: Validates customer eligibility (user active, email verified, wallet active).
   */
  private static async validateCustomerEligibility(userId: string): Promise<{ userEmail: string }> {
    const user = await getUserById(userId);
    if (!user) {
      throw new AlexvyaApiError(ErrorCodes.USER_NOT_FOUND, 'Customer profile does not exist.', 404);
    }

    if (user.account_status === AccountStatus.FROZEN) {
      throw new AlexvyaApiError(ErrorCodes.ACCOUNT_FROZEN, 'Account is frozen. Financial transactions are restricted.', 403);
    }
    if (user.account_status === AccountStatus.SUSPENDED) {
      throw new AlexvyaApiError(ErrorCodes.ACCOUNT_SUSPENDED, 'Account is suspended.', 403);
    }
    if (user.account_status !== AccountStatus.ACTIVE) {
      throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, `Account is in ${user.account_status} state.`, 403);
    }

    if (!user.email_verified) {
      throw new AlexvyaApiError(ErrorCodes.EMAIL_NOT_VERIFIED, 'Email address must be verified prior to initiating service purchases.', 403);
    }

    const wallet = await getWalletByUserId(userId);
    if (!wallet) {
      throw new AlexvyaApiError(ErrorCodes.WALLET_NOT_FOUND, 'Customer wallet not found.', 404);
    }

    if (wallet.status === WalletStatus.FROZEN) {
      throw new AlexvyaApiError(ErrorCodes.WALLET_FROZEN, 'Wallet is frozen. Cannot perform debit.', 403);
    }
    if (wallet.status === WalletStatus.LOCKED) {
      throw new AlexvyaApiError(ErrorCodes.WALLET_LOCKED, 'Wallet is locked. Cannot perform debit.', 403);
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new AlexvyaApiError(ErrorCodes.INVALID_WALLET_STATE, `Wallet is in ${wallet.status} state.`, 403);
    }

    return { userEmail: user.email };
  }

  // ==========================================================================
  // 1. AIRTIME PURCHASE
  // ==========================================================================
  public static async purchaseAirtime(params: AirtimePurchaseParams): Promise<VasPurchaseResponse> {
    const normalizedPhone = VasValidationService.validateAndNormalizeMsisdn(params.phoneNumber);
    const pricing = await VasPricingService.resolveAirtimePricing(params.network, params.amountKobo);

    return this.executeGenericVasPurchase({
      userId: params.userId,
      serviceCategory: ServiceCategory.AIRTIME,
      transactionType: TransactionType.AIRTIME_PURCHASE,
      ledgerCategory: LedgerCategory.AIRTIME_PURCHASE,
      recipientIdentifier: normalizedPhone,
      pricing,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
      subOrderCreator: async (orderId) => {
        const airtimeOrder: AirtimeOrderDocument = {
          id: orderId,
          service_order_id: orderId,
          network: params.network,
          phone_number: normalizedPhone,
          airtime_type: 'VTU',
          operator_reference: null,
          created_at: new Date().toISOString(),
        };
        await createAirtimeOrder(airtimeOrder);
      },
      providerPlanCode: pricing.product.provider_mappings?.vtpass || params.network.toLowerCase(),
      network: params.network,
    });
  }

  // ==========================================================================
  // 2. DATA PURCHASE
  // ==========================================================================
  public static async purchaseData(params: DataPurchaseParams): Promise<VasPurchaseResponse> {
    const normalizedPhone = VasValidationService.validateAndNormalizeMsisdn(params.phoneNumber);
    const pricing = await VasPricingService.resolveDataPricing(params.productId);

    const network = (pricing.product.sub_category?.toUpperCase() || 'MTN') as NetworkProvider;

    return this.executeGenericVasPurchase({
      userId: params.userId,
      serviceCategory: ServiceCategory.DATA,
      transactionType: TransactionType.DATA_PURCHASE,
      ledgerCategory: LedgerCategory.DATA_PURCHASE,
      recipientIdentifier: normalizedPhone,
      pricing,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
      subOrderCreator: async (orderId) => {
        const dataOrder: DataOrderDocument = {
          id: orderId,
          service_order_id: orderId,
          network,
          phone_number: normalizedPhone,
          data_plan_type: 'SME',
          data_volume_mb: 1024,
          validity_days: 30,
          provider_plan_code: pricing.product.provider_mappings?.vtpass || pricing.product.id,
          created_at: new Date().toISOString(),
        };
        await createDataOrder(dataOrder);
      },
      providerPlanCode: pricing.product.provider_mappings?.clubkonnect || pricing.product.provider_mappings?.vtpass || pricing.product.id,
      network,
    });
  }

  // ==========================================================================
  // 3. ELECTRICITY PURCHASE
  // ==========================================================================
  public static async purchaseElectricity(params: ElectricityPurchaseParams): Promise<VasPurchaseResponse> {
    // Validate meter number first
    await VasValidationService.validateMeter({
      disco: params.disco,
      meterNumber: params.meterNumber,
      meterType: params.meterType,
      correlationId: params.correlationId,
    });

    const pricing = await VasPricingService.resolveElectricityPricing(params.disco, params.meterType, params.amountKobo);

    return this.executeGenericVasPurchase({
      userId: params.userId,
      serviceCategory: ServiceCategory.ELECTRICITY,
      transactionType: TransactionType.ELECTRICITY_BILL,
      ledgerCategory: LedgerCategory.ELECTRICITY_BILL,
      recipientIdentifier: params.meterNumber.trim(),
      pricing,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
      customerName: params.customerName || 'ADEMOLA ADEBAYO O.',
      customerAddress: params.customerAddress || '14 Marina Road, Lagos Island, Lagos',
      meterType: params.meterType,
      subOrderCreator: async (orderId) => {
        const billOrder: BillOrderDocument = {
          id: orderId,
          service_order_id: orderId,
          bill_category: 'ELECTRICITY',
          provider_code: params.disco.toUpperCase(),
          customer_identifier: params.meterNumber.trim(),
          customer_name: params.customerName || 'ADEMOLA ADEBAYO O.',
          customer_address: params.customerAddress || '14 Marina Road, Lagos Island, Lagos',
          meter_type: params.meterType,
          sts_token: null,
          token_units: null,
          cable_package_name: null,
          receipt_number: null,
          created_at: new Date().toISOString(),
        };
        await createBillOrder(billOrder);
      },
      providerPlanCode: pricing.product.provider_mappings?.vtpass || params.disco.toLowerCase(),
    });
  }

  // ==========================================================================
  // 4. CABLE TV PURCHASE
  // ==========================================================================
  public static async purchaseCableTv(params: CableTvPurchaseParams): Promise<VasPurchaseResponse> {
    const operator = params.productId.includes('gotv') ? 'GOTV' : params.productId.includes('startimes') ? 'STARTIMES' : 'DSTV';
    
    // Validate smartcard number first
    await VasValidationService.validateSmartcard({
      operator,
      smartcardNumber: params.smartcardNumber,
      correlationId: params.correlationId,
    });

    const pricing = await VasPricingService.resolveCableTvPricing(params.productId);

    return this.executeGenericVasPurchase({
      userId: params.userId,
      serviceCategory: ServiceCategory.CABLE_TV,
      transactionType: TransactionType.CABLE_TV,
      ledgerCategory: LedgerCategory.CABLE_TV,
      recipientIdentifier: params.smartcardNumber.trim(),
      pricing,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
      customerName: params.customerName || 'CHUKWUMA OKAFOR E.',
      cablePackageName: pricing.product.name,
      subOrderCreator: async (orderId) => {
        const billOrder: BillOrderDocument = {
          id: orderId,
          service_order_id: orderId,
          bill_category: 'CABLE_TV',
          provider_code: operator,
          customer_identifier: params.smartcardNumber.trim(),
          customer_name: params.customerName || 'CHUKWUMA OKAFOR E.',
          customer_address: null,
          meter_type: null,
          sts_token: null,
          token_units: null,
          cable_package_name: pricing.product.name,
          receipt_number: null,
          created_at: new Date().toISOString(),
        };
        await createBillOrder(billOrder);
      },
      providerPlanCode: pricing.product.provider_mappings?.vtpass || params.productId,
    });
  }

  // ==========================================================================
  // 5. SHARED GENERIC VAS PURCHASE ENGINE
  // ==========================================================================
  private static async executeGenericVasPurchase(config: {
    userId: string;
    serviceCategory: ServiceCategory;
    transactionType: TransactionType;
    ledgerCategory: LedgerCategory;
    recipientIdentifier: string;
    pricing: ResolvedPricingResult;
    idempotencyKey: string;
    correlationId?: string;
    subOrderCreator: (orderId: string) => Promise<void>;
    providerPlanCode: string;
    network?: NetworkProvider;
    customerName?: string;
    customerAddress?: string;
    meterType?: MeterType;
    cablePackageName?: string;
  }): Promise<VasPurchaseResponse> {
    const { userId, serviceCategory, pricing, idempotencyKey, correlationId } = config;

    // Concurrency Mutex keyed by user ID to prevent concurrent wallet double-spending
    return vasPurchaseMutex.runExclusive(userId, async () => {
      // Step 1: Customer Eligibility Check
      const { userEmail } = await this.validateCustomerEligibility(userId);

      // Step 2: Idempotency Lease Acquisition
      const requestPayload = {
        userId,
        serviceCategory,
        recipient: config.recipientIdentifier,
        productId: pricing.product.id,
        amountKobo: pricing.totalChargedKobo,
      };

      const lease = await acquireIdempotencyLease({
        key: idempotencyKey,
        userId,
        requestPath: `/services/${serviceCategory.toLowerCase()}/purchase`,
        requestPayload,
        retentionPolicy: 'VAS_PURCHASE',
        correlationId,
      });

      if (lease.status === 'REPLAY' && lease.responseBody) {
        logger.info(`[VasPurchaseService] Idempotency replay for key ${idempotencyKey}`);
        return {
          ...(lease.responseBody as unknown as VasPurchaseResponse),
          is_idempotent_replay: true,
        };
      }

      // Step 3: Select Provider
      const preferredProvider = serviceCategory === ServiceCategory.DATA ? ProviderId.CLUBKONNECT : ProviderId.VTPASS;
      const providerAdapter = await ProviderRouterService.selectProviderForService(serviceCategory, preferredProvider);
      const activeProviderId = providerAdapter.providerId;

      // Step 4: Create Pre-Commit Transaction & Service Order Records
      const orderId = randomUUID();
      const transactionReference = `ALX-${serviceCategory.substring(0, 3)}-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const now = new Date().toISOString();

      const transactionDoc: TransactionDocument = {
        id: orderId,
        reference: transactionReference,
        user_id: userId,
        user_email_snapshot: userEmail,
        type: config.transactionType,
        status: TransactionStatus.INITIATED,
        currency: 'NGN',
        amount_kobo: pricing.faceValueKobo,
        fee_kobo: (pricing.product.service_fee_kobo || 0) as IntegerKobo,
        discount_kobo: pricing.economics.discount_kobo,
        total_charged_kobo: pricing.totalChargedKobo,
        provider_cost_kobo: pricing.economics.provider_cost_kobo,
        gross_profit_kobo: 0 as IntegerKobo, // Unrecognized until fulfillment!
        original_economics: pricing.economics,
        provider: activeProviderId,
        provider_reference: null,
        idempotency_key: idempotencyKey,
        service_details: {
          product_id: pricing.product.id,
          product_name: pricing.product.name,
          recipient: config.recipientIdentifier,
          provider_plan_code: config.providerPlanCode,
        },
        failure_reason: null,
        internal_error_code: null,
        created_at: now,
        completed_at: null,
      };

      const serviceOrderDoc: ServiceOrderDocument = {
        id: orderId,
        transaction_reference: transactionReference,
        user_id: userId,
        service_category: serviceCategory,
        status: ServiceOrderStatus.PENDING,
        product_id: pricing.product.id,
        product_name_snapshot: pricing.product.name,
        recipient_identifier: config.recipientIdentifier,
        face_value_kobo: pricing.faceValueKobo,
        amount_debited_kobo: pricing.totalChargedKobo,
        active_provider: activeProviderId,
        provider_transaction_id: null,
        retry_count: 0,
        created_at: now,
        updated_at: now,
      };

      await createTransaction(transactionDoc);
      await createServiceOrder(serviceOrderDoc);
      await config.subOrderCreator(orderId);

      // Step 5: ATOMIC WALLET DEBIT (Financial Commit)
      // NON-NEGOTIABLE: External provider MUST NOT be called until wallet debit commits successfully!
      try {
        await debitWallet({
          userId,
          amountKobo: pricing.totalChargedKobo,
          category: config.ledgerCategory,
          description: `${serviceCategory} purchase for ${config.recipientIdentifier}`,
          transactionId: orderId,
          transactionReference,
          idempotencyKey: `debit_${orderId}`,
          actor: { type: 'CUSTOMER', id: userId },
          correlationId,
        });
      } catch (debitErr: any) {
        // If wallet debit failed (e.g. insufficient funds, locked), do NOT call provider.
        await updateTransaction(orderId, {
          status: TransactionStatus.FAILED,
          failure_reason: debitErr.message || 'Wallet debit failed',
          internal_error_code: debitErr.code || ErrorCodes.INSUFFICIENT_BALANCE,
          completed_at: new Date().toISOString(),
        });
        await updateServiceOrder(orderId, {
          status: ServiceOrderStatus.FAILED,
        });
        await failIdempotencyRecord({
          key: idempotencyKey,
          userId,
          allowImmediateRetry: true,
          correlationId,
        });
        throw debitErr;
      }

      // Record audit event for successful debit
      await createAuditLog({
        id: randomUUID(),
        actor_id: userId,
        actor_role: 'CUSTOMER',
        action: AuditAction.VAS_PURCHASE_INITIATED,
        target_collection: 'serviceOrders',
        target_id: orderId,
        before_state: null,
        after_state: { amount_kobo: pricing.totalChargedKobo, service_category: serviceCategory },
        reason: `Wallet debited ${pricing.totalChargedKobo} kobo for ${serviceCategory}`,
        correlation_id: correlationId || `cor_${Date.now()}`,
        ip_address: null,
        created_at: now,
      });

      // Step 6: OUTBOUND PROVIDER DISPATCH (STRICTLY OUTSIDE FIRESTORE TRANSACTION)
      const providerTxId = randomUUID();
      const providerTxDoc: ProviderTransactionDocument = {
        id: providerTxId,
        transaction_id: orderId,
        service_order_id: orderId,
        provider_id: activeProviderId,
        provider_reference: null,
        request_endpoint: `/vas/${serviceCategory.toLowerCase()}/execute`,
        request_payload_safe: {
          orderId,
          recipient: config.recipientIdentifier,
          amountKobo: pricing.totalChargedKobo,
          planCode: config.providerPlanCode,
        },
        response_code: null,
        response_payload_safe: null,
        normalized_status: ProviderNormalizedStatus.PROCESSING,
        latency_ms: null,
        retry_attempt: 1,
        created_at: new Date().toISOString(),
        completed_at: null,
      };
      await createProviderTransaction(providerTxDoc);

      const providerResult = await providerAdapter.executeFulfillment({
        orderId,
        transactionReference,
        serviceCategory,
        recipientIdentifier: config.recipientIdentifier,
        amountKobo: pricing.totalChargedKobo,
        providerPlanCode: config.providerPlanCode,
        network: config.network,
        customerName: config.customerName,
        customerAddress: config.customerAddress,
        meterType: config.meterType,
        cablePackageName: config.cablePackageName,
        correlationId,
      });

      // Persist provider response
      await updateProviderTransaction(providerTxId, {
        provider_reference: providerResult.providerReference,
        response_code: providerResult.responseCode,
        response_payload_safe: providerResult.rawResponse,
        normalized_status: providerResult.normalizedStatus,
        latency_ms: providerResult.latencyMs,
        completed_at: new Date().toISOString(),
      });

      await updateServiceOrder(orderId, {
        provider_transaction_id: providerTxId,
      });

      // Step 7: OUTCOME HANDLING
      let finalStatus: TransactionStatus;
      let responseMessage: string;

      // ======================================================================
      // CASE 1: PROVIDER SUCCESSFUL FULFILLMENT
      // ======================================================================
      if (providerResult.normalizedStatus === ProviderNormalizedStatus.SUCCESS) {
        finalStatus = TransactionStatus.SUCCESSFUL;
        responseMessage = `${serviceCategory} purchase was successfully delivered.`;

        await updateServiceOrder(orderId, {
          status: ServiceOrderStatus.SUCCESSFUL,
        });

        if (serviceCategory === ServiceCategory.ELECTRICITY && providerResult.token) {
          await updateBillOrder(orderId, {
            sts_token: providerResult.token,
            token_units: providerResult.units || null,
            receipt_number: providerResult.receiptNumber || null,
          });
        }

        // Authoritatively recognize expected gross profit
        await updateTransaction(orderId, {
          status: TransactionStatus.SUCCESSFUL,
          gross_profit_kobo: pricing.economics.expected_gross_profit_kobo,
          provider_reference: providerResult.providerReference,
          completed_at: new Date().toISOString(),
        });

        await ProviderRouterService.recordProviderSuccess(activeProviderId, providerResult.latencyMs);

        // Record Audit
        await createAuditLog({
          id: randomUUID(),
          actor_id: `provider_${activeProviderId}`,
          actor_role: 'SYSTEM',
          action: AuditAction.VAS_FULFILLED,
          target_collection: 'serviceOrders',
          target_id: orderId,
          before_state: { status: 'PENDING' },
          after_state: {
            provider_reference: providerResult.providerReference,
            gross_profit_kobo: pricing.economics.expected_gross_profit_kobo,
          },
          reason: `Fulfillment confirmed by ${activeProviderId}`,
          correlation_id: correlationId || `cor_${Date.now()}`,
          ip_address: null,
          created_at: new Date().toISOString(),
        });

        // Isolated Notification
        try {
          const eventType = `VAS_${serviceCategory}_SUCCESS`;
          await NotificationService.dispatchNotification({
            userId,
            eventType,
            title: `${serviceCategory} Purchase Successful`,
            message: `Your ${serviceCategory} purchase of ₦${(pricing.faceValueKobo / 100).toFixed(2)} to ${config.recipientIdentifier} was delivered successfully.`,
            category: NotificationCategory.SERVICE_DELIVERY,
            amountKobo: pricing.totalChargedKobo,
            relatedTransactionReference: transactionReference,
            sourceEntityId: orderId,
            details: {
              network: config.network || (config as any).networkProvider,
              recipient: config.recipientIdentifier,
              disco: (config as any).disco,
              meterNumber: (config as any).meterNumber,
              customerName: config.customerName,
              units: providerResult.units,
              stsToken: providerResult.token,
              operator: (config as any).cableOperator,
              smartcard: (config as any).smartcardNumber,
              bouquet: (config as any).cableBouquetCode || config.cablePackageName,
            },
            correlationId,
          });
        } catch (notifErr: any) {
          logger.warn(`[VasPurchaseService] Notification failed for ${userId}: ${notifErr.message}`);
        }
      }
      // ======================================================================
      // CASE 2: DETERMINISTIC FAILURE (Confirmed Non-Delivery)
      // ======================================================================
      else if (providerResult.normalizedStatus === ProviderNormalizedStatus.FAILED) {
        finalStatus = TransactionStatus.REFUNDED;
        responseMessage = `Fulfillment failed at operator (${providerResult.errorMessage || 'Rejected'}). Amount refunded to wallet.`;

        await updateServiceOrder(orderId, {
          status: ServiceOrderStatus.FAILED,
        });

        // ATOMIC REFUND RESTORATION
        await refundWallet({
          userId,
          amountKobo: pricing.totalChargedKobo,
          originalTransactionId: orderId,
          originalTransactionReference: transactionReference,
          category: LedgerCategory.REFUND,
          description: `Auto-refund for failed ${serviceCategory} purchase: ${orderId}`,
          idempotencyKey: `refund_${orderId}`,
          actor: { type: 'SYSTEM', id: `provider_${activeProviderId}` },
          correlationId,
        });

        // Update transaction to REFUNDED with 0 gross profit
        await updateTransaction(orderId, {
          status: TransactionStatus.REFUNDED,
          gross_profit_kobo: 0 as IntegerKobo,
          failure_reason: providerResult.errorMessage || 'Provider fulfillment rejected',
          settlement_economics: {
            refund_amount_kobo: pricing.totalChargedKobo,
            reversal_amount_kobo: 0 as IntegerKobo,
            net_recognized_profit_kobo: 0 as IntegerKobo,
            settled_at: new Date().toISOString(),
          },
          completed_at: new Date().toISOString(),
        });

        await ProviderRouterService.recordProviderFailure(activeProviderId);

        // Record Audit
        await createAuditLog({
          id: randomUUID(),
          actor_id: `provider_${activeProviderId}`,
          actor_role: 'SYSTEM',
          action: AuditAction.VAS_FAILED,
          target_collection: 'serviceOrders',
          target_id: orderId,
          before_state: { status: 'PENDING' },
          after_state: { refund_amount_kobo: pricing.totalChargedKobo, status: 'FAILED' },
          reason: `Order failed and automatically refunded: ${providerResult.errorMessage}`,
          correlation_id: correlationId || `cor_${Date.now()}`,
          ip_address: null,
          created_at: new Date().toISOString(),
        });

        // Isolated Notification
        try {
          await NotificationService.dispatchNotification({
            userId,
            eventType: 'VAS_REFUND',
            title: `${serviceCategory} Purchase Refunded`,
            message: `Your ${serviceCategory} purchase could not be delivered. ₦${(pricing.totalChargedKobo / 100).toFixed(2)} has been refunded to your wallet.`,
            category: NotificationCategory.FINANCIAL,
            amountKobo: pricing.totalChargedKobo,
            relatedTransactionReference: transactionReference,
            sourceEntityId: orderId,
            details: {
              reason: providerResult.errorMessage || 'Provider fulfillment rejected',
            },
            correlationId,
          });
        } catch (notifErr: any) {
          logger.warn(`[VasPurchaseService] Notification failed for ${userId}: ${notifErr.message}`);
        }
      }
      // ======================================================================
      // CASE 3: TIMEOUT / UNKNOWN / NETWORK FAILURE
      // ======================================================================
      else {
        // NON-NEGOTIABLE: DO NOT REFUND! DO NOT SWITCH PROVIDERS!
        finalStatus = TransactionStatus.UNKNOWN;
        responseMessage = 'Order has been dispatched and is pending confirmation from operator network. Please check order status shortly.';

        await updateServiceOrder(orderId, {
          status: ServiceOrderStatus.PROCESSING,
        });

        await updateTransaction(orderId, {
          status: TransactionStatus.UNKNOWN,
          failure_reason: providerResult.errorMessage || 'Ambiguous provider response',
        });

        try {
          await NotificationService.dispatchNotification({
            userId,
            eventType: 'VAS_PROCESSING',
            title: `${serviceCategory} Order In Progress`,
            message: `Your ${serviceCategory} order is being processed by the operator. Please do not re-purchase while we confirm delivery.`,
            category: NotificationCategory.SERVICE_DELIVERY,
            amountKobo: pricing.totalChargedKobo,
            relatedTransactionReference: transactionReference,
            sourceEntityId: orderId,
            correlationId,
          });
        } catch (notifErr: any) {
          logger.warn(`[VasPurchaseService] Processing notification failed for ${userId}: ${notifErr.message}`);
        }

        logger.warn(`[VasPurchaseService] Order ${orderId} in UNKNOWN state. Scheduled for requery.`);
      }

      // Step 8: Build Response & Complete Idempotency Record
      const response: VasPurchaseResponse = {
        transaction_id: orderId,
        order_id: orderId,
        reference: transactionReference,
        service_category: serviceCategory,
        recipient_identifier: config.recipientIdentifier,
        face_value_kobo: pricing.faceValueKobo,
        total_charged_kobo: pricing.totalChargedKobo,
        discount_kobo: pricing.economics.discount_kobo,
        fee_kobo: (pricing.product.service_fee_kobo || 0) as IntegerKobo,
        status: finalStatus,
        provider: activeProviderId,
        operator_reference: providerResult.operatorReference || null,
        token: providerResult.token || null,
        units: providerResult.units || null,
        receipt_number: providerResult.receiptNumber || null,
        message: responseMessage,
      };

      await completeIdempotencyRecord({
        key: idempotencyKey,
        userId,
        responseCode: 200,
        responseBody: response as unknown as Record<string, unknown>,
        referenceId: orderId,
        referenceType: 'SERVICE_ORDER',
        correlationId,
      });
      return response;
    });
  }
}
