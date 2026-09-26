/**
 * Alexvya Platform — Money & Basis Point Validation Schemas
 * Stage 2.5.5 Financial Validation & Invariant Enforcement
 * 
 * Strict Financial Guarantees:
 * 1. Safe non-negative integer kobo only.
 * 2. Basis points within 0 to 10,000 (0% to 100%).
 * 3. Exact server-derived economics snapshot validation.
 * 4. Immutable single-account balance journal identity.
 * 5. Refund boundary validation.
 */

import { z } from 'zod';
import {
  MONEY_CONSTANTS,
  isSafeKobo,
  isPositiveSafeKobo,
  isSafeBps,
  IntegerKobo,
  IntegerBps,
} from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../api/errors.ts';

/**
 * Validates integer Kobo amounts.
 * Must be a non-negative, safe JavaScript integer.
 */
export const koboSchema = z
  .number()
  .refine(
    (val) => isSafeKobo(val),
    { message: 'Amount must be a non-negative integer in kobo (safe integer)' }
  );

/**
 * Validates positive non-zero integer Kobo amounts (e.g. for transaction debits/credits).
 */
export const positiveKoboSchema = z
  .number()
  .refine(
    (val) => isPositiveSafeKobo(val),
    { message: 'Amount must be a positive non-zero integer in kobo (> 0)' }
  );

/**
 * Validates VAS single purchase amounts (5,000 kobo to 10,000,000 kobo).
 */
export const vasPurchaseKoboSchema = z
  .number()
  .refine(
    (val) =>
      isSafeKobo(val) &&
      val >= MONEY_CONSTANTS.MIN_VAS_PURCHASE_KOBO &&
      val <= MONEY_CONSTANTS.MAX_VAS_PURCHASE_KOBO,
    {
      message: `VAS purchase amount must be between ${MONEY_CONSTANTS.MIN_VAS_PURCHASE_KOBO} and ${MONEY_CONSTANTS.MAX_VAS_PURCHASE_KOBO} kobo (₦50.00 to ₦100,000.00)`,
    }
  );

/**
 * Validates integer basis points (0 to 10,000).
 */
export const bpsSchema = z
  .number()
  .refine(
    (val) => isSafeBps(val),
    { message: 'Basis points must be an integer between 0 and 10,000' }
  );

/**
 * Validates the ISO Currency (Fixed to NGN).
 */
export const currencySchema = z.literal('NGN');

/**
 * Original Transaction Economics Schema (Server-Derived & Immutable).
 */
export const originalEconomicsSchema = z.object({
  total_charged_kobo: positiveKoboSchema,
  provider_cost_kobo: koboSchema,
  markup_kobo: koboSchema.default(0),
  discount_kobo: koboSchema.default(0),
  expected_gross_profit_kobo: z.number().refine((v) => Number.isSafeInteger(v), {
    message: 'Expected gross profit must be a safe integer kobo',
  }),
  pricing_rule_version: z.number().int().positive().default(1),
});

export type OriginalEconomics = z.infer<typeof originalEconomicsSchema>;

/**
 * Settlement Economics Schema (Recognized upon verified delivery).
 */
export const settlementEconomicsSchema = z.object({
  refund_amount_kobo: koboSchema.default(0),
  reversal_amount_kobo: koboSchema.default(0),
  net_recognized_profit_kobo: z.number().refine((v) => Number.isSafeInteger(v), {
    message: 'Net recognized profit must be a safe integer kobo',
  }),
  settled_at: z.string().datetime(),
});

export type SettlementEconomics = z.infer<typeof settlementEconomicsSchema>;

/**
 * Validates complete financial economics snapshot consistency.
 * Formula: expected_gross_profit_kobo === (total_charged_kobo - provider_cost_kobo)
 */
export function validateEconomicsSnapshot(
  economics: unknown,
  correlationId?: string
): asserts economics is OriginalEconomics {
  const parsed = originalEconomicsSchema.safeParse(economics);
  if (!parsed.success) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_FINANCIAL_SNAPSHOT,
      'Financial economics snapshot schema violation.',
      400,
      { validation_errors: parsed.error.flatten(), correlation_id: correlationId }
    );
  }

  const e = parsed.data;
  // Expected profit = selling_price (net charged) - provider_cost
  const expectedProfit = e.total_charged_kobo - e.provider_cost_kobo;
  if (e.expected_gross_profit_kobo !== expectedProfit) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_PROFIT_CALCULATION,
      `Profit calculation mismatch: total_charged (${e.total_charged_kobo}) - provider_cost (${e.provider_cost_kobo}) = ${expectedProfit}, but expected_gross_profit is ${e.expected_gross_profit_kobo}.`,
      400,
      {
        total_charged_kobo: e.total_charged_kobo,
        provider_cost_kobo: e.provider_cost_kobo,
        expected_gross_profit_kobo: e.expected_gross_profit_kobo,
        derived_profit_kobo: expectedProfit,
        correlation_id: correlationId,
      }
    );
  }
}

