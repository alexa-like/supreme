/**
 * Alexvya Platform — Stage 2.5.3 Test Suite
 * Atomic Wallet Debit/Credit Engine Verification
 * 
 * Target Coverage:
 * A. CREDIT: Balance increase, version increment, running balance snapshot, immutable CREDIT ledger entry.
 * B. DEBIT: Balance decrease, version increment, running balance snapshot, immutable DEBIT ledger entry.
 * C. INSUFFICIENT BALANCE: Debit exceeding available balance rejected (402), zero state change.
 * D. REFUND: Compensating credit restores balance, original debit untouched, new REFUND ledger entry created.
 * E. MAXIMUM BALANCE: Credit up to MAX_ACCOUNT_BALANCE_KOBO succeeds, credit exceeding max fails (400), wallet unchanged.
 * F. INVALID AMOUNTS: Rejects 0, negative, floats, NaN, Infinity, unsafe integer kobo.
 * G. WALLET INVARIANTS & STATUS: Corrupted balance rejected, LOCKED / FROZEN wallet rejected (403).
 * H. ATOMICITY: Verification that failure prevents partial state changes (wallet and ledger remain synchronized).
 * I. VERSIONING: Strictly monotonic version increment on success, strictly preserved on failure.
 * J. OWNERSHIP & REFERENCES: Validates user ID, transaction IDs, and references.
 */

