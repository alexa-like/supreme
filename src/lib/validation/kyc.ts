/**
 * Alexvya Platform — KYC & Tier Upgrade Request Validation Schemas
 * Stage 2.12 KYC, Customer Verification & Tier Management Architecture
 * 
 * STRICT INVARIANT:
 * Strict validation with .strict() rejection of all prohibited or privilege-escalating fields.
 * Direct modification of status, tier, role, or approval state from payloads is rejected.
 */

import { z } from 'zod';

export const startKycSchema = z
  .object({
    requested_tier: z.enum(['TIER_2', 'TIER_3']),
    verification_method: z.enum(['BVN', 'NIN', 'GOVERNMENT_ID', 'UTILITY_BILL', 'MANUAL_REVIEW']),
  })
  .strict();

export type StartKycPayload = z.infer<typeof startKycSchema>;

export const submitKycSchema = z
  .object({
    requested_tier: z.enum(['TIER_2', 'TIER_3']),
    verification_method: z.enum(['BVN', 'NIN', 'GOVERNMENT_ID', 'UTILITY_BILL', 'MANUAL_REVIEW']),
    id_type: z
      .string()
      .trim()
      .min(2, 'ID type is required')
      .max(50, 'ID type too long')
      .optional(),
    id_number: z
      .string()
      .trim()
      .min(4, 'ID number must be at least 4 characters')
      .max(30, 'ID number cannot exceed 30 characters'),
    full_legal_name: z
      .string()
      .trim()
      .min(2, 'Full legal name must be at least 2 characters')
      .max(100, 'Full legal name cannot exceed 100 characters'),
    date_of_birth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
      .optional(),
    address: z
      .string()
      .trim()
      .min(5, 'Address must be at least 5 characters')
      .max(250, 'Address cannot exceed 250 characters')
      .optional(),
  })
  .strict();

export type SubmitKycPayload = z.infer<typeof submitKycSchema>;

export const tierUpgradeRequestSchema = z
  .object({
    target_tier: z.enum(['TIER_2', 'TIER_3']),
    justification: z
      .string()
      .trim()
      .max(500, 'Justification cannot exceed 500 characters')
      .optional(),
  })
  .strict();

export type TierUpgradeRequestPayload = z.infer<typeof tierUpgradeRequestSchema>;

export const adminKycReviewSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT', 'REQUEST_ACTION']),
    rejection_reason_code: z
      .enum([
        'NAME_MISMATCH',
        'INVALID_DOCUMENT',
        'UNSUPPORTED_DOCUMENT',
        'SUSPECTED_FRAUD',
        'EXPIRED_DOCUMENT',
        'INCOMPLETE_INFORMATION',
        'OTHER',
      ])
      .optional(),
    rejection_notes: z
      .string()
      .trim()
      .max(500, 'Rejection notes cannot exceed 500 characters')
      .optional(),
    customer_action_required: z
      .string()
      .trim()
      .max(500, 'Action required message cannot exceed 500 characters')
      .optional(),
    justification: z
      .string()
      .trim()
      .max(500, 'Staff justification cannot exceed 500 characters')
      .optional(),
  })
  .strict();

export type AdminKycReviewPayload = z.infer<typeof adminKycReviewSchema>;

/**
 * Utility helper to mask sensitive ID numbers for safe storage and client display.
 * E.g. "22233344455" -> "222*****455"
 */
export function maskIdNumber(rawId: string): string {
  const trimmed = rawId.trim();
  if (trimmed.length <= 4) return '****';
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-3);
  const maskedCount = Math.max(trimmed.length - 6, 3);
  return `${prefix}${'*'.repeat(maskedCount)}${suffix}`;
}