/**
 * Validates wallet single-account balance journal identity.
 * Formula: ledger_balance_kobo === available_balance_kobo + locked_balance_kobo
 */
export function validateWalletBalanceIdentity(
  availableKobo: unknown,
  lockedKobo: unknown,
  ledgerKobo: unknown,
  correlationId?: string
): void {
  if (!isSafeKobo(availableKobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `Available balance (${availableKobo}) is not a safe non-negative integer kobo.`,
      400,
      { available_balance_kobo: availableKobo, correlation_id: correlationId }
    );
  }
  if (!isSafeKobo(lockedKobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `Locked balance (${lockedKobo}) is not a safe non-negative integer kobo.`,
      400,
      { locked_balance_kobo: lockedKobo, correlation_id: correlationId }
    );
  }
  if (!isSafeKobo(ledgerKobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `Ledger balance (${ledgerKobo}) is not a safe non-negative integer kobo.`,
      400,
      { ledger_balance_kobo: ledgerKobo, correlation_id: correlationId }
    );
  }

  if (ledgerKobo > MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO) {
    throw new AlexvyaApiError(
      ErrorCodes.MAX_BALANCE_EXCEEDED,
      `Ledger balance (${ledgerKobo}) exceeds maximum account balance limit (${MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO} kobo).`,
      400,
      { ledger_balance_kobo: ledgerKobo, correlation_id: correlationId }
    );
  }

  const expectedLedger = availableKobo + lockedKobo;
  if (ledgerKobo !== expectedLedger) {
    throw new AlexvyaApiError(
      ErrorCodes.BALANCE_INVARIANT_VIOLATION,
      `Wallet balance identity violation: ledger (${ledgerKobo}) !== available (${availableKobo}) + locked (${lockedKobo}).`,
      400,
      {
        ledger_balance_kobo: ledgerKobo,
        available_balance_kobo: availableKobo,
        locked_balance_kobo: lockedKobo,
        expected_ledger_kobo: expectedLedger,
        correlation_id: correlationId,
      }
    );
  }
}

/**
 * Validates refund eligibility and amount bounds.
 */
export function validateRefundAmountBounds(
  originalDebitKobo: number,
  alreadyRefundedKobo: number,
  requestedRefundKobo: number,
  correlationId?: string
): void {
  if (!isSafeKobo(originalDebitKobo) || originalDebitKobo <= 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_AMOUNT,
      `Original debit amount (${originalDebitKobo}) must be a safe positive integer.`,
      400,
      { originalDebitKobo, correlation_id: correlationId }
    );
  }
  if (!isSafeKobo(alreadyRefundedKobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_AMOUNT,
      `Already refunded amount (${alreadyRefundedKobo}) must be a safe non-negative integer.`,
      400,
      { alreadyRefundedKobo, correlation_id: correlationId }
    );
  }
  if (!isSafeKobo(requestedRefundKobo) || requestedRefundKobo <= 0) {
    throw new AlexvyaApiError(
      ErrorCodes.REFUND_AMOUNT_INVALID,
      `Requested refund amount (${requestedRefundKobo}) must be a safe positive integer kobo (> 0).`,
      400,
      { requestedRefundKobo, correlation_id: correlationId }
    );
  }

  const maxRefundable = originalDebitKobo - alreadyRefundedKobo;
  if (requestedRefundKobo > maxRefundable) {
    throw new AlexvyaApiError(
      ErrorCodes.REFUND_AMOUNT_EXCEEDED,
      `Requested refund of ${requestedRefundKobo} kobo exceeds maximum refundable amount of ${maxRefundable} kobo (original: ${originalDebitKobo}, already refunded: ${alreadyRefundedKobo}).`,
      400,
      {
        requested_refund_kobo: requestedRefundKobo,
        max_refundable_kobo: maxRefundable,
        original_debit_kobo: originalDebitKobo,
        already_refunded_kobo: alreadyRefundedKobo,
        correlation_id: correlationId,
      }
    );
  }
}
