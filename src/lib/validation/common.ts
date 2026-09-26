/**
 * Alexvya Platform — Common Zod Validation Primitives
 * Stage 1.1–1.4 Specifications
 */

import { z } from 'zod';

// Integer Kobo Validation (Safe integer, strictly positive or non-negative)
export const koboAmountSchema = (minKobo = 100, maxKobo = 1_000_000_000) =>
  z
    .number()
    .int('Amount in kobo must be an integer')
    .min(minKobo, `Amount cannot be less than ${minKobo} kobo`)
    .max(maxKobo, `Amount cannot exceed ${maxKobo} kobo`);

// Nigerian Phone Number / MSISDN (MTN, Airtel, Glo, 9mobile)
export const nigerianMsisdnSchema = z
  .string()
  .trim()
  .regex(
    /^(?:\+234|0)[789][01]\d{8}$/,
    'Invalid Nigerian phone number format. Must start with 0 or +234 followed by a valid network prefix.'
  );

// Idempotency Key (UUIDv4)
export const idempotencyKeySchema = z
  .string()
  .uuid('Idempotency-Key header must be a valid UUIDv4');

// Meter Type
export const meterTypeSchema = z.enum(['PREPAID', 'POSTPAID']);

// Meter Number (6 to 13 digits alphanumeric)
export const meterNumberSchema = z
  .string()
  .trim()
  .min(6, 'Meter number must be at least 6 digits')
  .max(13, 'Meter number cannot exceed 13 digits')
  .regex(/^[0-9a-zA-Z]+$/, 'Meter number must contain alphanumeric characters only');

// Smartcard / IUC Number (10 to 11 digits)
export const smartcardNumberSchema = z
  .string()
  .trim()
  .min(10, 'Smartcard/IUC number must be at least 10 digits')
  .max(11, 'Smartcard/IUC number cannot exceed 11 digits')
  .regex(/^\d+$/, 'Smartcard/IUC number must contain digits only');

// Disco Code
export const discoCodeSchema = z.enum([
  'IKEDC',
  'EKEDC',
  'AEDC',
  'IBEDC',
  'EEDC',
  'PHED',
  'KEDCO',
  'KAEDCO',
  'JED',
  'BEDC',
  'YEDC',
]);

// Cable TV Provider Code
export const cableTvProviderSchema = z.enum(['DSTV', 'GOTV', 'STARTIMES', 'SHOWMAX']);
