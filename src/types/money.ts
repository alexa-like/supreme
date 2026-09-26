/**
 * Alexvya Platform — Money & Basis Point Foundation
 * Stage 2.5.5 Financial Validation & Invariant Enforcement
 * 
 * Strict Invariants:
 * 1. All monetary values are non-negative integer kobo (100 kobo = ₦1.00).
 * 2. All percentages are non-negative integer basis points (100 bps = 1.00%, 10000 bps = 100%).
 * 3. Exact integer arithmetic within Number.MAX_SAFE_INTEGER (9,007,199,254,740,991).
 * 4. Zero floating point currency computation.
 * 5. Deterministic decimal string parsing (no parseFloat() * 100).
 */

import { AlexvyaApiError, ErrorCodes } from '../lib/api/errors.ts';

/**
 * Integer Kobo nominal value (e.g., 100000 = ₦1,000.00).
 * Guaranteed to be an integer >= 0 and <= MAX_SAFE_INTEGER.
 */
export type IntegerKobo = number;

/**
 * Integer Basis Points (1 bps = 0.01%, 10000 bps = 100.00%).
 */
export type IntegerBps = number;

export const MONEY_CONSTANTS = {
  KOBO_PER_NAIRA: 100,
  BPS_FULL_PERCENT: 10000, // 100%
  MIN_TRANSACTION_KOBO: 5000, // ₦50.00
  MIN_VAS_PURCHASE_KOBO: 5000, // ₦50.00
  MAX_SINGLE_VAS_KOBO: 10000000, // ₦100,000.00
  MAX_VAS_PURCHASE_KOBO: 10000000, // ₦100,000.00
  MAX_DAILY_FUNDING_TIER_1_KOBO: 5000000, // ₦50,000.00
  MAX_DAILY_FUNDING_TIER_2_KOBO: 20000000, // ₦200,000.00
  MAX_ACCOUNT_BALANCE_KOBO: 1000000000, // ₦10,000,000.00
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
} as const;

/**
 * Validates whether a value is a valid non-negative safe integer kobo.
 */
export function isSafeKobo(value: unknown): value is IntegerKobo {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Number.isNaN(value) &&
    value <= MONEY_CONSTANTS.MAX_SAFE_INTEGER
  );
}

/**
 * Validates whether a value is a valid strictly positive safe integer kobo (> 0).
 */
export function isPositiveSafeKobo(value: unknown): value is IntegerKobo {
  return isSafeKobo(value) && value > 0;
}

/**
 * Validates whether a value is a valid basis points value (0 - 10,000).
 */
export function isSafeBps(value: unknown, maxBps: number = MONEY_CONSTANTS.BPS_FULL_PERCENT): value is IntegerBps {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maxBps &&
    !Number.isNaN(value)
  );
}

/**
 * Deterministic integer decimal parser from Naira string or number to integer Kobo.
 * Rejects floating point inaccuracies, negative numbers, and more than 2 decimal places.
 * 
 * Examples:
 * - "100" -> 10000 kobo
 * - "100.00" -> 10000 kobo
 * - "100.5" -> 10050 kobo
 * - "100.50" -> 10050 kobo
 * - "100.555" -> throws INVALID_MONEY_AMOUNT (more than 2 decimal places)
 */
export function parseNgnToKobo(naira: number | string, correlationId?: string): IntegerKobo {
  if (naira === null || naira === undefined) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_MONEY_AMOUNT,
      'Naira amount is missing or undefined.',
      400,
      { correlation_id: correlationId }
    );
  }

  let str: string;
  if (typeof naira === 'number') {
    if (!Number.isFinite(naira) || Number.isNaN(naira)) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_MONEY_AMOUNT,
        `Invalid numerical Naira amount: ${naira}`,
        400,
        { value: naira, correlation_id: correlationId }
      );
    }
    if (naira < 0) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_MONEY_AMOUNT,
        `Naira amount cannot be negative: ${naira}`,
        400,
        { value: naira, correlation_id: correlationId }
      );
    }
    if (Number.isSafeInteger(naira)) {
      const kobo = naira * MONEY_CONSTANTS.KOBO_PER_NAIRA;
      if (!isSafeKobo(kobo)) {
        throw new AlexvyaApiError(
          ErrorCodes.MONEY_OVERFLOW,
          `Kobo conversion overflowed safe integer bounds: ${kobo}`,
          400,
          { value: naira, correlation_id: correlationId }
        );
      }
      return kobo;
    }
    str = naira.toString();
  } else if (typeof naira === 'string') {
    str = naira.trim();
  } else {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_MONEY_AMOUNT,
      `Expected string or number for Naira amount, received ${typeof naira}`,
      400,
      { correlation_id: correlationId }
    );
  }

  if (str.length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_MONEY_AMOUNT,
      'Naira amount string cannot be empty.',
      400,
      { correlation_id: correlationId }
    );
  }

  // Regex: strictly non-negative digits with optional 1 or 2 decimal places (no negative sign, no extra decimals)
  const regex = /^\d+(\.\d{1,2})?$/;
  if (!regex.test(str)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_MONEY_AMOUNT,
      `Invalid Naira amount format: '${str}'. Must be a non-negative number with at most 2 decimal places.`,
      400,
      { value: str, correlation_id: correlationId }
    );
  }

  const parts = str.split('.');
  const wholePartStr = parts[0];
  const wholePart = parseInt(wholePartStr, 10);
  if (!Number.isSafeInteger(wholePart) || wholePart < 0) {
    throw new AlexvyaApiError(
      ErrorCodes.MONEY_OVERFLOW,
      `Naira whole amount exceeds safe integer limit: ${wholePartStr}`,
      400,
      { value: str, correlation_id: correlationId }
    );
  }

  let fracPart = 0;
  if (parts.length === 2 && parts[1]) {
    const fracStr = parts[1].length === 1 ? parts[1] + '0' : parts[1];
    fracPart = parseInt(fracStr, 10);
  }

  const totalKobo = wholePart * MONEY_CONSTANTS.KOBO_PER_NAIRA + fracPart;
  if (!isSafeKobo(totalKobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.MONEY_OVERFLOW,
      `Kobo calculation exceeded safe integer bounds: ${totalKobo}`,
      400,
      { value: str, correlation_id: correlationId }
    );
  }

  return totalKobo;
}

