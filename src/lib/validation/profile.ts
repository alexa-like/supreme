/**
 * Alexvya Platform — Profile Update Validation Schema
 * Stage 2.3 User Provisioning Architecture
 * 
 * Strict schema: ONLY permitted personal profile fields may be sent.
 * Any attempt to supply uid, role, account_status, tier, wallet, etc. is rejected.
 */

import { z } from 'zod';

export const updateProfileSchema = z
  .object({
    first_name: z
      .string()
      .trim()
      .min(1, 'First name cannot be empty')
      .max(50, 'First name cannot exceed 50 characters')
      .optional(),
    last_name: z
      .string()
      .trim()
      .min(1, 'Last name cannot be empty')
      .max(50, 'Last name cannot exceed 50 characters')
      .optional(),
    display_name: z
      .string()
      .trim()
      .min(1, 'Display name cannot be empty')
      .max(100, 'Display name cannot exceed 100 characters')
      .nullable()
      .optional(),
    phone_number: z
      .string()
      .trim()
      .regex(/^(?:\+234|0)[789][01]\d{8}$/, 'Invalid Nigerian phone number format (e.g. +2348012345678 or 08012345678)')
      .nullable()
      .optional(),
    notification_preferences: z
      .object({
        email_on_wallet_credit: z.boolean().optional(),
        email_on_purchase: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UpdateProfilePayload = z.infer<typeof updateProfileSchema>;

