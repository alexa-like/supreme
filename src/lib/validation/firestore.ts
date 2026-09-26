/**
 * Alexvya Platform — Firestore Document Validation Schemas
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Validates document structures across all 17 locked Firestore collections:
 * 1.  users
 * 2.  wallets
 * 3.  wallets/{userId}/ledger
 * 4.  transactions
 * 5.  paymentAttempts
 * 6.  serviceOrders
 * 7.  airtimeOrders
 * 8.  dataOrders
 * 9.  billOrders
 * 10. serviceProducts
 * 11. providers
 * 12. providerTransactions
 * 13. webhookEvents
 * 14. notifications
 * 15. adminUsers
 * 16. auditLogs
 * 17. idempotencyKeys
 */

import { z } from 'zod';
import {
  userRoleSchema,
  accountStatusSchema,
  kycTierSchema,
  walletStatusSchema,
  ledgerEntryTypeSchema,
  ledgerDirectionSchema,
  ledgerCategorySchema,
  transactionTypeSchema,
  transactionStatusSchema,
  paymentGatewaySchema,
  paymentAttemptStatusSchema,
  paymentChannelSchema,
  verificationSourceSchema,
  serviceCategorySchema,
  serviceOrderStatusSchema,
  networkProviderSchema,
  airtimeTypeSchema,
  dataPlanTypeSchema,
  billCategorySchema,
  meterTypeSchema,
  providerIdSchema,
  providerStatusSchema,
  providerNormalizedStatusSchema,
  webhookProcessingStatusSchema,
  notificationCategorySchema,
  adminRoleSchema,
  auditActionSchema,
  idempotencyStatusSchema,
} from './enums.ts';
import { koboSchema, positiveKoboSchema, currencySchema, bpsSchema } from './money.ts';

// Timestamp validator (accepts string ISO date, number ms, or Firestore Timestamp object)
const timestampSchema = z.union([
  z.string().datetime(),
  z.number(),
  z.object({
    seconds: z.number(),
    nanoseconds: z.number(),
  }),
  z.any(),
]);

// ============================================================================
// 1. users/{userId}
// ============================================================================
export const notificationPreferencesSchema = z.object({
  email_on_wallet_credit: z.boolean().default(true),
  email_on_purchase: z.boolean().default(true),
});

export const userDocumentSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().default(false),
  phone_number: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  photo_url: z.string().url().nullable().optional(),
  account_status: accountStatusSchema.default('ACTIVE'),
  role: userRoleSchema.default('CUSTOMER'),
  tier: kycTierSchema.optional().default('TIER_1'),
  kyc_tier: z.number().int().min(1).max(3).default(1),
  daily_funding_limit_kobo: koboSchema.default(5000000),
  notification_preferences: notificationPreferencesSchema.default({
    email_on_wallet_credit: true,
    email_on_purchase: true,
  }),
  auth_provider: z.string().optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  last_login_at: timestampSchema.optional(),
});

// ============================================================================
// 2. wallets/{userId}
// ============================================================================
export const walletDocumentSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  currency: currencySchema.default('NGN'),
  available_balance_kobo: koboSchema.default(0),
  ledger_balance_kobo: koboSchema.default(0),
  locked_balance_kobo: koboSchema.default(0),
  status: walletStatusSchema.default('ACTIVE'),
  daily_spent_kobo: koboSchema.default(0),
  last_ledger_entry_id: z.string().nullable().optional(),
  version: z.number().int().min(1).default(1),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

// ============================================================================
// 3. wallets/{userId}/ledger/{ledgerId}
// ============================================================================
export const ledgerActorSchema = z.object({
  type: z.enum(['SYSTEM', 'ADMIN', 'SUPER_ADMIN', 'AUDITOR', 'USER', 'CUSTOMER']),
  id: z.string().min(1),
});

export const ledgerDocumentSchema = z.object({
  id: z.string().min(1),
  wallet_id: z.string().min(1),
  user_id: z.string().min(1),
  transaction_id: z.string().min(1),
  transaction_reference: z.string().min(1),
  entry_type: ledgerEntryTypeSchema,
  direction: ledgerDirectionSchema,
  amount_kobo: positiveKoboSchema,
  balance_before_kobo: koboSchema,
  balance_after_kobo: koboSchema,
  category: ledgerCategorySchema,
  description: z.string().min(1),
  actor: ledgerActorSchema,
  created_at: timestampSchema,
});

// ============================================================================
// 4. transactions/{transactionId}
// ============================================================================
export const originalEconomicsSchema = z.object({
  total_charged_kobo: koboSchema,
  provider_cost_kobo: koboSchema,
  markup_kobo: z.number().int(),
  discount_kobo: koboSchema,
  expected_gross_profit_kobo: z.number().int(),
  pricing_rule_version: z.string(),
});

