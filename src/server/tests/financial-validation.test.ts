/**
 * Alexvya Platform — Stage 2.5.5 Test Suite
 * Financial Validation & Invariant Enforcement
 * 
 * Explicitly covers all 27 required validation scenarios:
 * Scenario A: Valid integer kobo
 * Scenario B: Fractional kobo
 * Scenario C: Negative amount
 * Scenario D: Zero amount
 * Scenario E: NaN
 * Scenario F: Infinity
 * Scenario G: Safe integer boundary
 * Scenario H: Maximum wallet balance (1,000,000,000 kobo)
 * Scenario I: Negative balance prevention
 * Scenario J: Wallet balance identity (ledger === available + locked)
 * Scenario K: Wallet version (+1 on mutation, unchanged on replay)
 * Scenario L: Ledger credit arithmetic (balance_after === balance_before + amount)
 * Scenario M: Ledger debit arithmetic (balance_after === balance_before - amount)
 * Scenario N: Invalid ledger snapshot detection
 * Scenario O: CREDIT / OUTFLOW directional mismatch rejection
 * Scenario P: DEBIT / INFLOW directional mismatch rejection
 * Scenario Q: VAS minimum (5,000 kobo / ₦50.00)
 * Scenario R: VAS maximum (10,000,000 kobo / ₦100,000.00)
 * Scenario S: Wallet maximum vs VAS maximum separation (1,000,000,000 vs 10,000,000 kobo)
 * Scenario T: Basis-point validation (0 to 10,000 bps)
 * Scenario U: Discount floor rounding (protects platform revenue)
 * Scenario V: Fee ceiling rounding (covers gateway/processing expense)
 * Scenario W: Profit calculation validation (gross_profit === charged - cost)
 * Scenario X: Refund over-limit & boundary protection
 * Scenario Y: Corrupted wallet rejection
 * Scenario Z: Atomic failure rollback (no dirty ledger / idempotency records)
 * Scenario AA: Stage 2.5.4 regression tests (idempotency replay, concurrency, duplicate refund prevention)
 */