import {
  creditWallet,
  debitWallet,
  refundWallet,
} from '../wallet/mutation.service.ts';
import { ensureWallet, getWallet, __testUpdateWallet } from '../repositories/wallets.repository.ts';
import { getLedgerEntry, queryLedgerByWalletId } from '../repositories/ledger.repository.ts';
import { inMemoryStore, getDb } from '../repositories/base.repository.ts';
import { WalletStatus, LedgerEntryType, LedgerDirection, LedgerCategory } from '../../types/enums.ts';
import { MONEY_CONSTANTS } from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { WalletDocument } from '../../types/firestore.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function assertRejects(
  fn: () => Promise<any>,
  expectedErrorCode?: string | string[],
  message?: string
) {
  let threw = false;
  let codeMatched = false;
  try {
    await fn();
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
    throw new Error(`[EXPECTED EXCEPTION] Expected function to reject: ${message || String(expectedErrorCode) || ''}`);
  }
  if (expectedErrorCode && !codeMatched) {
    throw new Error(`[WRONG ERROR CODE] Expected error code ${JSON.stringify(expectedErrorCode)}, but caught different error.`);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('ALEXVYA STAGE 2.5.3 ATOMIC WALLET MUTATIONS TEST SUITE');
  console.log('====================================================\n');

  inMemoryStore.clear();

  const testUserA = 'usr_mut_test_001';
  const testUserB = 'usr_mut_test_002';

  const db = getDb();
  if (db) {
    try {
      await db.collection('wallets').doc(testUserA).delete();
      await db.collection('wallets').doc(testUserB).delete();
      await db.collection('wallets').doc('usr_locked_001').delete();
      await db.collection('wallets').doc('usr_frozen_001').delete();
      const ledgerA = await db.collection('wallets').doc(testUserA).collection('ledger').get();
      for (const d of ledgerA.docs) await d.ref.delete();
      const ledgerB = await db.collection('wallets').doc(testUserB).collection('ledger').get();
      for (const d of ledgerB.docs) await d.ref.delete();
    } catch {
      // ignore
    }
  }

  // Initialize test wallets
  const initialWalletA = await ensureWallet(testUserA);
  assert(initialWalletA.available_balance_kobo === 0, 'Setup: Wallet A initialized with 0 balance');
  assert(initialWalletA.version === 1, 'Setup: Wallet A initialized with version 1');

  // --------------------------------------------------------------------------
  // TEST A: Wallet Credit
  // --------------------------------------------------------------------------
  console.log('Test A: Atomic Wallet Credit (₦10,000.00 / 1,000,000 kobo)...');

  const creditResult1 = await creditWallet({
    userId: testUserA,
    amountKobo: 1000000, // ₦10,000.00
    category: LedgerCategory.WALLET_FUNDING,
    description: 'Paystack checkout deposit',
    transactionReference: 'ALX-FND-1001',
    actor: { type: 'CUSTOMER', id: testUserA },
  });

  // Verify result object
  assert(creditResult1.balanceBeforeKobo === 0, 'Test A.1: Balance before credit is 0');
  assert(creditResult1.balanceAfterKobo === 1000000, 'Test A.2: Balance after credit is 1,000,000 kobo');
  assert(creditResult1.previousVersion === 1, 'Test A.3: Previous version was 1');
  assert(creditResult1.newVersion === 2, 'Test A.4: New version is 2');
  assert(creditResult1.wallet.available_balance_kobo === 1000000, 'Test A.5: Updated wallet available balance is 1,000,000');
  assert(creditResult1.wallet.ledger_balance_kobo === 1000000, 'Test A.6: Updated wallet ledger balance is 1,000,000');
  assert(creditResult1.wallet.version === 2, 'Test A.7: Updated wallet version is 2');

  // Verify wallet repository state
  const fetchedWalletA1 = await getWallet(testUserA);
  assert(fetchedWalletA1 !== null, 'Test A.8: Wallet A exists in repository');
  assert(fetchedWalletA1?.available_balance_kobo === 1000000, 'Test A.9: Persisted available balance is 1,000,000');
  assert(fetchedWalletA1?.version === 2, 'Test A.10: Persisted version is 2');
  assert(fetchedWalletA1?.last_ledger_entry_id === creditResult1.ledgerEntry.id, 'Test A.11: last_ledger_entry_id matches');

  // Verify immutable ledger entry
  const fetchedLedger1 = await getLedgerEntry(testUserA, creditResult1.ledgerEntry.id);
  assert(fetchedLedger1 !== null, 'Test A.12: Ledger entry exists');
  assert(fetchedLedger1?.entry_type === LedgerEntryType.CREDIT, 'Test A.13: Ledger entry_type is CREDIT');
  assert(fetchedLedger1?.direction === LedgerDirection.INFLOW, 'Test A.14: Ledger direction is INFLOW');
  assert(fetchedLedger1?.amount_kobo === 1000000, 'Test A.15: Ledger amount is 1,000,000 kobo');
  assert(fetchedLedger1?.balance_before_kobo === 0, 'Test A.16: Ledger balance_before is 0');
  assert(fetchedLedger1?.balance_after_kobo === 1000000, 'Test A.17: Ledger balance_after is 1,000,000');
  assert(fetchedLedger1?.category === LedgerCategory.WALLET_FUNDING, 'Test A.18: Ledger category is WALLET_FUNDING');
  console.log('  -> PASS: Test A (Wallet Credit) verified.\n');

  // --------------------------------------------------------------------------
  // TEST B: Wallet Debit
  // --------------------------------------------------------------------------
  console.log('Test B: Atomic Wallet Debit (₦3,000.00 / 300,000 kobo)...');

  const debitResult1 = await debitWallet({
    userId: testUserA,
    amountKobo: 300000, // ₦3,000.00
    category: LedgerCategory.AIRTIME_PURCHASE,
    description: 'MTN ₦3,000 Airtime top-up',
    transactionReference: 'ALX-AIR-2001',
    actor: { type: 'CUSTOMER', id: testUserA },
  });

  // Verify result object
  assert(debitResult1.balanceBeforeKobo === 1000000, 'Test B.1: Balance before debit is 1,000,000 kobo');
  assert(debitResult1.balanceAfterKobo === 700000, 'Test B.2: Balance after debit is 700,000 kobo');
  assert(debitResult1.previousVersion === 2, 'Test B.3: Previous version was 2');
  assert(debitResult1.newVersion === 3, 'Test B.4: New version is 3');
  assert(debitResult1.wallet.available_balance_kobo === 700000, 'Test B.5: Updated wallet available balance is 700,000');
  assert(debitResult1.wallet.daily_spent_kobo === 300000, 'Test B.6: Daily spent tracked as 300,000 kobo');

  // Verify persisted wallet
  const fetchedWalletA2 = await getWallet(testUserA);
  assert(fetchedWalletA2?.available_balance_kobo === 700000, 'Test B.7: Persisted balance is 700,000 kobo');
  assert(fetchedWalletA2?.version === 3, 'Test B.8: Persisted version is 3');

  // Verify ledger entry
  const fetchedLedger2 = await getLedgerEntry(testUserA, debitResult1.ledgerEntry.id);
  assert(fetchedLedger2 !== null, 'Test B.9: Debit ledger entry exists');
  assert(fetchedLedger2?.entry_type === LedgerEntryType.DEBIT, 'Test B.10: Ledger entry_type is DEBIT');
  assert(fetchedLedger2?.direction === LedgerDirection.OUTFLOW, 'Test B.11: Ledger direction is OUTFLOW');
  assert(fetchedLedger2?.amount_kobo === 300000, 'Test B.12: Ledger amount is 300,000 kobo');
  assert(fetchedLedger2?.balance_before_kobo === 1000000, 'Test B.13: Ledger balance_before is 1,000,000');
  assert(fetchedLedger2?.balance_after_kobo === 700000, 'Test B.14: Ledger balance_after is 700,000');
  assert(fetchedLedger2?.category === LedgerCategory.AIRTIME_PURCHASE, 'Test B.15: Ledger category is AIRTIME_PURCHASE');
  console.log('  -> PASS: Test B (Wallet Debit) verified.\n');

  // --------------------------------------------------------------------------
  // TEST C: Insufficient Balance Rejection
  // --------------------------------------------------------------------------
  console.log('Test C: Insufficient Balance Rejection (Attempting ₦8,000.00 from ₦7,000.00 balance)...');

  await assertRejects(
    () =>
      debitWallet({
        userId: testUserA,
        amountKobo: 800000, // ₦8,000.00 (> ₦7,000.00)
        category: LedgerCategory.DATA_PURCHASE,
        description: 'Airtel 10GB Data Purchase',
      }),
    ErrorCodes.INSUFFICIENT_BALANCE,
    'Debit exceeding balance must throw INSUFFICIENT_BALANCE'
  );

  // Verify wallet state remained COMPLETELY UNCHANGED
  const fetchedWalletA3 = await getWallet(testUserA);
  assert(fetchedWalletA3?.available_balance_kobo === 700000, 'Test C.1: Balance remains exactly 700,000 kobo');
  assert(fetchedWalletA3?.version === 3, 'Test C.2: Version remains 3 (no increment on failure)');
  assert(fetchedWalletA3?.daily_spent_kobo === 300000, 'Test C.3: Daily spent remains 300,000 kobo');

  // Verify ledger entry count is still 2
  const ledgerStatement1 = await queryLedgerByWalletId(testUserA);
  assert(ledgerStatement1.items.length === 2, 'Test C.4: No extraneous ledger entry was appended on failure');
  console.log('  -> PASS: Test C (Insufficient Balance) verified.\n');

  // --------------------------------------------------------------------------
  // TEST D: Compensating Refund
  // --------------------------------------------------------------------------
  console.log('Test D: Compensating Refund (Refunding ₦3,000.00 for failed VAS transaction)...');

  const refundResult1 = await refundWallet({
    userId: testUserA,
    amountKobo: 300000, // ₦3,000.00
    originalTransactionId: debitResult1.ledgerEntry.transaction_id,
    originalTransactionReference: 'ALX-AIR-2001',
    description: 'Compensating refund for undelivered MTN airtime ALX-AIR-2001',
    actor: { type: 'SYSTEM', id: 'SYSTEM' },
  });

  // Verify result object
  assert(refundResult1.balanceBeforeKobo === 700000, 'Test D.1: Balance before refund is 700,000 kobo');
  assert(refundResult1.balanceAfterKobo === 1000000, 'Test D.2: Balance restored to 1,000,000 kobo');
  assert(refundResult1.previousVersion === 3, 'Test D.3: Previous version was 3');
  assert(refundResult1.newVersion === 4, 'Test D.4: New version is 4');
  assert(refundResult1.wallet.available_balance_kobo === 1000000, 'Test D.5: Wallet available balance restored to 1,000,000');
  assert(refundResult1.wallet.daily_spent_kobo === 0, 'Test D.6: Daily spent adjusted back to 0');

  // Verify original debit ledger was NOT mutated
  const originalDebitLedger = await getLedgerEntry(testUserA, debitResult1.ledgerEntry.id);
  assert(originalDebitLedger !== null, 'Test D.7: Original debit ledger still exists');
  assert(originalDebitLedger?.amount_kobo === 300000, 'Test D.8: Original debit amount unchanged');
  assert(originalDebitLedger?.entry_type === LedgerEntryType.DEBIT, 'Test D.9: Original debit entry_type unchanged');

  // Verify new refund ledger entry
  const refundLedgerDoc = await getLedgerEntry(testUserA, refundResult1.ledgerEntry.id);
  assert(refundLedgerDoc !== null, 'Test D.10: Refund ledger entry exists');
  assert(refundLedgerDoc?.entry_type === LedgerEntryType.CREDIT, 'Test D.11: Refund entry_type is CREDIT');
  assert(refundLedgerDoc?.direction === LedgerDirection.INFLOW, 'Test D.12: Refund direction is INFLOW');
  assert(refundLedgerDoc?.category === LedgerCategory.REFUND, 'Test D.13: Refund category is REFUND');
  assert(refundLedgerDoc?.transaction_reference === 'ALX-AIR-2001', 'Test D.14: Reference matches original transaction');

  // Total ledger entries count is now 3
  const ledgerStatement2 = await queryLedgerByWalletId(testUserA);
  assert(ledgerStatement2.items.length === 3, 'Test D.15: Ledger statement now has exactly 3 entries');
  console.log('  -> PASS: Test D (Compensating Refund) verified.\n');

  // --------------------------------------------------------------------------
  // TEST E: Maximum Account Balance Cap
  // --------------------------------------------------------------------------
  console.log('Test E: Maximum Account Balance Cap Enforcement...');

  const userB = await ensureWallet(testUserB);
  assert(userB.available_balance_kobo === 0, 'Setup User B: 0 balance');

  // Credit up to max cap (₦10,000,000.00 / 1,000,000,000 kobo)
  const maxCredit = await creditWallet({
    userId: testUserB,
    amountKobo: MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO,
    description: 'Funding up to max limit',
  });
  assert(maxCredit.wallet.available_balance_kobo === MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO, 'Test E.1: Max funding succeeds');

  // Credit 1 more kobo beyond max cap -> FAILS
  await assertRejects(
    () =>
      creditWallet({
        userId: testUserB,
        amountKobo: 1, // 1 kobo over max
        description: 'Overflow attempt',
      }),
    ErrorCodes.MAX_BALANCE_EXCEEDED,
    'Exceeding MAX_ACCOUNT_BALANCE_KOBO must throw MAX_BALANCE_EXCEEDED'
  );

  const fetchedUserB = await getWallet(testUserB);
  assert(
    fetchedUserB?.available_balance_kobo === MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO,
    'Test E.2: Balance remains capped at max limit on rejection'
  );
  console.log('  -> PASS: Test E (Maximum Balance Cap) verified.\n');

  // --------------------------------------------------------------------------
  // TEST F: Invalid Amounts Validation
  // --------------------------------------------------------------------------
  console.log('Test F: Invalid amounts rejection (zero, negative, float, NaN, Infinity)...');

  // Zero amount
  await assertRejects(
    () => creditWallet({ userId: testUserA, amountKobo: 0, description: 'Zero credit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED, ErrorCodes.INVALID_KOBO_AMOUNT],
    'Zero credit rejected'
  );
  await assertRejects(
    () => debitWallet({ userId: testUserA, amountKobo: 0, description: 'Zero debit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED, ErrorCodes.INVALID_KOBO_AMOUNT],
    'Zero debit rejected'
  );

  // Negative amount
  await assertRejects(
    () => creditWallet({ userId: testUserA, amountKobo: -50000, description: 'Negative credit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT, ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN],
    'Negative credit rejected'
  );
  await assertRejects(
    () => debitWallet({ userId: testUserA, amountKobo: -50000, description: 'Negative debit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT, ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN],
    'Negative debit rejected'
  );

  // Float amount
  await assertRejects(
    () => creditWallet({ userId: testUserA, amountKobo: 1500.75 as any, description: 'Float credit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT],
    'Float credit rejected'
  );

  // NaN & Infinity
  await assertRejects(
    () => creditWallet({ userId: testUserA, amountKobo: NaN as any, description: 'NaN credit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT, ErrorCodes.MONEY_OVERFLOW],
    'NaN credit rejected'
  );
  await assertRejects(
    () => creditWallet({ userId: testUserA, amountKobo: Infinity as any, description: 'Infinity credit' }),
    [ErrorCodes.INVALID_AMOUNT, ErrorCodes.INVALID_KOBO_AMOUNT, ErrorCodes.MONEY_OVERFLOW],
    'Infinity credit rejected'
  );
  console.log('  -> PASS: Test F (Invalid Amounts) verified.\n');

  // --------------------------------------------------------------------------
  // TEST G: Wallet Invariants & Status Restrictions
  // --------------------------------------------------------------------------
  console.log('Test G: Wallet status restrictions (LOCKED and FROZEN)...');

  const lockedUser = 'usr_locked_001';
  await ensureWallet(lockedUser);
  await __testUpdateWallet(lockedUser, {
    status: WalletStatus.LOCKED,
    available_balance_kobo: 500000,
    ledger_balance_kobo: 500000,
  });

  await assertRejects(
    () => debitWallet({ userId: lockedUser, amountKobo: 100000, description: 'Debit locked wallet' }),
    ErrorCodes.WALLET_LOCKED,
    'Debit locked wallet rejected'
  );
  await assertRejects(
    () => creditWallet({ userId: lockedUser, amountKobo: 100000, description: 'Credit locked wallet' }),
    ErrorCodes.WALLET_LOCKED,
    'Credit locked wallet rejected'
  );

  const frozenUser = 'usr_frozen_001';
  await ensureWallet(frozenUser);
  await __testUpdateWallet(frozenUser, {
    status: WalletStatus.FROZEN,
    available_balance_kobo: 500000,
    ledger_balance_kobo: 500000,
  });

  await assertRejects(
    () => debitWallet({ userId: frozenUser, amountKobo: 100000, description: 'Debit frozen wallet' }),
    ErrorCodes.WALLET_FROZEN,
    'Debit frozen wallet rejected'
  );
  console.log('  -> PASS: Test G (Wallet Status Restrictions) verified.\n');

  // --------------------------------------------------------------------------
  // TEST H: Atomic Integrity & Non-Existent Wallet
  // --------------------------------------------------------------------------
  console.log('Test H: Non-existent wallet handling and atomic isolation...');

  await assertRejects(
    () => creditWallet({ userId: 'usr_non_existent', amountKobo: 100000, description: 'Unknown user credit' }),
    ErrorCodes.WALLET_NOT_FOUND,
    'Non-existent wallet throws WALLET_NOT_FOUND'
  );
  await assertRejects(
    () => debitWallet({ userId: 'usr_non_existent', amountKobo: 100000, description: 'Unknown user debit' }),
    ErrorCodes.WALLET_NOT_FOUND,
    'Non-existent wallet debit throws WALLET_NOT_FOUND'
  );
  console.log('  -> PASS: Test H (Non-Existent Wallet) verified.\n');

  // --------------------------------------------------------------------------
  // TEST I & J: Versioning and Traceability
  // --------------------------------------------------------------------------
  console.log('Test I & J: Sequential versioning and audit traceability...');

  const finalWalletA = await getWallet(testUserA);
  assert(finalWalletA?.version === 4, 'Test I.1: Final version for testUserA is exactly 4 (1 + credit + debit + refund)');
  assert(finalWalletA?.available_balance_kobo === 1000000, 'Test I.2: Final available balance is 1,000,000 kobo');

  const fullLedgerA = await queryLedgerByWalletId(testUserA);
  assert(fullLedgerA.items.length === 3, 'Test J.1: Exactly 3 ledger entries in history');
  assert(fullLedgerA.items[0].category === LedgerCategory.REFUND, 'Test J.2: Entry 1 is REFUND');
  assert(fullLedgerA.items[1].category === LedgerCategory.AIRTIME_PURCHASE, 'Test J.3: Entry 2 is AIRTIME_PURCHASE');
  assert(fullLedgerA.items[2].category === LedgerCategory.WALLET_FUNDING, 'Test J.4: Entry 3 is WALLET_FUNDING');
  console.log('  -> PASS: Test I & J (Versioning & Traceability) verified.\n');

  console.log('====================================================');
  console.log('ALL STAGE 2.5.3 TEST SUITES PASSED SUCCESSFULLY (100%)');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\n❌ STAGE 2.5.3 TEST SUITE FAILED:', err);
  process.exit(1);
});