export const settlementEconomicsSchema = z.object({
  refund_amount_kobo: koboSchema,
  reversal_amount_kobo: koboSchema,
  net_recognized_profit_kobo: z.number().int(),
  settled_at: timestampSchema,
});

export const transactionDocumentSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  user_id: z.string().min(1),
  user_email_snapshot: z.string().email(),
  type: transactionTypeSchema,
  status: transactionStatusSchema.default('INITIATED'),
  currency: currencySchema.default('NGN'),
  amount_kobo: positiveKoboSchema,
  fee_kobo: koboSchema.default(0),
  discount_kobo: koboSchema.default(0),
  total_charged_kobo: koboSchema,
  provider_cost_kobo: koboSchema.nullable().optional(),
  gross_profit_kobo: z.number().int().nullable().optional(), // Can be negative during edge cases
  original_economics: originalEconomicsSchema.optional(),
  settlement_economics: settlementEconomicsSchema.optional(),
  provider: providerIdSchema.nullable().optional(),
  provider_reference: z.string().nullable().optional(),
  idempotency_key: z.string().min(1),
  service_details: z.record(z.string(), z.unknown()).default({}),
  failure_reason: z.string().nullable().optional(),
  internal_error_code: z.string().nullable().optional(),
  created_at: timestampSchema,
  completed_at: timestampSchema.nullable().optional(),
});

// ============================================================================
// 5. paymentAttempts/{paymentAttemptId}
// ============================================================================
export const paymentAttemptDocumentSchema = z.object({
  id: z.string().min(1),
  transaction_id: z.string().min(1),
  transaction_reference: z.string().min(1),
  user_id: z.string().min(1),
  payment_gateway: paymentGatewaySchema.default('PAYSTACK'),
  gateway_reference: z.string().min(1),
  amount_kobo: positiveKoboSchema,
  gateway_fee_kobo: koboSchema.default(0),
  status: paymentAttemptStatusSchema.default('PENDING'),
  authorization_url: z.string().url().nullable().optional(),
  access_code: z.string().nullable().optional(),
  channel: paymentChannelSchema.nullable().optional(),
  ip_address: z.string().nullable().optional(),
  verified_at: timestampSchema.nullable().optional(),
  verification_source: verificationSourceSchema.nullable().optional(),
  created_at: timestampSchema,
  expires_at: timestampSchema,
});

