/**
 * Alexvya Platform — Strongly Typed Firestore Document Schemas
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Defines TypeScript document interfaces for all 17 locked Firestore collections/subcollections:
 * 1.  users/{userId}
 * 2.  wallets/{userId}
 * 3.  wallets/{userId}/ledger/{ledgerId}
 * 4.  transactions/{transactionId}
 * 5.  paymentAttempts/{paymentAttemptId}
 * 6.  serviceOrders/{orderId}
 * 7.  airtimeOrders/{orderId}
 * 8.  dataOrders/{orderId}
 * 9.  billOrders/{orderId}
 * 10. serviceProducts/{productId}
 * 11. providers/{providerId}
 * 12. providerTransactions/{providerTransactionId}
 * 13. webhookEvents/{webhookEventId}
 * 14. notifications/{notificationId}
 * 15. adminUsers/{userId}
 * 16. auditLogs/{auditLogId}
 * 17. idempotencyKeys/{idempotencyKey}
 */

import {
  UserRole,
  AccountStatus,
  KycTier,
  WalletStatus,
  LedgerEntryType,
  LedgerDirection,
  LedgerCategory,
  TransactionType,
  TransactionStatus,
  PaymentGateway,
  PaymentAttemptStatus,
  PaymentChannel,
  VerificationSource,
  ServiceCategory,
  ServiceOrderStatus,
  NetworkProvider,
  AirtimeType,
  DataPlanType,
  BillCategory,
  MeterType,
  ProviderId,
  ProviderStatus,
  ProviderNormalizedStatus,
  WebhookProcessingStatus,
  NotificationCategory,
  AdminRole,
  AuditAction,
  IdempotencyStatus,
} from './enums.ts';
import { IntegerKobo } from './money.ts';

/**
 * Standard representation of a timestamp in the domain model.
 * Persisted as Firestore Timestamp (or ISO-8601 string during serialization).
 */
export type FirestoreTimestamp = any; // FirebaseFirestore.Timestamp or Serialized string

// ============================================================================
// 1. users/{userId}
// ============================================================================
export interface NotificationPreferences {
  email_on_wallet_credit: boolean;
  email_on_purchase: boolean;
}

export interface UserDocument {
  id: string; // Firebase Auth UID
  uid?: string;
  email: string;
  email_verified: boolean;
  phone_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  photo_url?: string | null;
  account_status: AccountStatus;
  role: UserRole; // Default: CUSTOMER
  tier?: KycTier; // TIER_1, TIER_2, TIER_3
  kyc_tier: number; // 1, 2, 3
  daily_funding_limit_kobo: IntegerKobo; // default 5000000
  notification_preferences: NotificationPreferences;
  auth_provider?: string;
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
  last_login_at?: FirestoreTimestamp;
}

// ============================================================================
// 2. wallets/{userId}
// ============================================================================
export interface WalletDocument {
  id: string; // Auth UID
  user_id: string;
  currency: 'NGN';
  available_balance_kobo: IntegerKobo;
  ledger_balance_kobo: IntegerKobo;
  locked_balance_kobo: IntegerKobo;
  status: WalletStatus;
  daily_spent_kobo: IntegerKobo;
  last_ledger_entry_id: string | null;
  version: number;
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
}

// ============================================================================
// 3. wallets/{userId}/ledger/{ledgerId}
// ============================================================================
export type LedgerActorType = 'SYSTEM' | 'ADMIN' | 'SUPER_ADMIN' | 'AUDITOR' | 'USER' | 'CUSTOMER';

export interface LedgerActor {
  type: LedgerActorType;
  id: string;
}

export interface LedgerDocument {
  id: string; // UUIDv4 or ULID
  wallet_id: string;
  user_id: string;
  transaction_id: string;
  transaction_reference: string;
  entry_type: LedgerEntryType; // CREDIT | DEBIT
  direction: LedgerDirection; // INFLOW | OUTFLOW
  amount_kobo: IntegerKobo; // Absolute > 0
  balance_before_kobo: IntegerKobo;
  balance_after_kobo: IntegerKobo;
  category: LedgerCategory;
  description: string;
  actor: LedgerActor;
  created_at: FirestoreTimestamp;
}

