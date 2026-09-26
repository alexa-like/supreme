/**
 * Alexvya Platform — Stage 2.5.2 Test Suite
 * Immutable Wallet Ledger & Running Balance Snapshots Verification
 * 
 * Target Coverage:
 * A. Ledger creation (CREDIT, DEBIT, REFUND entries succeed, correct wallet/user association)
 * B. Money validation (positive integer kobo, negative, float, NaN, Infinity, unsafe integer rejection)
 * C. Running balance snapshot (balance_after_kobo arithmetic verification, mismatch rejection)
 * D. Immutability (no update/delete, attempted overwrite fails, original history preserved)
 * E. Duplicate creation (duplicate ledger ID rejected with 409 LEDGER_ENTRY_EXISTS)
 * F. References (transaction and business metadata schema enforcement)
 * G. Ownership (user isolation, mismatch rejection)
 * H. Pagination (cursor-based pagination, deterministic DESC ordering)
 * I. Integration & regression checks
 */

import {
  createLedgerEntry,
  getLedgerEntry,
  queryLedgerByWalletId,
  validateLedgerEntry,
} from '../repositories/ledger.repository.ts';
import { inMemoryStore } from '../repositories/base.repository.ts';
import { LedgerEntryType, LedgerDirection, LedgerCategory } from '../../types/enums.ts';
import { MONEY_CONSTANTS, isSafeKobo } from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { LedgerDocument } from '../../types/firestore.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