// ============================================================================
// 6. serviceOrders/{orderId}
// ============================================================================
export const serviceOrderDocumentSchema = z.object({
  id: z.string().min(1),
  transaction_reference: z.string().min(1),
  user_id: z.string().min(1),
  service_category: serviceCategorySchema,
  status: serviceOrderStatusSchema.default('PENDING'),
  product_id: z.string().min(1),
  product_name_snapshot: z.string().min(1),
  recipient_identifier: z.string().min(1),
  face_value_kobo: positiveKoboSchema,
  amount_debited_kobo: positiveKoboSchema,
  active_provider: providerIdSchema,
  provider_transaction_id: z.string().nullable().optional(),
  retry_count: z.number().int().min(0).default(0),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

// ============================================================================
// 7. airtimeOrders/{orderId}
// ============================================================================
export const airtimeOrderDocumentSchema = z.object({
  id: z.string().min(1),
  service_order_id: z.string().min(1),
  network: networkProviderSchema,
  phone_number: z.string().min(1),
  airtime_type: airtimeTypeSchema.default('VTU'),
  operator_reference: z.string().nullable().optional(),
  created_at: timestampSchema,
});

// ============================================================================
// 8. dataOrders/{orderId}
// ============================================================================
export const dataOrderDocumentSchema = z.object({
  id: z.string().min(1),
  service_order_id: z.string().min(1),
  network: networkProviderSchema,
  phone_number: z.string().min(1),
  data_plan_type: dataPlanTypeSchema,
  data_volume_mb: z.number().int().positive(),
  validity_days: z.number().int().positive(),
  provider_plan_code: z.string().min(1),
  created_at: timestampSchema,
});

// ============================================================================
// 9. billOrders/{orderId}
// ============================================================================
export const billOrderDocumentSchema = z.object({
  id: z.string().min(1),
  service_order_id: z.string().min(1),
  bill_category: billCategorySchema,
  provider_code: z.string().min(1),
  customer_identifier: z.string().min(1),
  customer_name: z.string().min(1),
  customer_address: z.string().nullable().optional(),
  meter_type: meterTypeSchema.nullable().optional(),
  sts_token: z.string().nullable().optional(),
  token_units: z.string().nullable().optional(),
  cable_package_name: z.string().nullable().optional(),
  receipt_number: z.string().nullable().optional(),
  created_at: timestampSchema,
});

// ============================================================================
// 10. serviceProducts/{productId}
// ============================================================================
export const serviceProductDocumentSchema = z.object({
  id: z.string().min(1),
  category: serviceCategorySchema,
  sub_category: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  face_value_kobo: koboSchema.default(0),
  provider_cost_kobo: koboSchema.default(0),
  selling_price_kobo: koboSchema.default(0),
  discount_percentage: z.number().min(0).max(100).default(0),
  service_fee_kobo: koboSchema.default(0),
  is_active: z.boolean().default(true),
  min_amount_kobo: koboSchema.default(5000),
  max_amount_kobo: koboSchema.default(5000000),
  provider_mappings: z.record(z.string(), z.string()).default({}),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

// ============================================================================
// 11. providers/{providerId}
// ============================================================================
export const providerDocumentSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().min(1),
  status: providerStatusSchema.default('ACTIVE'),
  supported_services: z.array(serviceCategorySchema).default([]),
  current_balance_kobo: koboSchema.nullable().optional(),
  success_rate_24h: z.number().min(0).max(100).default(100.0),
  avg_latency_ms: z.number().int().min(0).default(0),
  circuit_breaker_open: z.boolean().default(false),
  consecutive_failures: z.number().int().min(0).default(0),
  last_health_check_at: timestampSchema,
  updated_at: timestampSchema,
});

// ============================================================================
// 12. providerTransactions/{providerTransactionId}
// ============================================================================
export const providerTransactionDocumentSchema = z.object({
  id: z.string().min(1),
  transaction_id: z.string().min(1),
  service_order_id: z.string().min(1),
  provider_id: providerIdSchema,
  provider_reference: z.string().nullable().optional(),
  request_endpoint: z.string().min(1),
  request_payload_safe: z.record(z.string(), z.unknown()),
  response_code: z.number().int().nullable().optional(),
  response_payload_safe: z.record(z.string(), z.unknown()).nullable().optional(),
  normalized_status: providerNormalizedStatusSchema.default('PENDING'),
  latency_ms: z.number().int().nullable().optional(),
  retry_attempt: z.number().int().min(1).default(1),
  created_at: timestampSchema,
  completed_at: timestampSchema.nullable().optional(),
});

// ============================================================================
// 13. webhookEvents/{webhookEventId}
// ============================================================================
export const webhookEventDocumentSchema = z.object({
  id: z.string().min(1),
  provider: providerIdSchema,
  event_type: z.string().min(1),
  external_event_id: z.string().nullable().optional(),
  signature_verified: z.boolean().default(true),
  processing_status: webhookProcessingStatusSchema.default('PENDING'),
  processing_attempts: z.number().int().min(0).default(0),
  related_transaction_id: z.string().nullable().optional(),
  payload_safe: z.record(z.string(), z.unknown()),
  error_message: z.string().nullable().optional(),
  received_at: timestampSchema,
  processed_at: timestampSchema.nullable().optional(),
});

// ============================================================================
// 14. notifications/{notificationId}
// ============================================================================
export const notificationDocumentSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  category: notificationCategorySchema,
  is_read: z.boolean().default(false),
  related_transaction_reference: z.string().nullable().optional(),
  email_sent: z.boolean().default(false),
  created_at: timestampSchema,
});

// ============================================================================
// 15. adminUsers/{userId}
// ============================================================================
export const adminUserDocumentSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: adminRoleSchema,
  is_active: z.boolean().default(true),
  assigned_by: z.string().min(1),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

// ============================================================================
// 16. auditLogs/{auditLogId}
// ============================================================================
export const auditLogDocumentSchema = z.object({
  id: z.string().min(1),
  actor_id: z.string().min(1),
  actor_role: z.string().min(1),
  action: auditActionSchema,
  target_collection: z.string().min(1),
  target_id: z.string().min(1),
  before_state: z.record(z.string(), z.unknown()).nullable().optional(),
  after_state: z.record(z.string(), z.unknown()).nullable().optional(),
  reason: z.string().min(1),
  correlation_id: z.string().min(1),
  ip_address: z.string().nullable().optional(),
  created_at: timestampSchema,
});

// ============================================================================
// 17. idempotencyKeys/{idempotencyKey}
// ============================================================================
export const idempotencyKeyDocumentSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  request_path: z.string().min(1),
  request_hash: z.string().min(1),
  status: idempotencyStatusSchema.default('IN_PROGRESS'),
  reference_id: z.string().nullable().optional(),
  reference_type: z.string().nullable().optional(),
  response_code: z.number().int().nullable().optional(),
  response_body: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: timestampSchema,
  expires_at: timestampSchema,
  updated_at: timestampSchema.nullable().optional(),
});