/**
 * Converts Naira nominal number or string to integer Kobo safely.
 * Throws error on invalid input.
 */
export function ngnToKobo(naira: number | string): IntegerKobo {
  return parseNgnToKobo(naira);
}

/**
 * Converts integer Kobo to human-readable Naira string (e.g. 100000 -> "₦1,000.00").
 */
export function koboToNgnFormatted(kobo: IntegerKobo): string {
  if (!isSafeKobo(kobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `Invalid integer kobo for formatting: ${kobo}`,
      400
    );
  }
  const naira = kobo / MONEY_CONSTANTS.KOBO_PER_NAIRA;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(naira);
}

/**
 * Converts integer Kobo to raw Naira decimal float (for display only).
 */
export function koboToNgn(kobo: IntegerKobo): number {
  if (!isSafeKobo(kobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `Invalid integer kobo for conversion: ${kobo}`,
      400
    );
  }
  return kobo / MONEY_CONSTANTS.KOBO_PER_NAIRA;
}

/**
 * Computes discount in integer Kobo from face value and basis points with floor rounding.
 * Formula: floor((face_value_kobo * discount_bps) / 10000)
 */
export function calculateBasisPointsDiscount(faceValueKobo: IntegerKobo, discountBps: IntegerBps): IntegerKobo {
  if (!isSafeKobo(faceValueKobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `Invalid faceValueKobo: ${faceValueKobo}`,
      400
    );
  }
  if (!isSafeBps(discountBps)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      `Invalid discountBps: ${discountBps}. Must be an integer between 0 and 10,000.`,
      400
    );
  }
  return Math.floor((faceValueKobo * discountBps) / MONEY_CONSTANTS.BPS_FULL_PERCENT);
}

/**
 * Computes fee in integer Kobo from amount and basis points with ceil rounding.
 * Formula: ceil((amount_kobo * fee_bps) / 10000)
 */
export function calculateBasisPointsFee(amountKobo: IntegerKobo, feeBps: IntegerBps): IntegerKobo {
  if (!isSafeKobo(amountKobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `Invalid amountKobo: ${amountKobo}`,
      400
    );
  }
  if (!isSafeBps(feeBps)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      `Invalid feeBps: ${feeBps}. Must be an integer between 0 and 10,000.`,
      400
    );
  }
  return Math.ceil((amountKobo * feeBps) / MONEY_CONSTANTS.BPS_FULL_PERCENT);
}

/**
 * Validates VAS single purchase transaction limits (₦50.00 min, ₦100,000.00 max).
 */
export function validateVasPurchaseAmount(amountKobo: unknown, correlationId?: string): asserts amountKobo is IntegerKobo {
  if (!isSafeKobo(amountKobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `VAS purchase amount (${amountKobo}) must be a safe non-negative integer in kobo.`,
      400,
      { amount_kobo: amountKobo, correlation_id: correlationId }
    );
  }
  if (amountKobo < MONEY_CONSTANTS.MIN_VAS_PURCHASE_KOBO) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_AMOUNT,
      `VAS purchase amount (${amountKobo} kobo / ₦${amountKobo / 100}) is below minimum allowed order (${MONEY_CONSTANTS.MIN_VAS_PURCHASE_KOBO} kobo / ₦50.00).`,
      400,
      {
        amount_kobo: amountKobo,
        min_allowed_kobo: MONEY_CONSTANTS.MIN_VAS_PURCHASE_KOBO,
        correlation_id: correlationId,
      }
    );
  }
  if (amountKobo > MONEY_CONSTANTS.MAX_VAS_PURCHASE_KOBO) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_AMOUNT,
      `VAS purchase amount (${amountKobo} kobo / ₦${amountKobo / 100}) exceeds maximum allowed order (${MONEY_CONSTANTS.MAX_VAS_PURCHASE_KOBO} kobo / ₦100,000.00).`,
      400,
      {
        amount_kobo: amountKobo,
        max_allowed_kobo: MONEY_CONSTANTS.MAX_VAS_PURCHASE_KOBO,
        correlation_id: correlationId,
      }
    );
  }
}
