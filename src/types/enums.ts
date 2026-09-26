/**
 * Alexvya Platform — Locked Domain Enums & Const Types
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Source of truth: Locked Stage 1.1, 1.2, 1.3, 1.4 & 1.5 Architecture Specifications
 */

// ============================================================================
// 1. IDENTITY & ROLES (Locked Stage 1.3 Baseline)
// ============================================================================

/**
 * Authoritative Application User Roles
 * STRICT INVARIANT: CUSTOMER is the default user role.
 * Privileged roles: ADMIN, SUPER_ADMIN, AUDITOR, SYSTEM.
 */
export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  AUDITOR: 'AUDITOR',
  SYSTEM: 'SYSTEM',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/**
 * Backward compatibility alias for Stage 2.3 references.
 * Automatically normalizes 'USER' to 'CUSTOMER'.
 */
export type Role = UserRole;

export function normalizeUserRole(role: string | undefined | null): UserRole {
  if (!role) return UserRole.CUSTOMER;
  const upper = role.toUpperCase();
  if (upper === 'USER' || upper === 'CUSTOMER') return UserRole.CUSTOMER;
  if (upper === 'ADMIN') return UserRole.ADMIN;
  if (upper === 'SUPER_ADMIN') return UserRole.SUPER_ADMIN;
  if (upper === 'AUDITOR') return UserRole.AUDITOR;
  if (upper === 'SYSTEM') return UserRole.SYSTEM;
  return UserRole.CUSTOMER;
}

/**
 * Account operational lifecycle status
 */
export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  FROZEN: 'FROZEN',
  CLOSED: 'CLOSED',
} as const;

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/**
 * KYC Verification Tiers
 */
export const KycTier = {
  TIER_1: 'TIER_1',
  TIER_2: 'TIER_2',
  TIER_3: 'TIER_3',
} as const;

export type KycTier = (typeof KycTier)[keyof typeof KycTier];

/**
 * KYC Verification Lifecycle Statuses (Locked Stage 2.12 Specification)
 */
export const KycStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING_REVIEW: 'PENDING_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  REQUIRES_ACTION: 'REQUIRES_ACTION',
} as const;

export type KycStatus = (typeof KycStatus)[keyof typeof KycStatus];

/**
 * Supported Identity Verification Methods
 */
export const KycVerificationMethod = {
  BVN: 'BVN',
  NIN: 'NIN',
  GOVERNMENT_ID: 'GOVERNMENT_ID',
  UTILITY_BILL: 'UTILITY_BILL',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
} as const;

export type KycVerificationMethod = (typeof KycVerificationMethod)[keyof typeof KycVerificationMethod];

/**
 * Standardized KYC Rejection Reason Codes
 */
export const KycRejectionReasonCode = {
  NAME_MISMATCH: 'NAME_MISMATCH',
  INVALID_DOCUMENT: 'INVALID_DOCUMENT',
  UNSUPPORTED_DOCUMENT: 'UNSUPPORTED_DOCUMENT',
  SUSPECTED_FRAUD: 'SUSPECTED_FRAUD',
  EXPIRED_DOCUMENT: 'EXPIRED_DOCUMENT',
  INCOMPLETE_INFORMATION: 'INCOMPLETE_INFORMATION',
  OTHER: 'OTHER',
} as const;

export type KycRejectionReasonCode = (typeof KycRejectionReasonCode)[keyof typeof KycRejectionReasonCode];


// ============================================================================
// 2. WALLET & FINANCIAL JOURNAL ENUMS
// ============================================================================

export const WalletStatus = {
  ACTIVE: 'ACTIVE',
  LOCKED: 'LOCKED',
  FROZEN: 'FROZEN',
} as const;

export type WalletStatus = (typeof WalletStatus)[keyof typeof WalletStatus];

export const LedgerEntryType = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;

export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];

export const LedgerDirection = {
  INFLOW: 'INFLOW',
  OUTFLOW: 'OUTFLOW',
} as const;

export type LedgerDirection = (typeof LedgerDirection)[keyof typeof LedgerDirection];

export const LedgerCategory = {
  WALLET_FUNDING: 'WALLET_FUNDING',
  AIRTIME_PURCHASE: 'AIRTIME_PURCHASE',
  DATA_PURCHASE: 'DATA_PURCHASE',
  ELECTRICITY_BILL: 'ELECTRICITY_BILL',
  CABLE_TV: 'CABLE_TV',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
  ADMIN_CREDIT: 'ADMIN_CREDIT',
  ADMIN_DEBIT: 'ADMIN_DEBIT',
} as const;

export type LedgerCategory = (typeof LedgerCategory)[keyof typeof LedgerCategory];

// ============================================================================
// 3. TRANSACTIONS & PAYMENTS
// ============================================================================

export const TransactionType = {
  WALLET_FUNDING: 'WALLET_FUNDING',
  AIRTIME_PURCHASE: 'AIRTIME_PURCHASE',
  DATA_PURCHASE: 'DATA_PURCHASE',
  ELECTRICITY_BILL: 'ELECTRICITY_BILL',
  CABLE_TV: 'CABLE_TV',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
} as const;

export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const TransactionStatus = {
  INITIATED: 'INITIATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
  REFUNDED: 'REFUNDED',
  REVERSED: 'REVERSED',
} as const;

export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

export const PaymentGateway = {
  PAYSTACK: 'PAYSTACK',
} as const;

export type PaymentGateway = (typeof PaymentGateway)[keyof typeof PaymentGateway];

export const PaymentAttemptStatus = {
  PENDING: 'PENDING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  ABANDONED: 'ABANDONED',
} as const;

export type PaymentAttemptStatus = (typeof PaymentAttemptStatus)[keyof typeof PaymentAttemptStatus];