function assertThrows(fn: () => void, expectedErrorCode?: string | string[], message?: string) {
  let threw = false;
  let codeMatched = false;
  try {
    fn();
  } catch (err: any) {
    threw = true;
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
    throw new Error(`[EXPECTED EXCEPTION] Expected function to throw: ${message || String(expectedErrorCode) || ''}`);
  }
  if (expectedErrorCode && !codeMatched) {
    throw new Error(`[WRONG ERROR CODE] Expected error code ${JSON.stringify(expectedErrorCode)}, but threw different error.`);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('ALEXVYA STAGE 2.5.2 IMMUTABLE WALLET LEDGER TEST SUITE');
  console.log('====================================================\n');

  inMemoryStore.clear();

  const testUserA = 'usr_ledger_test_001';
  const testUserB = 'usr_ledger_test_002';

  // --------------------------------------------------------------------------
  // TEST A: Ledger Creation
  // --------------------------------------------------------------------------
  console.log('Test A: Ledger entry creation (CREDIT, DEBIT, REFUND)...');
  
  // A.1 CREDIT Entry (Wallet Funding: ₦5,000.00 / 500,000 kobo)
  const creditEntry: LedgerDocument = {
    id: 'led_test_credit_001',
    wallet_id: testUserA,
    user_id: testUserA,
    transaction_id: 'tx_fund_001',
    transaction_reference: 'ALX-TX-FUND-001',
    entry_type: LedgerEntryType.CREDIT,
    direction: LedgerDirection.INFLOW,
    amount_kobo: 500000,
    balance_before_kobo: 0,
    balance_after_kobo: 500000,
    category: LedgerCategory.WALLET_FUNDING,
    description: 'Wallet funding via Paystack checkout',
    actor: { type: 'CUSTOMER', id: testUserA },
    created_at: new Date('2026-09-23T10:00:00.000Z').toISOString(),
  };

  const createdCredit = await createLedgerEntry(testUserA, creditEntry);
  assert(createdCredit.id === 'led_test_credit_001', 'Test A.1: Created credit entry ID matches');
  assert(createdCredit.balance_after_kobo === 500000, 'Test A.2: Running balance snapshot is 500,000 kobo');

  // A.2 DEBIT Entry (Airtime Purchase: ₦1,000.00 / 100,000 kobo)
  const debitEntry: LedgerDocument = {
    id: 'led_test_debit_002',
    wallet_id: testUserA,
    user_id: testUserA,
    transaction_id: 'tx_airtime_002',
    transaction_reference: 'ALX-TX-AIR-002',
    entry_type: LedgerEntryType.DEBIT,
    direction: LedgerDirection.OUTFLOW,
    amount_kobo: 100000,
    balance_before_kobo: 500000,
    balance_after_kobo: 400000,
    category: LedgerCategory.AIRTIME_PURCHASE,
    description: 'MTN ₦1,000 Airtime purchase',
    actor: { type: 'CUSTOMER', id: testUserA },
    created_at: new Date('2026-09-23T10:05:00.000Z').toISOString(),
  };

  const createdDebit = await createLedgerEntry(testUserA, debitEntry);
  assert(createdDebit.id === 'led_test_debit_002', 'Test A.3: Created debit entry ID matches');
  assert(createdDebit.balance_after_kobo === 400000, 'Test A.4: Running balance snapshot is 400,000 kobo');

  // A.3 REFUND Entry (Compensating Inflow: ₦1,000.00 / 100,000 kobo)
  const refundEntry: LedgerDocument = {
    id: 'led_test_refund_003',
    wallet_id: testUserA,
    user_id: testUserA,
    transaction_id: 'tx_refund_003',
    transaction_reference: 'ALX-TX-REF-003',
    entry_type: LedgerEntryType.CREDIT,
    direction: LedgerDirection.INFLOW,
    amount_kobo: 100000,
    balance_before_kobo: 400000,
    balance_after_kobo: 500000,
    category: LedgerCategory.REFUND,
    description: 'Refund for failed airtime dispatch tx_airtime_002',
    actor: { type: 'SYSTEM', id: 'SYSTEM' },
    created_at: new Date('2026-09-23T10:10:00.000Z').toISOString(),
  };

  const createdRefund = await createLedgerEntry(testUserA, refundEntry);
  assert(createdRefund.id === 'led_test_refund_003', 'Test A.5: Created refund entry ID matches');
  assert(createdRefund.balance_after_kobo === 500000, 'Test A.6: Running balance restored to 500,000 kobo');
  console.log('  -> PASS: Test A (Ledger Creation) verified.\n');

  // --------------------------------------------------------------------------
  // TEST B: Money Validation
  // --------------------------------------------------------------------------
  console.log('Test B: Monetary integer kobo validation and rejection...');
  
  // B.1 Zero amount rejection (Ledger movements must be strictly positive > 0)
  const zeroAmountEntry: any = {
    ...creditEntry,
    id: 'led_invalid_zero',
    amount_kobo: 0,
  };
  assertThrows(
    () => validateLedgerEntry(zeroAmountEntry),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED],
    'Zero amount must be rejected'
  );

  // B.2 Negative amount rejection
  const negativeAmountEntry: any = {
    ...creditEntry,
    id: 'led_invalid_neg',
    amount_kobo: -50000,
  };
  assertThrows(
    () => validateLedgerEntry(negativeAmountEntry),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN],
    'Negative amount must be rejected'
  );

  // B.3 Floating-point amount rejection
  const floatAmountEntry: any = {
    ...creditEntry,
    id: 'led_invalid_float',
    amount_kobo: 50000.5,
  };
  assertThrows(
    () => validateLedgerEntry(floatAmountEntry),
    ErrorCodes.INVALID_AMOUNT,
    'Floating point amount must be rejected'
  );

  // B.4 NaN & Infinity rejection
  assert(isSafeKobo(NaN) === false, 'Test B.4.1: NaN rejected');
  assert(isSafeKobo(Infinity) === false, 'Test B.4.2: Infinity rejected');
  assert(isSafeKobo(Number.MAX_SAFE_INTEGER + 10) === false, 'Test B.4.3: Unsafe integer rejected');
  console.log('  -> PASS: Test B (Money Validation) verified.\n');

  // --------------------------------------------------------------------------
  // TEST C: Running Balance Snapshot
  // --------------------------------------------------------------------------
  console.log('Test C: Running balance snapshot arithmetic verification...');

  // C.1 Credit arithmetic mismatch: before (0) + amount (5000) != after (6000)
  const badCreditMismatch: LedgerDocument = {
    ...creditEntry,
    id: 'led_bad_credit_snap',
    balance_before_kobo: 0,
    amount_kobo: 500000,
    balance_after_kobo: 600000, // Invalid: should be 500,000
  };
  assertThrows(
    () => validateLedgerEntry(badCreditMismatch),
    ErrorCodes.BALANCE_INVARIANT_VIOLATION,
    'Credit snapshot arithmetic mismatch must be rejected'
  );

  // C.2 Debit arithmetic mismatch: before (5000) - amount (1000) != after (3000)
  const badDebitMismatch: LedgerDocument = {
    ...debitEntry,
    id: 'led_bad_debit_snap',
    balance_before_kobo: 500000,
    amount_kobo: 100000,
    balance_after_kobo: 300000, // Invalid: should be 400,000
  };
  assertThrows(
    () => validateLedgerEntry(badDebitMismatch),
    ErrorCodes.BALANCE_INVARIANT_VIOLATION,
    'Debit snapshot arithmetic mismatch must be rejected'
  );

  // C.3 Debit exceeding balance before
  const badDebitOverdraft: LedgerDocument = {
    ...debitEntry,
    id: 'led_bad_debit_overdraft',
    balance_before_kobo: 50000,
    amount_kobo: 100000,
    balance_after_kobo: 0,
  };
  assertThrows(
    () => validateLedgerEntry(badDebitOverdraft),
    ErrorCodes.INSUFFICIENT_BALANCE,
    'Debit exceeding balance before must be rejected'
  );

  // C.4 Exceeding MAX_ACCOUNT_BALANCE_KOBO
  const badExceedingMaxCap: LedgerDocument = {
    ...creditEntry,
    id: 'led_bad_cap',
    balance_before_kobo: MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO,
    amount_kobo: 100000,
    balance_after_kobo: MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO + 100000,
  };
  assertThrows(
    () => validateLedgerEntry(badExceedingMaxCap),
    ErrorCodes.MAX_BALANCE_EXCEEDED,
    'Exceeding MAX_ACCOUNT_BALANCE_KOBO must be rejected'
  );
  console.log('  -> PASS: Test C (Running Balance Snapshot) verified.\n');

  // --------------------------------------------------------------------------
  // TEST D & E: Immutability & Duplicate Creation Prevention
  // --------------------------------------------------------------------------
  console.log('Test D & E: Immutability and duplicate creation prevention...');

  // Attempt to re-create existing ledger entry 'led_test_credit_001' with altered data
  const alteredDuplicate: LedgerDocument = {
    ...creditEntry,
    amount_kobo: 99999999, // Attempted tampering
    balance_after_kobo: 99999999,
  };

  try {
    await createLedgerEntry(testUserA, alteredDuplicate);
    assert(false, 'Duplicate ledger creation must throw 409');
  } catch (err: any) {
    assert(err.code === ErrorCodes.LEDGER_ENTRY_EXISTS, 'Test D.1: Duplicate creation throws LEDGER_ENTRY_EXISTS');
    assert(err.statusCode === 409, 'Test D.2: HTTP status code is 409 Conflict');
  }

  // Verify original entry was NOT altered
  const retrievedOriginal = await getLedgerEntry(testUserA, 'led_test_credit_001');
  assert(retrievedOriginal !== null, 'Test D.3: Original ledger record exists');
  assert(retrievedOriginal?.amount_kobo === 500000, 'Test D.4: Original amount_kobo 500,000 is preserved intact');
  assert(retrievedOriginal?.balance_after_kobo === 500000, 'Test D.5: Original snapshot is preserved intact');
  console.log('  -> PASS: Test D & E (Immutability & Conflict) verified.\n');

  // --------------------------------------------------------------------------
  // TEST F: References & Schema Validation
  // --------------------------------------------------------------------------
  console.log('Test F: References and schema validation...');

  const malformedRefEntry: any = {
    ...creditEntry,
    id: 'led_malformed_ref',
    transaction_reference: '', // Invalid empty reference
  };
  assertThrows(
    () => validateLedgerEntry(malformedRefEntry),
    ErrorCodes.INVALID_LEDGER_ENTRY,
    'Empty transaction reference must be rejected'
  );

  const malformedActorEntry: any = {
    ...creditEntry,
    id: 'led_malformed_actor',
    actor: { type: 'INVALID_TYPE', id: testUserA },
  };
  assertThrows(
    () => validateLedgerEntry(malformedActorEntry),
    ErrorCodes.INVALID_LEDGER_ENTRY,
    'Invalid actor type must be rejected'
  );
  console.log('  -> PASS: Test F (References & Schema) verified.\n');

  // --------------------------------------------------------------------------
  // TEST G: Ownership & Multi-tenant Isolation
  // --------------------------------------------------------------------------
  console.log('Test G: Ownership and multi-tenant isolation...');

  // G.1: Attempting to insert entry where user_id does not match target wallet
  const spoofedEntry: LedgerDocument = {
    ...creditEntry,
    id: 'led_spoofed_001',
    wallet_id: testUserB, // Spoofed target
    user_id: testUserA,
  };

  try {
    await createLedgerEntry(testUserB, spoofedEntry);
    assert(false, 'Spoofed user_id must throw INVALID_LEDGER_ENTRY');
  } catch (err: any) {
    assert(err.code === ErrorCodes.INVALID_LEDGER_ENTRY, 'Test G.1: Mismatched wallet/user ID rejected');
  }

  // G.2: User B cannot retrieve User A's ledger entry
  const userBCrossAccess = await getLedgerEntry(testUserB, 'led_test_credit_001');
  assert(userBCrossAccess === null, 'Test G.2: User B cannot access User A ledger entry (returns null)');
  console.log('  -> PASS: Test G (Ownership & Isolation) verified.\n');

  // --------------------------------------------------------------------------
  // TEST H: Cursor Pagination & Deterministic Sorting
  // --------------------------------------------------------------------------
  console.log('Test H: Cursor-based pagination and deterministic DESC sorting...');

  // Query User A's ledger with page size 2
  const page1 = await queryLedgerByWalletId(testUserA, { limit: 2 });
  assert(page1.items.length === 2, 'Test H.1: Page 1 returns 2 items');
  assert(page1.hasMore === true, 'Test H.2: Page 1 hasMore is true');
  assert(page1.nextCursor !== null, 'Test H.3: Page 1 provides nextCursor');
  assert(page1.items[0].id === 'led_test_refund_003', 'Test H.4: First item is most recent (REFUND at 10:10)');
  assert(page1.items[1].id === 'led_test_debit_002', 'Test H.5: Second item is (DEBIT at 10:05)');

  // Query Page 2 using cursor
  const page2 = await queryLedgerByWalletId(testUserA, { limit: 2, cursor: page1.nextCursor! });
  assert(page2.items.length === 1, 'Test H.6: Page 2 returns remaining 1 item');
  assert(page2.hasMore === false, 'Test H.7: Page 2 hasMore is false');
  assert(page2.nextCursor === null, 'Test H.8: Page 2 nextCursor is null');
  assert(page2.items[0].id === 'led_test_credit_001', 'Test H.9: Page 2 item is oldest (CREDIT at 10:00)');

  // Filter by entry_type DEBIT
  const debitFilter = await queryLedgerByWalletId(testUserA, { entry_type: LedgerEntryType.DEBIT });
  assert(debitFilter.items.length === 1, 'Test H.10: entry_type filter returns only DEBIT entries');
  assert(debitFilter.items[0].id === 'led_test_debit_002', 'Test H.11: Filtered entry ID matches');
  console.log('  -> PASS: Test H (Cursor Pagination) verified.\n');

  console.log('====================================================');
  console.log('ALL STAGE 2.5.2 TEST SUITES PASSED SUCCESSFULLY (100%)');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\n❌ STAGE 2.5.2 TEST SUITE FAILED:', err);
  process.exit(1);
});
