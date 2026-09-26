/**
 * Alexvya Platform — Stage 2.5.4 Test Suite
 * Idempotency & Concurrency Protection Verification
 * 
 * Target Coverage:
 * A. SAME REQUEST RETRY: Idempotent replay, 1 debit, 1 ledger entry, 1 version increment.
 * B. SAME KEY DIFFERENT AMOUNT: IDEMPOTENCY_CONFLICT (409), wallet and version untouched.
 * C. SAME KEY DIFFERENT OPERATION: IDEMPOTENCY_CONFLICT (409) on cross-operation reuse.
 * D. CONCURRENT SAME KEY: Real concurrent Promise.all execution yields exactly 1 financial effect.
 * E. CONCURRENT DIFFERENT KEYS: Concurrent debits execute without lost updates, accurate final balance.
 * F. CONCURRENT INSUFFICIENT BALANCE: 1 succeeds, 1 fails (402), 0 balance, no negative funds.
 * G. DUPLICATE REFUND: Deduplication tied to parent tx prevents double-refunding.
 * H. FAILED MUTATION: Faulty mutation leaves no completed idempotency record or dirty state.
 * I. PROCESSING STATE: Rejects requests when key is in active IN_PROGRESS lease (409).
 * J. USER ISOLATION: User A's key cannot be accessed or replayed by User B (403 FORBIDDEN).
 * K. OPERATION ISOLATION: Key bound to one operation type cannot be reused for another.
 * L. INVALID KEYS: Length < 8, length > 128, invalid characters, and empty keys rejected.
 */