// ============================================================================
// 4. transactions/{transactionId}
// ============================================================================
export interface OriginalEconomics {
  total_charged_kobo: IntegerKobo;
  provider_cost_kobo: IntegerKobo;
  markup_kobo: IntegerKobo;
  discount_kobo: IntegerKobo;
  expected_gross_profit_kobo: IntegerKobo;
  pricing_rule_version: string;
}

export interface SettlementEconomics {
  refund_amount_kobo: IntegerKobo;
  reversal_amount_kobo: IntegerKobo;
  net_recognized_profit_kobo: IntegerKobo;
  settled_at: FirestoreTimestamp;
}

export interface TransactionDocument {
  id: string; // UUIDv4
  reference: string; // ALX-...
  user_id: string;
  user_email_snapshot: string;
  type: TransactionType;
  status: TransactionStatus;
  currency: 'NGN';
  amount_kobo: IntegerKobo;
  fee_kobo: IntegerKobo;
  discount_kobo: IntegerKobo;
  total_charged_kobo: IntegerKobo;
  provider_cost_kobo: IntegerKobo | null;
  gross_profit_kobo: IntegerKobo | null;
  original_economics?: OriginalEconomics;
  settlement_economics?: SettlementEconomics;
  provider: ProviderId | null;
  provider_reference: string | null;
  idempotency_key: string;
  service_details: Record<string, unknown>;
  failure_reason: string | null;
  internal_error_code: string | null;
  created_at: FirestoreTimestamp;
  completed_at: FirestoreTimestamp | null;
}

// ============================================================================
// 5. paymentAttempts/{paymentAttemptId}
// ============================================================================
export interface PaymentAttemptDocument {
  id: string; // UUIDv4
  transaction_id: string;
  transaction_reference: string;
  user_id: string;
  payment_gateway: PaymentGateway; // PAYSTACK
  gateway_reference: string;
  amount_kobo: IntegerKobo;
  gateway_fee_kobo: IntegerKobo;
  status: PaymentAttemptStatus;
  authorization_url: string | null;
  access_code: string | null;
  channel: PaymentChannel | null;
  ip_address: string | null;
  verified_at: FirestoreTimestamp | null;
  verification_source: VerificationSource | null;
  created_at: FirestoreTimestamp;
  expires_at: FirestoreTimestamp;
}

// ============================================================================
// 6. serviceOrders/{orderId}
// ============================================================================
export interface ServiceOrderDocument {
  id: string; // matches transactionId
  transaction_reference: string;
  user_id: string;
  service_category: ServiceCategory;
  status: ServiceOrderStatus;
  product_id: string;
  product_name_snapshot: string;
  recipient_identifier: string;
  face_value_kobo: IntegerKobo;
  amount_debited_kobo: IntegerKobo;
  active_provider: ProviderId;
  provider_transaction_id: string | null;
  retry_count: number;
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
}

// ============================================================================
// 7. airtimeOrders/{orderId}
// ============================================================================
export interface AirtimeOrderDocument {
  id: string; // matches orderId
  service_order_id: string;
  network: NetworkProvider;
  phone_number: string;
  airtime_type: AirtimeType;
  operator_reference: string | null;
  created_at: FirestoreTimestamp;
}

// ============================================================================
// 8. dataOrders/{orderId}
// ============================================================================
export interface DataOrderDocument {
  id: string; // matches orderId
  service_order_id: string;
  network: NetworkProvider;
  phone_number: string;
  data_plan_type: DataPlanType;
  data_volume_mb: number;
  validity_days: number;
  provider_plan_code: string;
  created_at: FirestoreTimestamp;
}

// ============================================================================
// 9. billOrders/{orderId}
// ============================================================================
export interface BillOrderDocument {
  id: string; // matches orderId
  service_order_id: string;
  bill_category: BillCategory;
  provider_code: string;
  customer_identifier: string; // Meter or IUC
  customer_name: string;
  customer_address: string | null;
  meter_type: MeterType | null;
  sts_token: string | null;
  token_units: string | null;
  cable_package_name: string | null;
  receipt_number: string | null;
  created_at: FirestoreTimestamp;
}

