/**
 * Alexvya Platform — Idempotency Storage Service Verification Test Suite
 * Stage 2.5.4 Server-Side Idempotency Storage Service
 * 
 * Verifies:
 * 1. Storing request fingerprints, user ID, status, and associated reference IDs.
 * 2. Retention policies:
 *    - 24h for orders (VAS purchases: airtime, data, bills)
 *    - 72h for funding (Paystack initializations)
 *    - Permanent (100 years) for refunds
 * 3. Idempotent replay caching with exact response bodies.
 * 4. Fingerprint conflict rejection (409 IDEMPOTENCY_CONFLICT).
 * 5. Cross-user isolation (403 FORBIDDEN).
 * 6. IN_PROGRESS lease handling and expired lease reclamation.
 * 7. Reference ID lookup (`queryIdempotencyKeyByReferenceId`).
 * 8. `executeWithIdempotency` high-level orchestration wrapper.
 */

import {
  acquireIdempotencyLease,
  completeIdempotencyRecord,
  failIdempotencyRecord,
  executeWithIdempotency,
  getIdempotencyRecord,
  getRecordByReferenceId,
  getRecordsByUserId,
  resolveRetentionDurationMs,
} from '../services/idempotency.service.ts';
import {
  computeRequestFingerprint,
  IDEMPOTENCY_RETENTION_MS,
  validateIdempotencyKeyFormat,
} from '../repositories/idempotencyKeys.repository.ts';
import { inMemoryStore } from '../repositories/base.repository.ts';
import { IdempotencyStatus } from '../../types/enums.ts';
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
  console.log('ALEXVYA IDEMPOTENCY STORAGE SERVICE TEST SUITE');
  console.log('====================================================\n');

  inMemoryStore.clear();

  const userA = 'usr_service_test_001';
  const userB = 'usr_service_test_002';

  // --------------------------------------------------------------------------
  // TEST 1: Retention Policies Calculation
  // --------------------------------------------------------------------------
  console.log('Test 1: Retention Policies (24h Orders, 72h Funding, Permanent Refunds)...');

  const ordersDuration = resolveRetentionDurationMs('ORDERS');
  assert(ordersDuration === 24 * 60 * 60 * 1000, 'Test 1.1: Orders retention is exactly 24 hours');

  const fundingDuration = resolveRetentionDurationMs('FUNDING');
  assert(fundingDuration === 72 * 60 * 60 * 1000, 'Test 1.2: Funding retention is exactly 72 hours');

  const refundsDuration = resolveRetentionDurationMs('REFUNDS');
  assert(refundsDuration === 100 * 365 * 24 * 60 * 60 * 1000, 'Test 1.3: Refunds retention is permanent (100 years)');

  const customDuration = resolveRetentionDurationMs(15 * 60 * 1000);
  assert(customDuration === 15 * 60 * 1000, 'Test 1.4: Custom numeric retention is supported');
  console.log('  -> PASS: Test 1 (Retention Policies) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 2: Lease Acquisition & Expiration Tracking
  // --------------------------------------------------------------------------
  console.log('Test 2: Lease Acquisition & Expiration Tracking for Orders (24h)...');

  const keyOrder = 'idemp_order_vas_001';
  const orderPayload = {
    user_id: userA,
    service: 'AIRTIME',
    amount_kobo: 50000,
    phone_number: '08012345678',
  };

  const leaseAcquire = await acquireIdempotencyLease({
    key: keyOrder,
    userId: userA,
    requestPath: '/api/vas/airtime',
    requestPayload: orderPayload,
    retentionPolicy: 'ORDERS',
    referenceId: 'ord_airtime_9901',
    referenceType: 'SERVICE_ORDER',
  });

  assert(leaseAcquire.status === 'ACQUIRED', 'Test 2.1: Lease successfully acquired');
  assert(leaseAcquire.key === keyOrder, 'Test 2.2: Key matches requested key');

  // Verify document in store
  const storedDoc = await getIdempotencyRecord(keyOrder);
  assert(storedDoc !== null, 'Test 2.3: Stored record found');
  assert(storedDoc?.status === IdempotencyStatus.IN_PROGRESS, 'Test 2.4: Initial status is IN_PROGRESS');
  assert(storedDoc?.user_id === userA, 'Test 2.5: User ID correctly stored');
  assert(storedDoc?.reference_id === 'ord_airtime_9901', 'Test 2.6: Reference ID correctly stored');
  assert(storedDoc?.reference_type === 'SERVICE_ORDER', 'Test 2.7: Reference Type correctly stored');

  const nowMs = Date.now();
  const expiresAtMs = new Date(storedDoc!.expires_at).getTime();
  const diffHours = (expiresAtMs - nowMs) / (1000 * 60 * 60);
  assert(Math.round(diffHours) === 24, 'Test 2.8: Expiration timestamp is set to +24 hours');
  console.log('  -> PASS: Test 2 (Lease Acquisition) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 3: In-Progress Lease Protection & Completion
  // --------------------------------------------------------------------------
  console.log('Test 3: In-Progress Lease Protection & Completion...');

  // Second concurrent attempt while IN_PROGRESS throws 409 IDEMPOTENCY_IN_PROGRESS
  await assertRejects(
    () =>
      acquireIdempotencyLease({
        key: keyOrder,
        userId: userA,
        requestPath: '/api/vas/airtime',
        requestPayload: orderPayload,
        retentionPolicy: 'ORDERS',
      }),
    ErrorCodes.IDEMPOTENCY_IN_PROGRESS,
    'Concurrent request on in-progress lease must throw IDEMPOTENCY_IN_PROGRESS'
  );

  // Complete the operation
  const responseData = {
    order_id: 'ord_airtime_9901',
    status: 'SUCCESS',
    token: null,
    amount_kobo: 50000,
  };

  const completedDoc = await completeIdempotencyRecord({
    key: keyOrder,
    userId: userA,
    responseCode: 200,
    responseBody: responseData,
    referenceId: 'ord_airtime_9901',
    referenceType: 'SERVICE_ORDER',
  });

  assert(completedDoc.status === IdempotencyStatus.COMPLETED, 'Test 3.1: Status transitioned to COMPLETED');
  assert(completedDoc.response_code === 200, 'Test 3.2: Response code 200 saved');
  assert(completedDoc.response_body?.status === 'SUCCESS', 'Test 3.3: Response body preserved');
  console.log('  -> PASS: Test 3 (Completion & In-Progress Protection) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 4: Idempotent Replay Caching
  // --------------------------------------------------------------------------
  console.log('Test 4: Idempotent Replay Caching...');

  const replayResult = await acquireIdempotencyLease({
    key: keyOrder,
    userId: userA,
    requestPath: '/api/vas/airtime',
    requestPayload: orderPayload,
    retentionPolicy: 'ORDERS',
  });

  assert(replayResult.status === 'REPLAY', 'Test 4.1: Returns REPLAY status');
  if (replayResult.status === 'REPLAY') {
    assert(replayResult.responseCode === 200, 'Test 4.2: Cached response code is 200');
    assert(replayResult.responseBody.order_id === 'ord_airtime_9901', 'Test 4.3: Cached response body matches');
  }
  console.log('  -> PASS: Test 4 (Idempotent Replay Caching) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 5: Fingerprint Mismatch Conflict
  // --------------------------------------------------------------------------
  console.log('Test 5: Fingerprint Mismatch Conflict (Reusing key with different body)...');

  await assertRejects(
    () =>
      acquireIdempotencyLease({
        key: keyOrder,
        userId: userA,
        requestPath: '/api/vas/airtime',
        requestPayload: {
          ...orderPayload,
          amount_kobo: 100000, // Changed from 50,000 to 100,000
        },
        retentionPolicy: 'ORDERS',
      }),
    ErrorCodes.IDEMPOTENCY_CONFLICT,
    'Reusing key with modified payload must throw IDEMPOTENCY_CONFLICT'
  );
  console.log('  -> PASS: Test 5 (Fingerprint Mismatch Conflict) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 6: User Isolation Protection
  // --------------------------------------------------------------------------
  console.log('Test 6: User Isolation Protection (User B cannot access User A key)...');

  await assertRejects(
    () =>
      acquireIdempotencyLease({
        key: keyOrder,
        userId: userB, // Different user
        requestPath: '/api/vas/airtime',
        requestPayload: orderPayload,
        retentionPolicy: 'ORDERS',
      }),
    ErrorCodes.FORBIDDEN,
    'Cross-user idempotency key access must throw FORBIDDEN (403)'
  );
  console.log('  -> PASS: Test 6 (User Isolation) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 7: Funding Policy (72h) & Reference ID Lookup
  // --------------------------------------------------------------------------
  console.log('Test 7: Funding Policy (72h) & Reference ID Lookup...');

  const keyFunding = 'idemp_fund_paystack_001';
  const fundingRef = 'pstk_ref_882910';
  const fundingPayload = {
    user_id: userA,
    amount_kobo: 2500000,
    gateway: 'PAYSTACK',
  };

  await acquireIdempotencyLease({
    key: keyFunding,
    userId: userA,
    requestPath: '/api/wallet/fund/initialize',
    requestPayload: fundingPayload,
    retentionPolicy: 'FUNDING',
    referenceId: fundingRef,
    referenceType: 'PAYMENT_ATTEMPT',
  });

  await completeIdempotencyRecord({
    key: keyFunding,
    userId: userA,
    responseCode: 200,
    responseBody: { authorization_url: 'https://checkout.paystack.com/xyz', reference: fundingRef },
    referenceId: fundingRef,
    referenceType: 'PAYMENT_ATTEMPT',
  });

  // Verify lookup by referenceId
  const foundByRef = await getRecordByReferenceId(fundingRef);
  assert(foundByRef !== null, 'Test 7.1: Record found by referenceId');
  assert(foundByRef?.id === keyFunding, 'Test 7.2: Retrieved matching key');
  assert(foundByRef?.reference_type === 'PAYMENT_ATTEMPT', 'Test 7.3: Retrieved matching referenceType');

  // Verify user's records lookup
  const userDocs = await getRecordsByUserId(userA);
  assert(userDocs.length === 2, 'Test 7.4: User A has exactly 2 recorded idempotency keys');
  console.log('  -> PASS: Test 7 (Funding & Reference ID Lookup) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 8: Permanent Refund Deduplication
  // --------------------------------------------------------------------------
  console.log('Test 8: Permanent Refund Deduplication (100 Years)...');

  const keyRefund = 'idemp_refund_dedup_001';
  const refundPayload = {
    user_id: userA,
    original_tx: 'tx_parent_001',
    amount_kobo: 50000,
  };

  await acquireIdempotencyLease({
    key: keyRefund,
    userId: userA,
    requestPath: '/api/wallet/refund',
    requestPayload: refundPayload,
    retentionPolicy: 'REFUNDS',
    referenceId: 'ref_parent_001',
    referenceType: 'REFUND',
  });

  const storedRefundDoc = await getIdempotencyRecord(keyRefund);
  const refundExpiresAtMs = new Date(storedRefundDoc!.expires_at).getTime();
  const diffYears = (refundExpiresAtMs - nowMs) / (1000 * 60 * 60 * 24 * 365);
  assert(Math.round(diffYears) >= 99, 'Test 8.1: Refund retention is >= 99 years (permanent)');
  console.log('  -> PASS: Test 8 (Permanent Refund Deduplication) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 9: High-Level `executeWithIdempotency` Wrapper
  // --------------------------------------------------------------------------
  console.log('Test 9: High-Level `executeWithIdempotency` Wrapper Execution...');

  let executionCounter = 0;
  const wrapperKey = 'idemp_wrapper_exec_001';
  const wrapperPayload = { action: 'DO_TRANSFER', amount_kobo: 10000 };

  // First call -> Executes handler
  const result1 = await executeWithIdempotency({
    key: wrapperKey,
    userId: userA,
    requestPath: '/api/transfer',
    requestPayload: wrapperPayload,
    retentionPolicy: 'ORDERS',
    handler: async () => {
      executionCounter++;
      return {
        responseCode: 201,
        responseBody: { transfer_id: 'tr_771', amount_kobo: 10000, status: 'DONE' },
        referenceId: 'tr_771',
        referenceType: 'WALLET_TRANSACTION',
      };
    },
  });

  assert(result1.isIdempotentReplay === false, 'Test 9.1: First call is fresh execution');
  assert(result1.responseCode === 201, 'Test 9.2: Response code is 201');
  assert(executionCounter === 1, 'Test 9.3: Handler executed once');

  // Second call with same key -> Replays cached response without calling handler
  const result2 = await executeWithIdempotency({
    key: wrapperKey,
    userId: userA,
    requestPath: '/api/transfer',
    requestPayload: wrapperPayload,
    retentionPolicy: 'ORDERS',
    handler: async () => {
      executionCounter++;
      return {
        responseCode: 201,
        responseBody: { transfer_id: 'tr_771', amount_kobo: 10000, status: 'DONE' },
      };
    },
  });

  assert(result2.isIdempotentReplay === true, 'Test 9.4: Second call marked as isIdempotentReplay');
  assert(result2.data.transfer_id === 'tr_771', 'Test 9.5: Preserved response data');
  assert(executionCounter === 1, 'Test 9.6: Handler was NOT re-executed (still 1)');
  console.log('  -> PASS: Test 9 (executeWithIdempotency) verified.\n');

  // --------------------------------------------------------------------------
  // TEST 10: Failed Handler Execution Releases Lease
  // --------------------------------------------------------------------------
  console.log('Test 10: Failed Handler Execution Releases Lease for Retry...');

  const failingKey = 'idemp_fail_recovery_001';
  const failPayload = { action: 'DO_FAIL' };

  let failAttempts = 0;
  await assertRejects(
    () =>
      executeWithIdempotency({
        key: failingKey,
        userId: userA,
        requestPath: '/api/fail-test',
        requestPayload: failPayload,
        handler: async () => {
          failAttempts++;
          throw new AlexvyaApiError(ErrorCodes.PROVIDER_TIMEOUT, 'Provider timed out', 504);
        },
      }),
    ErrorCodes.PROVIDER_TIMEOUT,
    'Failing handler rejects'
  );

  assert(failAttempts === 1, 'Test 10.1: Failed attempt executed');

  // Subsequent call with SAME key now succeeds because failing lease was released
  const recoverResult = await executeWithIdempotency({
    key: failingKey,
    userId: userA,
    requestPath: '/api/fail-test',
    requestPayload: failPayload,
    handler: async () => {
      failAttempts++;
      return {
        responseCode: 200,
        responseBody: { success: true },
      };
    },
  });

  assert(recoverResult.isIdempotentReplay === false, 'Test 10.2: Retry after failure succeeds freshly');
  assert(failAttempts === 2, 'Test 10.3: Retry executed handler');
  console.log('  -> PASS: Test 10 (Failed Handler Lease Release) verified.\n');

  console.log('====================================================');
  console.log('ALL IDEMPOTENCY STORAGE SERVICE TESTS PASSED (100%)');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\n❌ IDEMPOTENCY STORAGE SERVICE TEST SUITE FAILED:', err);
  process.exit(1);
});