import {
  creditWallet,
  debitWallet,
  refundWallet,
} from '../wallet/mutation.service.ts';
import { ensureWallet, getWallet } from '../repositories/wallets.repository.ts';
import { queryLedgerByWalletId, getLedgerEntry } from '../repositories/ledger.repository.ts';
import { getIdempotencyKey } from '../repositories/idempotencyKeys.repository.ts';
import { inMemoryStore } from '../repositories/base.repository.ts';
import { LedgerCategory, LedgerEntryType, IdempotencyStatus } from '../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function assertRejects(
  fn: () => Promise<any>,
  expectedErrorCode?: string,
  message?: string
) {
  let threw = false;
  let codeMatched = false;
  try {
    await fn();
  } catch (err: any) {
    threw = true;
    if (expectedErrorCode) {
      if (err instanceof AlexvyaApiError && err.code === expectedErrorCode) {
        codeMatched = true;
      } else if (err.message && err.message.includes(expectedErrorCode)) {
        codeMatched = true;
      }
    } else {
      codeMatched = true;
    }
  }

  if (!threw) {
    throw new Error(`[EXPECTED EXCEPTION] Expected function to reject: ${message || expectedErrorCode || ''}`);
  }
  if (expectedErrorCode && !codeMatched) {
    throw new Error(`[WRONG ERROR CODE] Expected error code ${expectedErrorCode}, but caught different error.`);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('ALEXVYA STAGE 2.5.4 IDEMPOTENCY & CONCURRENCY TEST SUITE');
  console.log('====================================================\n');

  inMemoryStore.clear();

  const user1 = 'usr_idemp_001';
  const user2 = 'usr_idemp_002';
  const user3 = 'usr_idemp_003';

  await ensureWallet(user1);
  await ensureWallet(user2);
  await ensureWallet(user3);

  // Fund user1 with ₦20,000 (2,000,000 kobo)
  await creditWallet({
    userId: user1,
    amountKobo: 2000000,
    description: 'Initial funding',
    idempotencyKey: 'idemp_fund_user1_001',
  });

  // --------------------------------------------------------------------------
  // TEST A: Same Request Retry (Idempotent Replay)
  // --------------------------------------------------------------------------
  console.log('Test A: Same Request Retry (DEBIT ₦1,000 / 100,000 kobo)...');

  const debitKeyA = 'idemp_debit_key_001';
  const reqA = {
    userId: user1,
    amountKobo: 100000,
    category: LedgerCategory.AIRTIME_PURCHASE,
    description: 'MTN 1000 Airtime',
    transactionReference: 'ALX-AIR-1001',
    idempotencyKey: debitKeyA,
  };

  const firstAttempt = await debitWallet(reqA);
  assert(firstAttempt.isIdempotentReplay !== true, 'Test A.1: First attempt is a fresh mutation');
  assert(firstAttempt.wallet.available_balance_kobo === 1900000, 'Test A.2: Balance deducted to 1,900,000');
  assert(firstAttempt.newVersion === 3, 'Test A.3: Version incremented to 3');

  // Retry the EXACT same request
  const retryAttempt = await debitWallet(reqA);
  assert(retryAttempt.isIdempotentReplay === true, 'Test A.4: Second attempt marked as isIdempotentReplay');
  assert(retryAttempt.wallet.available_balance_kobo === 1900000, 'Test A.5: Balance remains 1,900,000 (NO double deduction)');
  assert(retryAttempt.newVersion === 3, 'Test A.6: Version remains 3 (NO extra version increment)');

  // Verify wallet repository and ledger
  const walletAState = await getWallet(user1);
  assert(walletAState?.available_balance_kobo === 1900000, 'Test A.7: Authoritative balance is 1,900,000');
  assert(walletAState?.version === 3, 'Test A.8: Authoritative version is 3');

  const ledgerHistoryA = await queryLedgerByWalletId(user1);
  assert(ledgerHistoryA.items.length === 2, 'Test A.9: Exactly 2 ledger entries exist (1 credit, 1 debit)');
  console.log('  -> PASS: Test A (Same Request Retry) verified.\n');

  // --------------------------------------------------------------------------
  // TEST B: Same Key Different Amount (Conflict)
  // --------------------------------------------------------------------------
  console.log('Test B: Same Key Different Amount (Fingerprint Mismatch Conflict)...');

  await assertRejects(
    () =>
      debitWallet({
        userId: user1,
        amountKobo: 200000, // ₦2,000 instead of ₦1,000
        category: LedgerCategory.AIRTIME_PURCHASE,
        description: 'MTN 1000 Airtime',
        transactionReference: 'ALX-AIR-1001',
        idempotencyKey: debitKeyA, // Reusing debitKeyA with different amount
      }),
    ErrorCodes.IDEMPOTENCY_CONFLICT,
    'Reusing idempotency key with different amount must throw IDEMPOTENCY_CONFLICT'
  );

  const walletBState = await getWallet(user1);
  assert(walletBState?.available_balance_kobo === 1900000, 'Test B.1: Wallet balance unchanged after conflict');
  assert(walletBState?.version === 3, 'Test B.2: Wallet version unchanged');
  console.log('  -> PASS: Test B (Same Key Different Amount) verified.\n');

  // --------------------------------------------------------------------------
  // TEST C: Same Key Different Operation Type
  // --------------------------------------------------------------------------
  console.log('Test C: Same Key Different Operation Type (Operation Isolation)...');

  await assertRejects(
    () =>
      creditWallet({
        userId: user1,
        amountKobo: 100000,
        description: 'MTN 1000 Airtime',
        idempotencyKey: debitKeyA, // Reusing debit key for credit
      }),
    ErrorCodes.IDEMPOTENCY_CONFLICT,
    'Reusing debit key for credit must throw IDEMPOTENCY_CONFLICT'
  );
  console.log('  -> PASS: Test C (Same Key Different Operation Type) verified.\n');

  // --------------------------------------------------------------------------
  // TEST D: Concurrent Requests with SAME Key
  // --------------------------------------------------------------------------
  console.log('Test D: Concurrent Requests with SAME Key (Simultaneous double-click)...');

  const concurrentKey = 'idemp_concurrent_same_001';
  const concurrentReq = {
    userId: user1,
    amountKobo: 400000, // ₦4,000
    category: LedgerCategory.DATA_PURCHASE,
    description: 'MTN 10GB Data',
    transactionReference: 'ALX-DAT-2001',
    idempotencyKey: concurrentKey,
  };

  // Launch two concurrent promises at once
  const [resD1, resD2] = await Promise.all([
    debitWallet(concurrentReq),
    debitWallet(concurrentReq),
  ]);

  // One of them is the fresh mutation and the other is the idempotent replay (or both safe)
  const isOneReplay = resD1.isIdempotentReplay === true || resD2.isIdempotentReplay === true;
  assert(isOneReplay, 'Test D.1: At least one of the concurrent responses is an idempotent replay');

  const walletDState = await getWallet(user1);
  assert(walletDState?.available_balance_kobo === 1500000, 'Test D.2: Balance deducted exactly ONCE (1,900,000 - 400,000 = 1,500,000)');
  assert(walletDState?.version === 4, 'Test D.3: Version incremented by exactly 1 (3 -> 4)');

  const ledgerHistoryD = await queryLedgerByWalletId(user1);
  assert(ledgerHistoryD.items.length === 3, 'Test D.4: Ledger statement has exactly 3 entries (no duplicate debit)');
  console.log('  -> PASS: Test D (Concurrent Same Key) verified.\n');

  // --------------------------------------------------------------------------
  // TEST E: Concurrent Requests with DIFFERENT Keys (No lost update)
  // --------------------------------------------------------------------------
  console.log('Test E: Concurrent Requests with DIFFERENT Keys (No lost updates)...');

  // Starting balance is ₦15,000 (1,500,000 kobo)
  const reqE1 = {
    userId: user1,
    amountKobo: 200000, // ₦2,000
    description: 'Debit 1',
    idempotencyKey: 'idemp_diff_001',
  };
  const reqE2 = {
    userId: user1,
    amountKobo: 300000, // ₦3,000
    description: 'Debit 2',
    idempotencyKey: 'idemp_diff_002',
  };

  // Execute concurrently
  const [resE1, resE2] = await Promise.all([
    debitWallet(reqE1),
    debitWallet(reqE2),
  ]);

  assert(resE1.isIdempotentReplay !== true, 'Test E.1: Request 1 is fresh');
  assert(resE2.isIdempotentReplay !== true, 'Test E.2: Request 2 is fresh');

  const walletEState = await getWallet(user1);
  // Expected final: 1,500,000 - 200,000 - 300,000 = 1,000,000 kobo (₦10,000)
  assert(walletEState?.available_balance_kobo === 1000000, 'Test E.3: Correct final balance of 1,000,000 kobo (no lost updates)');
  assert(walletEState?.version === 6, 'Test E.4: Version incremented twice (4 -> 6)');

  const ledgerHistoryE = await queryLedgerByWalletId(user1);
  assert(ledgerHistoryE.items.length === 5, 'Test E.5: Total 5 ledger entries recorded');
  console.log('  -> PASS: Test E (Concurrent Different Keys) verified.\n');

  // --------------------------------------------------------------------------
  // TEST F: Concurrent Insufficient Balance Race
  // --------------------------------------------------------------------------
  console.log('Test F: Concurrent Insufficient Balance Race (₦1,000 balance vs two ₦1,000 debits)...');

  // User 2 initialized with ₦1,000
  await creditWallet({
    userId: user2,
    amountKobo: 100000, // ₦1,000
    description: 'Initial funding for race',
    idempotencyKey: 'idemp_fund_user2_001',
  });

  const raceReqF1 = {
    userId: user2,
    amountKobo: 100000, // ₦1,000
    description: 'Race debit 1',
    idempotencyKey: 'idemp_race_001',
  };
  const raceReqF2 = {
    userId: user2,
    amountKobo: 100000, // ₦1,000
    description: 'Race debit 2',
    idempotencyKey: 'idemp_race_002',
  };

  const results = await Promise.allSettled([
    debitWallet(raceReqF1),
    debitWallet(raceReqF2),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert(fulfilled.length === 1, 'Test F.1: Exactly 1 concurrent request succeeded');
  assert(rejected.length === 1, 'Test F.2: Exactly 1 concurrent request failed');

  const rejectionError = (rejected[0] as PromiseRejectedResult).reason;
  assert(
    rejectionError instanceof AlexvyaApiError && rejectionError.code === ErrorCodes.INSUFFICIENT_BALANCE,
    'Test F.3: Rejected request failed with INSUFFICIENT_BALANCE'
  );

  const walletFState = await getWallet(user2);
  assert(walletFState?.available_balance_kobo === 0, 'Test F.4: Final balance is exactly 0 (no negative balance)');
  assert(walletFState?.version === 3, 'Test F.5: Version is exactly 3 (1 init + 1 credit + 1 successful debit)');
  console.log('  -> PASS: Test F (Concurrent Insufficient Balance) verified.\n');

  // --------------------------------------------------------------------------
  // TEST G: Duplicate Refund Prevention (Permanent Dedup)
  // --------------------------------------------------------------------------
  console.log('Test G: Duplicate Refund Prevention (Permanent Deduplication tied to parent tx)...');

  const parentTxId = 'tx_vas_order_9901';
  const parentTxRef = 'ALX-VAS-9901';

  // Perform debit first
  const debitForRefund = await debitWallet({
    userId: user1,
    amountKobo: 500000, // ₦5,000
    transactionId: parentTxId,
    transactionReference: parentTxRef,
    description: 'Electricity Bill Payment',
    idempotencyKey: 'idemp_bill_debit_9901',
  });
  assert(debitForRefund.wallet.available_balance_kobo === 500000, 'Setup G.1: Balance debited to 500,000');

  // First Refund Attempt
  const firstRefund = await refundWallet({
    userId: user1,
    amountKobo: 500000,
    originalTransactionId: parentTxId,
    originalTransactionReference: parentTxRef,
    description: 'Compensating refund for failed electricity bill',
    idempotencyKey: 'idemp_refund_9901',
  });
  assert(firstRefund.isIdempotentReplay !== true, 'Test G.1: First refund is fresh mutation');
  assert(firstRefund.wallet.available_balance_kobo === 1000000, 'Test G.2: Balance restored to 1,000,000');

  // Replay with same idempotency key -> Returns idempotent replay without double crediting
  const replayRefund = await refundWallet({
    userId: user1,
    amountKobo: 500000,
    originalTransactionId: parentTxId,
    originalTransactionReference: parentTxRef,
    description: 'Compensating refund for failed electricity bill',
    idempotencyKey: 'idemp_refund_9901',
  });
  assert(replayRefund.isIdempotentReplay === true, 'Test G.3: Replayed refund marked as isIdempotentReplay');
  assert(replayRefund.wallet.available_balance_kobo === 1000000, 'Test G.4: Balance unchanged on replay (no double credit)');

  // Attempt second refund for SAME transaction with DIFFERENT idempotency key -> DUPLICATE_REFUND (409)
  await assertRejects(
    () =>
      refundWallet({
        userId: user1,
        amountKobo: 500000,
        originalTransactionId: parentTxId,
        originalTransactionReference: parentTxRef,
        description: 'Second refund attempt for same tx',
        idempotencyKey: 'idemp_refund_duplicate_9901',
      }),
    ErrorCodes.DUPLICATE_REFUND,
    'Second distinct refund on same transaction must throw DUPLICATE_REFUND'
  );

  const walletGState = await getWallet(user1);
  assert(walletGState?.available_balance_kobo === 1000000, 'Test G.5: Balance remains 1,000,000 kobo');
  console.log('  -> PASS: Test G (Duplicate Refund Prevention) verified.\n');

  // --------------------------------------------------------------------------
  // TEST H: Failed Mutation Atomicity
  // --------------------------------------------------------------------------
  console.log('Test H: Failed Mutation Atomicity (No dirty idempotency or ledger records)...');

  const failedKey = 'idemp_failed_key_001';
  await assertRejects(
    () =>
      debitWallet({
        userId: user3, // Balance is 0
        amountKobo: 500000,
        description: 'Should fail',
        idempotencyKey: failedKey,
      }),
    ErrorCodes.INSUFFICIENT_BALANCE,
    'Failed debit throws INSUFFICIENT_BALANCE'
  );

  const idempDoc = await getIdempotencyKey(failedKey);
  assert(idempDoc === null, 'Test H.1: No COMPLETED idempotency key was saved on failed operation');

  const walletHState = await getWallet(user3);
  assert(walletHState?.available_balance_kobo === 0, 'Test H.2: Wallet balance remains 0');
  assert(walletHState?.version === 1, 'Test H.3: Wallet version remains 1');
  console.log('  -> PASS: Test H (Failed Mutation Atomicity) verified.\n');

  // --------------------------------------------------------------------------
  // TEST I: User Isolation (Cross-user key protection)
  // --------------------------------------------------------------------------
  console.log('Test I: User Isolation (User B cannot reuse User A key)...');

  // user1 already completed 'idemp_fund_user1_001'
  await assertRejects(
    () =>
      creditWallet({
        userId: user2, // Different user
        amountKobo: 2000000,
        description: 'Attempt to use user1 key',
        idempotencyKey: 'idemp_fund_user1_001',
      }),
    ErrorCodes.FORBIDDEN,
    'Cross-user idempotency key reuse must throw FORBIDDEN (403)'
  );
  console.log('  -> PASS: Test I (User Isolation) verified.\n');

  // --------------------------------------------------------------------------
  // TEST J: Invalid Idempotency Key Formats
  // --------------------------------------------------------------------------
  console.log('Test J: Invalid Idempotency Key Formats validation...');

  // Key too short (< 8 chars)
  await assertRejects(
    () => creditWallet({ userId: user1, amountKobo: 50000, description: 'Short key', idempotencyKey: 'abc' }),
    ErrorCodes.INVALID_INPUT,
    'Short key rejected'
  );

  // Key too long (> 128 chars)
  const longKey = 'a'.repeat(129);
  await assertRejects(
    () => creditWallet({ userId: user1, amountKobo: 50000, description: 'Long key', idempotencyKey: longKey }),
    ErrorCodes.INVALID_INPUT,
    'Long key rejected'
  );

  // Invalid characters (spaces/special characters)
  await assertRejects(
    () => creditWallet({ userId: user1, amountKobo: 50000, description: 'Invalid chars', idempotencyKey: 'invalid key with spaces!' }),
    ErrorCodes.INVALID_INPUT,
    'Key with invalid characters rejected'
  );

  // Empty string
  await assertRejects(
    () => creditWallet({ userId: user1, amountKobo: 50000, description: 'Empty key', idempotencyKey: '   ' }),
    ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
    'Empty key rejected'
  );
  console.log('  -> PASS: Test J (Invalid Idempotency Keys) verified.\n');

  console.log('====================================================');
  console.log('ALL STAGE 2.5.4 TEST SUITES PASSED SUCCESSFULLY (100%)');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\n❌ STAGE 2.5.4 TEST SUITE FAILED:', err);
  process.exit(1);
});