// ============================================================================
// 10. serviceProducts/{productId}
// ============================================================================
export interface ServiceProductDocument {
  id: string; // prod_...
  category: ServiceCategory;
  sub_category: string;
  name: string;
  description: string | null;
  face_value_kobo: IntegerKobo;
  provider_cost_kobo: IntegerKobo;
  selling_price_kobo: IntegerKobo;
  discount_percentage: number;
  service_fee_kobo: IntegerKobo;
  is_active: boolean;
  min_amount_kobo: IntegerKobo;
  max_amount_kobo: IntegerKobo;
  provider_mappings: Record<string, string>;
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
}

// ============================================================================
// 11. providers/{providerId}
// ============================================================================
export interface ProviderDocument {
  id: string; // vtpass, clubkonnect, paystack
  display_name: string;
  status: ProviderStatus;
  supported_services: ServiceCategory[];
  current_balance_kobo: IntegerKobo | null;
  success_rate_24h: number;
  avg_latency_ms: number;
  circuit_breaker_open: boolean;
  consecutive_failures: number;
  last_health_check_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
}

// ============================================================================
// 12. providerTransactions/{providerTransactionId}
// ============================================================================
export interface ProviderTransactionDocument {
  id: string; // UUIDv4
  transaction_id: string;
  service_order_id: string;
  provider_id: ProviderId;
  provider_reference: string | null;
  request_endpoint: string;
  request_payload_safe: Record<string, unknown>;
  response_code: number | null;
  response_payload_safe: Record<string, unknown> | null;
  normalized_status: ProviderNormalizedStatus;
  latency_ms: number | null;
  retry_attempt: number;
  created_at: FirestoreTimestamp;
  completed_at: FirestoreTimestamp | null;
}

// ============================================================================
// 13. webhookEvents/{webhookEventId}
// ============================================================================
export interface WebhookEventDocument {
  id: string; // hash(provider + event_id + reference)
  provider: ProviderId;
  event_type: string;
  external_event_id: string | null;
  signature_verified: boolean;
  processing_status: WebhookProcessingStatus;
  processing_attempts: number;
  related_transaction_id: string | null;
  payload_safe: Record<string, unknown>;
  error_message: string | null;
  received_at: FirestoreTimestamp;
  processed_at: FirestoreTimestamp | null;
}

// ============================================================================
// 14. notifications/{notificationId}
// ============================================================================
export interface NotificationDocument {
  id: string; // UUIDv4 or ULID
  user_id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  is_read: boolean;
  related_transaction_reference: string | null;
  email_sent: boolean;
  created_at: FirestoreTimestamp;
}

// ============================================================================
// 15. adminUsers/{userId}
// ============================================================================
export interface AdminUserDocument {
  id: string; // Auth UID
  email: string;
  role: AdminRole;
  is_active: boolean;
  assigned_by: string; // Super Admin UID
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
}

// ============================================================================
// 16. auditLogs/{auditLogId}
// ============================================================================
export interface AuditLogDocument {
  id: string; // UUIDv4 or ULID
  actor_id: string;
  actor_role: string;
  action: AuditAction;
  target_collection: string;
  target_id: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string;
  correlation_id: string;
  ip_address: string | null;
  created_at: FirestoreTimestamp;
}

// ============================================================================
// 17. idempotencyKeys/{idempotencyKey}
// ============================================================================
export interface IdempotencyKeyDocument {
  id: string; // Key string (UUIDv4 or client-provided unique key)
  user_id: string;
  request_path: string;
  request_hash: string;
  status: IdempotencyStatus;
  reference_id?: string | null; // Associated orderId, transactionId, refundRef, etc.
  reference_type?: string | null; // 'SERVICE_ORDER', 'WALLET_TRANSACTION', 'REFUND', etc.
  response_code: number | null;
  response_body: Record<string, unknown> | null;
  created_at: FirestoreTimestamp;
  expires_at: FirestoreTimestamp;
  updated_at?: FirestoreTimestamp | null;
}