import {
  isSafeKobo,
  isPositiveSafeKobo,
  isSafeBps,
  parseNgnToKobo,
  ngnToKobo,
  koboToNgnFormatted,
  koboToNgn,
  calculateBasisPointsDiscount,
  calculateBasisPointsFee,
  validateVasPurchaseAmount,
  MONEY_CONSTANTS,
} from '../../types/money.ts';
import {
  validateEconomicsSnapshot,
  validateWalletBalanceIdentity,
  validateRefundAmountBounds,
} from '../../lib/validation/money.ts';
import { validateWalletState, ensureWallet, getWallet } from '../repositories/wallets.repository.ts';
import { validateLedgerEntry, queryLedgerByWalletId } from '../repositories/ledger.repository.ts';
import {
  creditWallet,
  debitWallet,
  refundWallet,
  resetMutationMutexes,
} from '../wallet/mutation.service.ts';
import { inMemoryStore } from '../repositories/base.repository.ts';
import { getIdempotencyKey } from '../repositories/idempotencyKeys.repository.ts';
import { WalletStatus, LedgerEntryType, LedgerDirection, LedgerCategory } from '../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { WalletDocument, LedgerDocument } from '../../types/firestore.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function assertRejects(
  fn: () => Promise<any> | any,
  expectedErrorCode?: string | string[],
  message?: string
) {
  let threw = false;
  let codeMatched = false;
  let caughtError: any = null;
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
  } catch (err: any) {
    threw = true;
    caughtError = err;
    if (expectedErrorCode) {
      const expectedList = Array.isArray(expectedErrorCode) ? expectedErrorCode : [expectedErrorCode];
      if (err instanceof AlexvyaApiError && expectedList.includes(err.code)) {
        codeMatched = true;
      } else if (err.code && expectedList.includes(err.code)) {
        codeMatched = true;
      } else if (err.message && expectedList.some((c) => err.message.includes(c))) {
        codeMatched = true;
      }
    } else {
      codeMatched = true;
    }
  }

  if (!threw) {
    throw new Error(`[EXPECTED EXCEPTION] Expected function to reject: ${message || String(expectedErrorCode) || ''}`);
  }
  if (expectedErrorCode && !codeMatched) {
    throw new Error(`[WRONG ERROR CODE] Expected error code ${JSON.stringify(expectedErrorCode)}, but caught ${caughtError?.code || caughtError?.message || caughtError}. ${message || ''}`);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('ALEXVYA PLATFORM — STAGE 2.5.5 TEST SUITE');
  console.log('FINANCIAL VALIDATION & INVARIANT ENFORCEMENT');
  console.log('====================================================\n');

  inMemoryStore.clear();
  resetMutationMutexes();

  // --------------------------------------------------------------------------
  // Scenario A: Valid integer kobo
  // --------------------------------------------------------------------------
  console.log('Scenario A: Valid integer kobo...');
  assert(isSafeKobo(0) === true, 'A.1: 0 is valid kobo');
  assert(isSafeKobo(1) === true, 'A.2: 1 is valid kobo');
  assert(isSafeKobo(100) === true, 'A.3: 100 kobo (₦1.00) is valid');
  assert(isSafeKobo(500000) === true, 'A.4: 500,000 kobo (₦5,000.00) is valid');
  assert(isSafeKobo(1000000000) === true, 'A.5: 1,000,000,000 kobo (₦10M) is valid');
  assert(parseNgnToKobo('100.00') === 10000, 'A.6: "100.00" parses to 10,000 kobo');
  console.log('  -> PASS: Scenario A (Valid integer kobo) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario B: Fractional kobo rejection
  // --------------------------------------------------------------------------
  console.log('Scenario B: Fractional kobo rejection...');
  assert(isSafeKobo(100.5) === false, 'B.1: Float kobo rejected in isSafeKobo');
  assert(isSafeKobo(0.01) === false, 'B.2: Fractional float rejected');
  await assertRejects(() => parseNgnToKobo('100.555'), ErrorCodes.INVALID_MONEY_AMOUNT, 'B.3: Rejects > 2 decimal places in parseNgnToKobo');
  const userFractional = 'usr_frac_test';
  await ensureWallet(userFractional);
  await assertRejects(
    () => creditWallet({ userId: userFractional, amountKobo: 100.5 as any, description: 'Fractional' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT],
    'B.4: Fractional mutation rejected'
  );
  console.log('  -> PASS: Scenario B (Fractional kobo) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario C: Negative amount rejection
  // --------------------------------------------------------------------------
  console.log('Scenario C: Negative amount rejection...');
  assert(isSafeKobo(-1) === false, 'C.1: Negative integer is not safe kobo');
  assert(isSafeKobo(-5000) === false, 'C.2: -5000 is not safe kobo');
  await assertRejects(() => parseNgnToKobo('-50.00'), ErrorCodes.INVALID_MONEY_AMOUNT, 'C.3: Negative string rejected');
  await assertRejects(
    () => creditWallet({ userId: userFractional, amountKobo: -1000, description: 'Negative' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT, ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN],
    'C.4: Negative credit rejected'
  );
  await assertRejects(
    () => debitWallet({ userId: userFractional, amountKobo: -1000, description: 'Negative debit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT, ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN],
    'C.5: Negative debit rejected'
  );
  console.log('  -> PASS: Scenario C (Negative amount) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario D: Zero amount rejection
  // --------------------------------------------------------------------------
  console.log('Scenario D: Zero amount rejection...');
  assert(isPositiveSafeKobo(0) === false, 'D.1: 0 is not positive safe kobo');
  await assertRejects(
    () => creditWallet({ userId: userFractional, amountKobo: 0, description: 'Zero credit' }),
    [ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED, ErrorCodes.INVALID_AMOUNT],
    'D.2: Zero credit rejected'
  );
  await assertRejects(
    () => debitWallet({ userId: userFractional, amountKobo: 0, description: 'Zero debit' }),
    [ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED, ErrorCodes.INVALID_AMOUNT],
    'D.3: Zero debit rejected'
  );
  await assertRejects(
    () => refundWallet({
      userId: userFractional,
      amountKobo: 0,
      originalTransactionId: 'tx_orig',
      originalTransactionReference: 'ALX-ORIG-0',
      description: 'Zero refund',
    }),
    [ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED, ErrorCodes.REFUND_AMOUNT_INVALID],
    'D.4: Zero refund rejected'
  );
  console.log('  -> PASS: Scenario D (Zero amount) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario E: NaN rejection
  // --------------------------------------------------------------------------
  console.log('Scenario E: NaN rejection...');
  assert(isSafeKobo(NaN) === false, 'E.1: NaN is not safe kobo');
  assert(isPositiveSafeKobo(NaN) === false, 'E.2: NaN is not positive safe kobo');
  await assertRejects(
    () => creditWallet({ userId: userFractional, amountKobo: NaN as any, description: 'NaN credit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT, ErrorCodes.MONEY_OVERFLOW],
    'E.3: NaN credit mutation rejected'
  );
  console.log('  -> PASS: Scenario E (NaN) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario F: Infinity rejection
  // --------------------------------------------------------------------------
  console.log('Scenario F: Infinity rejection...');
  assert(isSafeKobo(Infinity) === false, 'F.1: Infinity is not safe kobo');
  assert(isSafeKobo(-Infinity) === false, 'F.2: -Infinity is not safe kobo');
  await assertRejects(
    () => creditWallet({ userId: userFractional, amountKobo: Infinity as any, description: 'Infinity credit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT, ErrorCodes.MONEY_OVERFLOW],
    'F.3: Infinity credit mutation rejected'
  );
  console.log('  -> PASS: Scenario F (Infinity) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario G: Safe integer boundary
  // --------------------------------------------------------------------------
  console.log('Scenario G: Safe integer boundary...');
  assert(isSafeKobo(Number.MAX_SAFE_INTEGER) === true, 'G.1: MAX_SAFE_INTEGER is safe');
  assert(isSafeKobo(Number.MAX_SAFE_INTEGER + 10) === false, 'G.2: Integer overflow above MAX_SAFE_INTEGER rejected');
  console.log('  -> PASS: Scenario G (Safe integer boundary) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario H: Maximum wallet balance (1,000,000,000 kobo / ₦10,000,000.00)
  // --------------------------------------------------------------------------
  console.log('Scenario H: Maximum wallet balance (1,000,000,000 kobo)...');
  assert(MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO === 1000000000, 'H.1: Max account balance constant is 1,000,000,000 kobo');
  const maxUser = 'usr_max_cap_test';
  await ensureWallet(maxUser);
  await creditWallet({ userId: maxUser, amountKobo: 1000000000, description: 'Credit to limit' });
  const maxWallet = await getWallet(maxUser);
  assert(maxWallet?.available_balance_kobo === 1000000000, 'H.2: Wallet successfully reaches exactly 1,000,000,000 kobo');
  await assertRejects(
    () => creditWallet({ userId: maxUser, amountKobo: 1, description: 'Over limit credit' }),
    ErrorCodes.MAX_BALANCE_EXCEEDED,
    'H.3: Credit exceeding 1,000,000,000 kobo rejected'
  );
  console.log('  -> PASS: Scenario H (Maximum wallet balance) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario I: Negative balance prevention
  // --------------------------------------------------------------------------
  console.log('Scenario I: Negative balance prevention...');
  const baseWalletDoc: WalletDocument = {
    id: 'usr_inv_test',
    user_id: 'usr_inv_test',
    currency: 'NGN',
    available_balance_kobo: 50000,
    ledger_balance_kobo: 50000,
    locked_balance_kobo: 0,
    status: WalletStatus.ACTIVE,
    daily_spent_kobo: 0,
    last_ledger_entry_id: null,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await assertRejects(
    () => validateWalletState({ ...baseWalletDoc, available_balance_kobo: -100 }),
    [ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN, ErrorCodes.INVALID_WALLET_STATE],
    'I.1: Negative available balance rejected'
  );
  await assertRejects(
    () => validateWalletState({ ...baseWalletDoc, ledger_balance_kobo: -100 }),
    [ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN, ErrorCodes.INVALID_WALLET_STATE],
    'I.2: Negative ledger balance rejected'
  );
  await assertRejects(
    () => validateWalletState({ ...baseWalletDoc, locked_balance_kobo: -100 }),
    [ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN, ErrorCodes.INVALID_WALLET_STATE],
    'I.3: Negative locked balance rejected'
  );
  console.log('  -> PASS: Scenario I (Negative balance) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario J: Wallet balance identity (ledger === available + locked)
  // --------------------------------------------------------------------------
  console.log('Scenario J: Wallet balance identity (ledger === available + locked)...');
  validateWalletBalanceIdentity(70000, 30000, 100000); // 70k + 30k === 100k
  await assertRejects(
    () => validateWalletBalanceIdentity(70000, 30000, 99999),
    ErrorCodes.BALANCE_INVARIANT_VIOLATION,
    'J.1: Balance sum mismatch rejected'
  );
  await assertRejects(
    () => validateWalletState({
      ...baseWalletDoc,
      available_balance_kobo: 50000,
      locked_balance_kobo: 20000,
      ledger_balance_kobo: 80000, // 80k != 50k + 20k
    }),
    ErrorCodes.BALANCE_INVARIANT_VIOLATION,
    'J.2: Document balance identity mismatch rejected'
  );
  console.log('  -> PASS: Scenario J (Wallet balance identity) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario K: Wallet version (+1 on mutation, unchanged on replay)
  // --------------------------------------------------------------------------
  console.log('Scenario K: Wallet version (+1 on mutation, unchanged on replay)...');
  const verUser = 'usr_ver_test';
  await ensureWallet(verUser);
  const w0 = await getWallet(verUser);
  assert(w0?.version === 1, 'K.1: Initial version is 1');

  const cRes = await creditWallet({
    userId: verUser,
    amountKobo: 500000,
    description: 'Credit funding',
    idempotencyKey: 'idem_ver_c1',
  });
  assert(cRes.previousVersion === 1 && cRes.newVersion === 2, 'K.2: Version increments from 1 -> 2');

  const dRes = await debitWallet({
    userId: verUser,
    amountKobo: 100000,
    description: 'Debit purchase',
    idempotencyKey: 'idem_ver_d1',
  });
  assert(dRes.previousVersion === 2 && dRes.newVersion === 3, 'K.3: Version increments from 2 -> 3');

  const replayD = await debitWallet({
    userId: verUser,
    amountKobo: 100000,
    description: 'Debit purchase',
    idempotencyKey: 'idem_ver_d1',
  });
  assert(replayD.isIdempotentReplay === true && replayD.newVersion === 3, 'K.4: Idempotent replay leaves version unchanged at 3');
  console.log('  -> PASS: Scenario K (Wallet version) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario L: Ledger credit arithmetic (balance_after === balance_before + amount)
  // --------------------------------------------------------------------------
  console.log('Scenario L: Ledger credit arithmetic...');
  const baseLedgerCredit: LedgerDocument = {
    id: 'led_l_1',
    wallet_id: 'usr_ver_test',
    user_id: 'usr_ver_test',
    transaction_id: 'tx_l_1',
    transaction_reference: 'ALX-CRD-L1',
    entry_type: LedgerEntryType.CREDIT,
    direction: LedgerDirection.INFLOW,
    amount_kobo: 200000,
    balance_before_kobo: 400000,
    balance_after_kobo: 600000, // 400k + 200k === 600k
    category: LedgerCategory.WALLET_FUNDING,
    description: 'Valid credit',
    actor: { type: 'CUSTOMER', id: 'usr_ver_test' },
    created_at: new Date().toISOString(),
  };
  validateLedgerEntry(baseLedgerCredit);
  console.log('  -> PASS: Scenario L (Ledger credit arithmetic) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario M: Ledger debit arithmetic (balance_after === balance_before - amount)
  // --------------------------------------------------------------------------
  console.log('Scenario M: Ledger debit arithmetic...');
  const baseLedgerDebit: LedgerDocument = {
    id: 'led_m_1',
    wallet_id: 'usr_ver_test',
    user_id: 'usr_ver_test',
    transaction_id: 'tx_m_1',
    transaction_reference: 'ALX-DBT-M1',
    entry_type: LedgerEntryType.DEBIT,
    direction: LedgerDirection.OUTFLOW,
    amount_kobo: 150000,
    balance_before_kobo: 600000,
    balance_after_kobo: 450000, // 600k - 150k === 450k
    category: LedgerCategory.AIRTIME_PURCHASE,
    description: 'Valid debit',
    actor: { type: 'CUSTOMER', id: 'usr_ver_test' },
    created_at: new Date().toISOString(),
  };
  validateLedgerEntry(baseLedgerDebit);
  console.log('  -> PASS: Scenario M (Ledger debit arithmetic) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario N: Invalid ledger snapshot detection
  // --------------------------------------------------------------------------
  console.log('Scenario N: Invalid ledger snapshot detection...');
  await assertRejects(
    () => validateLedgerEntry({ ...baseLedgerCredit, balance_after_kobo: 650000 }),
    ErrorCodes.BALANCE_INVARIANT_VIOLATION,
    'N.1: Corrupted credit snapshot rejected'
  );
  await assertRejects(
    () => validateLedgerEntry({ ...baseLedgerDebit, balance_after_kobo: 400000 }),
    ErrorCodes.BALANCE_INVARIANT_VIOLATION,
    'N.2: Corrupted debit snapshot rejected'
  );
  console.log('  -> PASS: Scenario N (Invalid ledger snapshot) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario O: CREDIT / OUTFLOW mismatch rejection
  // --------------------------------------------------------------------------
  console.log('Scenario O: CREDIT / OUTFLOW directional mismatch rejection...');
  await assertRejects(
    () => validateLedgerEntry({ ...baseLedgerCredit, direction: LedgerDirection.OUTFLOW }),
    ErrorCodes.INVALID_LEDGER_DIRECTION,
    'O.1: CREDIT + OUTFLOW mismatch rejected'
  );
  console.log('  -> PASS: Scenario O (CREDIT / OUTFLOW mismatch) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario P: DEBIT / INFLOW mismatch rejection
  // --------------------------------------------------------------------------
  console.log('Scenario P: DEBIT / INFLOW directional mismatch rejection...');
  await assertRejects(
    () => validateLedgerEntry({ ...baseLedgerDebit, direction: LedgerDirection.INFLOW }),
    ErrorCodes.INVALID_LEDGER_DIRECTION,
    'P.1: DEBIT + INFLOW mismatch rejected'
  );
  console.log('  -> PASS: Scenario P (DEBIT / INFLOW mismatch) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario Q: VAS minimum (5,000 kobo / ₦50.00)
  // --------------------------------------------------------------------------
  console.log('Scenario Q: VAS minimum (5,000 kobo / ₦50.00)...');
  assert(MONEY_CONSTANTS.MIN_VAS_PURCHASE_KOBO === 5000, 'Q.1: Constant is 5,000 kobo');
  validateVasPurchaseAmount(5000); // Exact min passes
  await assertRejects(() => validateVasPurchaseAmount(4999), ErrorCodes.INVALID_AMOUNT, 'Q.2: 4,999 kobo rejected');
  console.log('  -> PASS: Scenario Q (VAS minimum) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario R: VAS maximum (10,000,000 kobo / ₦100,000.00)
  // --------------------------------------------------------------------------
  console.log('Scenario R: VAS maximum (10,000,000 kobo / ₦100,000.00)...');
  assert(MONEY_CONSTANTS.MAX_VAS_PURCHASE_KOBO === 10000000, 'R.1: Constant is 10,000,000 kobo');
  validateVasPurchaseAmount(10000000); // Exact max passes
  await assertRejects(() => validateVasPurchaseAmount(10000001), ErrorCodes.INVALID_AMOUNT, 'R.2: 10,000,001 kobo rejected');
  console.log('  -> PASS: Scenario R (VAS maximum) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario S: Wallet maximum vs VAS maximum separation
  // --------------------------------------------------------------------------
  console.log('Scenario S: Wallet maximum vs VAS maximum separation (1,000,000,000 vs 10,000,000 kobo)...');
  assert(
    MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO === 1000000000 &&
    MONEY_CONSTANTS.MAX_VAS_PURCHASE_KOBO === 10000000 &&
    MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO === MONEY_CONSTANTS.MAX_VAS_PURCHASE_KOBO * 100,
    'S.1: Max account balance (₦10M) is strictly 100x the max single VAS transaction (₦100k)'
  );
  console.log('  -> PASS: Scenario S (Limit separation) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario T: Basis-point validation (0 to 10,000 bps)
  // --------------------------------------------------------------------------
  console.log('Scenario T: Basis-point validation (0 to 10,000 bps)...');
  assert(isSafeBps(0) === true, 'T.1: 0 bps is safe');
  assert(isSafeBps(150) === true, 'T.2: 150 bps (1.50%) is safe');
  assert(isSafeBps(10000) === true, 'T.3: 10,000 bps (100.00%) is safe');
  assert(isSafeBps(-1) === false, 'T.4: Negative bps rejected');
  assert(isSafeBps(10001) === false, 'T.5: > 10,000 bps rejected');
  assert(isSafeBps(2.5) === false, 'T.6: Float bps rejected');
  console.log('  -> PASS: Scenario T (Basis-point validation) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario U: Discount floor rounding (protects platform revenue)
  // --------------------------------------------------------------------------
  console.log('Scenario U: Discount floor rounding...');
  // ₦99.99 (9,999 kobo) with 1.35% (135 bps) -> 9,999 * 135 / 10,000 = 134.9865 -> floor to 134 kobo
  const discount = calculateBasisPointsDiscount(9999, 135);
  assert(discount === 134, 'U.1: Discount is floored from 134.9865 to 134 kobo');
  console.log('  -> PASS: Scenario U (Discount floor rounding) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario V: Fee ceiling rounding (covers processing cost)
  // --------------------------------------------------------------------------
  console.log('Scenario V: Fee ceiling rounding...');
  // ₦99.99 (9,999 kobo) with 1.35% (135 bps) -> 9,999 * 135 / 10,000 = 134.9865 -> ceil to 135 kobo
  const fee = calculateBasisPointsFee(9999, 135);
  assert(fee === 135, 'V.1: Fee is ceiled from 134.9865 to 135 kobo');
  console.log('  -> PASS: Scenario V (Fee ceiling rounding) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario W: Profit calculation validation (gross_profit === charged - cost)
  // --------------------------------------------------------------------------
  console.log('Scenario W: Profit calculation validation...');
  validateEconomicsSnapshot({
    total_charged_kobo: 100000,
    provider_cost_kobo: 97000,
    markup_kobo: 0,
    discount_kobo: 0,
    expected_gross_profit_kobo: 3000, // 100k - 97k === 3k
    pricing_rule_version: 1,
  });
  await assertRejects(
    () => validateEconomicsSnapshot({
      total_charged_kobo: 100000,
      provider_cost_kobo: 97000,
      markup_kobo: 0,
      discount_kobo: 0,
      expected_gross_profit_kobo: 4000, // Discrepancy
      pricing_rule_version: 1,
    }),
    ErrorCodes.INVALID_PROFIT_CALCULATION,
    'W.1: Profit discrepancy rejected'
  );
  console.log('  -> PASS: Scenario W (Profit calculation) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario X: Refund over-limit & boundary protection
  // --------------------------------------------------------------------------
  console.log('Scenario X: Refund over-limit & boundary protection...');
  validateRefundAmountBounds(100000, 0, 100000); // Exact full refund allowed
  validateRefundAmountBounds(100000, 40000, 60000); // Partial cumulative refund allowed
  await assertRejects(() => validateRefundAmountBounds(100000, 0, 100001), ErrorCodes.REFUND_AMOUNT_EXCEEDED, 'X.1: Single refund > original debit rejected');
  await assertRejects(() => validateRefundAmountBounds(100000, 60000, 50000), ErrorCodes.REFUND_AMOUNT_EXCEEDED, 'X.2: Cumulative refunds (60k+50k=110k) > original debit rejected');
  await assertRejects(() => validateRefundAmountBounds(100000, 0, 0), ErrorCodes.REFUND_AMOUNT_INVALID, 'X.3: 0 kobo refund rejected');
  console.log('  -> PASS: Scenario X (Refund over-limit) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario Y: Corrupted wallet rejection
  // --------------------------------------------------------------------------
  console.log('Scenario Y: Corrupted wallet document rejection...');
  await assertRejects(
    () => validateWalletState({ ...baseWalletDoc, version: 0 }),
    [ErrorCodes.WALLET_VERSION_INVALID, ErrorCodes.INVALID_WALLET_STATE],
    'Y.1: Version 0 rejected'
  );
  await assertRejects(
    () => validateWalletState({ ...baseWalletDoc, version: 1.5 }),
    [ErrorCodes.WALLET_VERSION_INVALID, ErrorCodes.INVALID_WALLET_STATE],
    'Y.2: Fractional version rejected'
  );
  await assertRejects(
    () => validateWalletState({ ...baseWalletDoc, status: 'INVALID_STATUS' as any }),
    ErrorCodes.INVALID_WALLET_STATE,
    'Y.3: Invalid status enum rejected'
  );
  console.log('  -> PASS: Scenario Y (Corrupted wallet) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario Z: Atomic failure rollback (no dirty ledger or idempotency records)
  // --------------------------------------------------------------------------
  console.log('Scenario Z: Atomic failure rollback...');
  const atomicUser = 'usr_atomic_test_z';
  await ensureWallet(atomicUser);
  await creditWallet({ userId: atomicUser, amountKobo: 50000, description: 'Initial seed' }); // Balance: 50k

  // Attempt debit exceeding balance (60k > 50k)
  await assertRejects(
    () => debitWallet({
      userId: atomicUser,
      amountKobo: 60000,
      description: 'Overdraft attempt',
      idempotencyKey: 'idem_atomic_failed_z',
      transactionId: 'tx_fail_z',
      transactionReference: 'ALX-FAIL-Z',
    }),
    ErrorCodes.INSUFFICIENT_BALANCE,
    'Z.1: Overdraft rejected'
  );

  const walletAfterFail = await getWallet(atomicUser);
  assert(walletAfterFail?.available_balance_kobo === 50000, 'Z.2: Wallet balance unmodified at 50,000 kobo');
  assert(walletAfterFail?.version === 2, 'Z.3: Wallet version preserved intact');

  const dirtyIdempKey = await getIdempotencyKey('idem_atomic_failed_z');
  assert(dirtyIdempKey === null, 'Z.4: Failed mutation left no dirty idempotency record');
  console.log('  -> PASS: Scenario Z (Atomic failure) verified.\n');

  // --------------------------------------------------------------------------
  // Scenario AA: Stage 2.5.4 Regression Tests
  // --------------------------------------------------------------------------
  console.log('Scenario AA: Stage 2.5.4 Regression tests (Idempotency replay, Concurrency, Deduplication)...');
  const regUser = 'usr_reg_aa';
  await ensureWallet(regUser);
  await creditWallet({ userId: regUser, amountKobo: 1000000, description: 'Seed' });

  // 1. Same-key duplicate request replay
  const key1 = 'idem_aa_same_1';
  const debit1 = await debitWallet({
    userId: regUser,
    amountKobo: 200000,
    description: 'Debit 1',
    idempotencyKey: key1,
    transactionId: 'tx_aa_1',
    transactionReference: 'ALX-AA-1',
  });
  assert(!debit1.isIdempotentReplay, 'AA.1: First execution is fresh');
  assert(debit1.balanceAfterKobo === 800000, 'AA.2: Balance is 800,000 kobo');

  const replayDebit1 = await debitWallet({
    userId: regUser,
    amountKobo: 200000,
    description: 'Debit 1',
    idempotencyKey: key1,
    transactionId: 'tx_aa_1',
    transactionReference: 'ALX-AA-1',
  });
  assert(replayDebit1.isIdempotentReplay === true, 'AA.3: Duplicate execution is marked idempotent replay');
  assert(replayDebit1.balanceAfterKobo === 800000, 'AA.4: Balance remains 800,000 kobo (no double charge)');

  // 2. Concurrent different-key mutations preserve exact balances
  const [resA, resB] = await Promise.all([
    debitWallet({
      userId: regUser,
      amountKobo: 100000,
      description: 'Concurrent A',
      idempotencyKey: 'idem_aa_conc_a',
      transactionId: 'tx_aa_2a',
      transactionReference: 'ALX-AA-2A',
    }),
    debitWallet({
      userId: regUser,
      amountKobo: 150000,
      description: 'Concurrent B',
      idempotencyKey: 'idem_aa_conc_b',
      transactionId: 'tx_aa_2b',
      transactionReference: 'ALX-AA-2B',
    }),
  ]);
  const walletAfterConc = await getWallet(regUser);
  // 800k - 100k - 150k = 550,000 kobo
  assert(walletAfterConc?.available_balance_kobo === 550000, 'AA.5: Concurrent different-key debits accurately subtracted (550,000 kobo)');
  assert(walletAfterConc?.version === 5, 'AA.6: Version accurately increments to 5');

  // 3. Duplicate refund prevention
  const refund1 = await refundWallet({
    userId: regUser,
    amountKobo: 200000,
    originalTransactionId: 'tx_aa_1',
    originalTransactionReference: 'ALX-AA-1',
    description: 'Compensating refund',
    idempotencyKey: 'idem_aa_ref_1',
  });
  assert(!refund1.isIdempotentReplay, 'AA.7: First refund executed');

  await assertRejects(
    () => refundWallet({
      userId: regUser,
      amountKobo: 200000,
      originalTransactionId: 'tx_aa_1',
      originalTransactionReference: 'ALX-AA-1',
      description: 'Attempted duplicate refund without key',
      idempotencyKey: 'idem_aa_ref_different_key',
    }),
    ErrorCodes.DUPLICATE_REFUND,
    'AA.8: Second refund for already-refunded parent transaction strictly rejected'
  );
  console.log('  -> PASS: Scenario AA (Stage 2.5.4 Regression) verified.\n');

  console.log('====================================================');
  console.log('ALL SCENARIOS A THROUGH AA PASSED SUCCESSFULLY (100%)');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\n❌ STAGE 2.5.5 TEST SUITE FAILED:', err);
  process.exit(1);
});