export const PaymentChannel = {
  CARD: 'CARD',
  BANK_TRANSFER: 'BANK_TRANSFER',
  USSD: 'USSD',
  QR: 'QR',
} as const;

export type PaymentChannel = (typeof PaymentChannel)[keyof typeof PaymentChannel];

export const VerificationSource = {
  WEBHOOK: 'WEBHOOK',
  SERVER_POLL: 'SERVER_POLL',
  CLIENT_CALLBACK_VERIFY: 'CLIENT_CALLBACK_VERIFY',
} as const;

export type VerificationSource = (typeof VerificationSource)[keyof typeof VerificationSource];

// ============================================================================
// 4. VAS & SERVICE ORDERS
// ============================================================================

export const ServiceCategory = {
  AIRTIME: 'AIRTIME',
  DATA: 'DATA',
  ELECTRICITY: 'ELECTRICITY',
  CABLE_TV: 'CABLE_TV',
} as const;

export type ServiceCategory = (typeof ServiceCategory)[keyof typeof ServiceCategory];

export const ServiceOrderStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;

export type ServiceOrderStatus = (typeof ServiceOrderStatus)[keyof typeof ServiceOrderStatus];

export const NetworkProvider = {
  MTN: 'MTN',
  AIRTEL: 'AIRTEL',
  GLO: 'GLO',
  '9MOBILE': '9MOBILE',
} as const;

export type NetworkProvider = (typeof NetworkProvider)[keyof typeof NetworkProvider];

export const AirtimeType = {
  VTU: 'VTU',
  SHARE_N_SELL: 'SHARE_N_SELL',
} as const;

export type AirtimeType = (typeof AirtimeType)[keyof typeof AirtimeType];

export const DataPlanType = {
  SME: 'SME',
  CORPORATE_GIFTING: 'CORPORATE_GIFTING',
  DIRECT: 'DIRECT',
} as const;

export type DataPlanType = (typeof DataPlanType)[keyof typeof DataPlanType];

export const BillCategory = {
  ELECTRICITY: 'ELECTRICITY',
  CABLE_TV: 'CABLE_TV',
} as const;

export type BillCategory = (typeof BillCategory)[keyof typeof BillCategory];

export const MeterType = {
  PREPAID: 'PREPAID',
  POSTPAID: 'POSTPAID',
} as const;

export type MeterType = (typeof MeterType)[keyof typeof MeterType];

// ============================================================================
// 5. EXTERNAL PROVIDERS & WEBHOOKS
// ============================================================================

export const ProviderId = {
  PAYSTACK: 'paystack',
  VTPASS: 'vtpass',
  CLUBKONNECT: 'clubkonnect',
  INTERNAL: 'internal',
} as const;

export type ProviderId = (typeof ProviderId)[keyof typeof ProviderId];

export const ProviderStatus = {
  ACTIVE: 'ACTIVE',
  DEGRADED: 'DEGRADED',
  MAINTENANCE: 'MAINTENANCE',
  DISABLED: 'DISABLED',
} as const;

export type ProviderStatus = (typeof ProviderStatus)[keyof typeof ProviderStatus];

export const ProviderNormalizedStatus = {
  ACCEPTED: 'ACCEPTED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
  REFUNDED: 'REFUNDED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ProviderNormalizedStatus = (typeof ProviderNormalizedStatus)[keyof typeof ProviderNormalizedStatus];

export const WebhookProcessingStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PROCESSED: 'PROCESSED',
  IGNORED: 'IGNORED',
  FAILED: 'FAILED',
} as const;

export type WebhookProcessingStatus = (typeof WebhookProcessingStatus)[keyof typeof WebhookProcessingStatus];

// ============================================================================
// 6. NOTIFICATIONS & AUDIT LOGS & IDEMPOTENCY
// ============================================================================

export const NotificationCategory = {
  FINANCIAL: 'FINANCIAL',
  SERVICE_DELIVERY: 'SERVICE_DELIVERY',
  SECURITY: 'SECURITY',
  SYSTEM: 'SYSTEM',
} as const;

export type NotificationCategory = (typeof NotificationCategory)[keyof typeof NotificationCategory];

export const AdminRole = {
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  AUDITOR: 'AUDITOR',
} as const;

export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const AuditAction = {
  ROLE_CHANGE: 'ROLE_CHANGE',
  WALLET_ADJUSTMENT: 'WALLET_ADJUSTMENT',
  REFUND_PROCESSED: 'REFUND_PROCESSED',
  PRICE_UPDATE: 'PRICE_UPDATE',
  PROVIDER_STATUS_CHANGE: 'PROVIDER_STATUS_CHANGE',
  USER_SUSPENDED: 'USER_SUSPENDED',
  WEBHOOK_RETRY: 'WEBHOOK_RETRY',
  VAS_PURCHASE_INITIATED: 'VAS_PURCHASE_INITIATED',
  VAS_FULFILLED: 'VAS_FULFILLED',
  VAS_FAILED: 'VAS_FAILED',
  VAS_REQUERY: 'VAS_REQUERY',
  KYC_STARTED: 'KYC_STARTED',
  KYC_SUBMITTED: 'KYC_SUBMITTED',
  KYC_APPROVED: 'KYC_APPROVED',
  KYC_REJECTED: 'KYC_REJECTED',
  KYC_ACTION_REQUIRED: 'KYC_ACTION_REQUIRED',
  TIER_UPGRADE_REQUESTED: 'TIER_UPGRADE_REQUESTED',
  TIER_CHANGED: 'TIER_CHANGED',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const IdempotencyStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type IdempotencyStatus = (typeof IdempotencyStatus)[keyof typeof IdempotencyStatus];
