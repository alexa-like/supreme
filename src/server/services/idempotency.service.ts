/**
 * Alexvya Platform — Server-Side Idempotency Storage & Concurrency Lease Service
 * Stage 2.5.4 Idempotency & Concurrency Protection
 * 
 * Target Collection: idempotencyKeys/{idempotencyKey}
 * 
 * STRICT INVARIANTS:
 * 1. Storage: Collection `idempotencyKeys/{idempotencyKey}`.
 * 2. Request Fingerprinting: Deterministic SHA-256 over canonical JSON of business payload.
 * 3. Status Lifecycle: IN_PROGRESS -> COMPLETED | FAILED.
 * 4. User Isolation: Idempotency keys are strictly scoped to authenticated user_id.
 * 5. Retention Policies:
 *    - Orders (VAS purchases: airtime, data, bills): 24 Hours
 *    - Funding (Paystack, bank transfers): 72 Hours
 *    - Refunds & Admin Adjustments: Indefinite / Permanent (100 Years)
 *    - Payment Verification: 90 Days
 *    - Webhook Events: 30 Days
 * 6. Reference IDs: Supports tracking associated order_id, transaction_id, refund_ref, payment_attempt_id.
 */

import { getDb, inMemoryStore } from '../repositories/base.repository.ts';
import {
  getIdempotencyKey,
  createIdempotencyKey,
  updateIdempotencyKey,
  deleteIdempotencyKey,
  queryIdempotencyKeyByReferenceId,
  queryIdempotencyKeysByUserId,
  computeRequestFingerprint,
  validateIdempotencyKeyFormat,
  calculateIdempotencyExpiresAt,
  IDEMPOTENCY_RETENTION_MS,
  IdempotencyRetentionType,
} from '../repositories/idempotencyKeys.repository.ts';
import { IdempotencyKeyDocument } from '../../types/firestore.ts';
import { IdempotencyStatus } from '../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

export {
  computeRequestFingerprint,
} from '../repositories/idempotencyKeys.repository.ts';

const COLLECTION_NAME = 'idempotencyKeys';
const DEFAULT_LEASE_TIMEOUT_MS = 60 * 1000; // 60 seconds lease timeout for IN_PROGRESS

export type RetentionPolicyType =
  | 'ORDERS'
  | 'VAS_PURCHASE'
  | 'FUNDING'
  | 'PAYSTACK_FUNDING_INIT'
  | 'PAYMENT_VERIFICATION'
  | 'WEBHOOK'
  | 'WEBHOOK_EVENT'
  | 'REFUNDS'
  | 'REFUND_ADMIN_ADJUSTMENT'
  | number;

export interface AcquireIdempotencyParams {
  key: string;
  userId: string;
  requestPath: string;
  requestPayload: Record<string, unknown>;
  retentionPolicy?: RetentionPolicyType;
  referenceId?: string | null;
  referenceType?: string | null;
  leaseTimeoutMs?: number;
  correlationId?: string;
}

export type AcquireIdempotencyResult =
  | {
      status: 'ACQUIRED';
      key: string;
      requestHash: string;
      expiresAt: string;
    }
  | {
      status: 'REPLAY';
      key: string;
      responseCode: number;
      responseBody: Record<string, unknown>;
      record: IdempotencyKeyDocument;
    };

export interface CompleteIdempotencyParams {
  key: string;
  userId: string;
  responseCode: number;
  responseBody: Record<string, unknown>;
  referenceId?: string | null;
  referenceType?: string | null;
  correlationId?: string;
}

export interface FailIdempotencyParams {
  key: string;
  userId: string;
  error?: unknown;
  allowImmediateRetry?: boolean;
  correlationId?: string;
}

export interface ExecuteIdempotentOptions<T> {
  key?: string;
  userId: string;
  requestPath: string;
  requestPayload: Record<string, unknown>;
  retentionPolicy?: RetentionPolicyType;
  referenceId?: string | null;
  referenceType?: string | null;
  leaseTimeoutMs?: number;
  correlationId?: string;
  handler: (context: { key: string; requestHash: string }) => Promise<{
    responseCode?: number;
    responseBody: T;
    referenceId?: string | null;
    referenceType?: string | null;
  }>;
}

export interface ExecuteIdempotentResult<T> {
  data: T;
  isIdempotentReplay: boolean;
  responseCode: number;
  record?: IdempotencyKeyDocument;
}

/**
 * Resolves retention duration in milliseconds based on policy string or custom numeric value.
 */
export function resolveRetentionDurationMs(policy?: RetentionPolicyType): number {
  if (typeof policy === 'number') {
    return Math.max(1000, policy);
  }
  if (!policy) {
    return IDEMPOTENCY_RETENTION_MS.ORDERS;
  }
  switch (policy) {
    case 'ORDERS':
    case 'VAS_PURCHASE':
      return IDEMPOTENCY_RETENTION_MS.ORDERS;
    case 'FUNDING':
    case 'PAYSTACK_FUNDING_INIT':
      return IDEMPOTENCY_RETENTION_MS.FUNDING;
    case 'PAYMENT_VERIFICATION':
      return IDEMPOTENCY_RETENTION_MS.PAYMENT_VERIFICATION;
    case 'WEBHOOK':
    case 'WEBHOOK_EVENT':
      return IDEMPOTENCY_RETENTION_MS.WEBHOOK_EVENT;
    case 'REFUNDS':
    case 'REFUND_ADMIN_ADJUSTMENT':
      return IDEMPOTENCY_RETENTION_MS.REFUNDS;
    default:
      return IDEMPOTENCY_RETENTION_MS.ORDERS;
  }
}

/**
 * Acquires a concurrency lease or returns an idempotent cached replay response.
 */
export async function acquireIdempotencyLease(
  params: AcquireIdempotencyParams
): Promise<AcquireIdempotencyResult> {
  const {
    key,
    userId,
    requestPath,
    requestPayload,
    retentionPolicy = 'ORDERS',
    referenceId = null,
    referenceType = null,
    leaseTimeoutMs = DEFAULT_LEASE_TIMEOUT_MS,
    correlationId,
  } = params;

  validateIdempotencyKeyFormat(key, correlationId);

  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.UNAUTHORIZED,
      'Authenticated user ID is required for idempotency scope.',
      401,
      { correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();
  const cleanKey = key.trim();
  const requestHash = computeRequestFingerprint(requestPayload);
  const now = new Date();
  const nowIso = now.toISOString();
  const retentionMs = resolveRetentionDurationMs(retentionPolicy);
  const expiresAt = calculateIdempotencyExpiresAt(retentionMs, now);

  const db = getDb();

  // 1. Live Firestore Transaction Lease Path
  if (db) {
    try {
      return await db.runTransaction(async (transaction) => {
        const docRef = db.collection(COLLECTION_NAME).doc(cleanKey);
        const snap = await transaction.get(docRef);

        if (snap.exists) {
          const existing = { ...snap.data(), id: snap.id } as IdempotencyKeyDocument;

          // User Isolation Enforced
          if (existing.user_id !== cleanUserId) {
            throw new AlexvyaApiError(
              ErrorCodes.FORBIDDEN,
              'Idempotency key belongs to another user.',
              403,
              { correlation_id: correlationId }
            );
          }

          // Fingerprint Equality Enforced
          if (existing.request_hash !== requestHash) {
            throw new AlexvyaApiError(
              ErrorCodes.IDEMPOTENCY_CONFLICT,
              'Idempotency key reused with different request payload.',
              409,
              {
                idempotency_key: cleanKey,
                correlation_id: correlationId,
              }
            );
          }

          // If Completed -> Return Cached Replay
          if (existing.status === IdempotencyStatus.COMPLETED && existing.response_body) {
            logger.info(`[IdempotencyService] Replaying cached response for key ${cleanKey}`, undefined, correlationId);
            return {
              status: 'REPLAY',
              key: cleanKey,
              responseCode: existing.response_code || 200,
              responseBody: existing.response_body,
              record: existing,
            };
          }

          // If IN_PROGRESS -> Check Lease Timeout
          if (existing.status === IdempotencyStatus.IN_PROGRESS) {
            const createdAtTime = new Date(existing.created_at).getTime();
            const elapsed = now.getTime() - createdAtTime;
            if (elapsed < leaseTimeoutMs) {
              throw new AlexvyaApiError(
                ErrorCodes.IDEMPOTENCY_IN_PROGRESS,
                'A request with this idempotency key is currently being processed. Please wait.',
                409,
                {
                  idempotency_key: cleanKey,
                  elapsed_ms: elapsed,
                  correlation_id: correlationId,
                }
              );
            }
            logger.warn(
              `[IdempotencyService] Reclaiming expired in-progress lease for key ${cleanKey} (elapsed: ${elapsed}ms)`,
              undefined,
              correlationId
            );
          }
        }

        // New or Reclaimed Lease: Write IN_PROGRESS record
        const newDoc: IdempotencyKeyDocument = {
          id: cleanKey,
          user_id: cleanUserId,
          request_path: requestPath,
          request_hash: requestHash,
          status: IdempotencyStatus.IN_PROGRESS,
          reference_id: referenceId,
          reference_type: referenceType,
          response_code: null,
          response_body: null,
          created_at: nowIso,
          expires_at: expiresAt,
          updated_at: nowIso,
        };

        transaction.set(docRef, newDoc);
        inMemoryStore.setDoc(COLLECTION_NAME, cleanKey, newDoc);

        return {
          status: 'ACQUIRED',
          key: cleanKey,
          requestHash,
          expiresAt,
        };
      });
    } catch (err: any) {
      if (err instanceof AlexvyaApiError) {
        throw err;
      }
      logger.warn(`[IdempotencyService] Firestore lease transaction fallback: ${err.message}`, undefined, correlationId);
    }
  }

  // 2. In-Memory Atomic Fallback Path
  const existing = inMemoryStore.getDoc(COLLECTION_NAME, cleanKey) as IdempotencyKeyDocument | null;
  if (existing) {
    if (existing.user_id !== cleanUserId) {
      throw new AlexvyaApiError(
        ErrorCodes.FORBIDDEN,
        'Idempotency key belongs to another user.',
        403,
        { correlation_id: correlationId }
      );
    }

    if (existing.request_hash !== requestHash) {
      throw new AlexvyaApiError(
        ErrorCodes.IDEMPOTENCY_CONFLICT,
        'Idempotency key reused with different request payload.',
        409,
        { idempotency_key: cleanKey, correlation_id: correlationId }
      );
    }

    if (existing.status === IdempotencyStatus.COMPLETED && existing.response_body) {
      return {
        status: 'REPLAY',
        key: cleanKey,
        responseCode: existing.response_code || 200,
        responseBody: existing.response_body,
        record: existing,
      };
    }

    if (existing.status === IdempotencyStatus.IN_PROGRESS) {
      const createdAtTime = new Date(existing.created_at).getTime();
      const elapsed = now.getTime() - createdAtTime;
      if (elapsed < leaseTimeoutMs) {
        throw new AlexvyaApiError(
          ErrorCodes.IDEMPOTENCY_IN_PROGRESS,
          'A request with this idempotency key is currently being processed. Please wait.',
          409,
          { idempotency_key: cleanKey, elapsed_ms: elapsed, correlation_id: correlationId }
        );
      }
    }
  }

  const newDoc: IdempotencyKeyDocument = {
    id: cleanKey,
    user_id: cleanUserId,
    request_path: requestPath,
    request_hash: requestHash,
    status: IdempotencyStatus.IN_PROGRESS,
    reference_id: referenceId,
    reference_type: referenceType,
    response_code: null,
    response_body: null,
    created_at: nowIso,
    expires_at: expiresAt,
    updated_at: nowIso,
  };

  inMemoryStore.setDoc(COLLECTION_NAME, cleanKey, newDoc);

  return {
    status: 'ACQUIRED',
    key: cleanKey,
    requestHash,
    expiresAt,
  };
}

/**
 * Marks an idempotency record as COMPLETED and persists the resulting response body and reference IDs.
 */
export async function completeIdempotencyRecord(
  params: CompleteIdempotencyParams
): Promise<IdempotencyKeyDocument> {
  const {
    key,
    userId,
    responseCode,
    responseBody,
    referenceId = null,
    referenceType = null,
    correlationId,
  } = params;

  const nowIso = new Date().toISOString();
  const updates: Partial<IdempotencyKeyDocument> = {
    status: IdempotencyStatus.COMPLETED,
    response_code: responseCode,
    response_body: responseBody,
    updated_at: nowIso,
  };

  if (referenceId) {
    updates.reference_id = referenceId;
  }
  if (referenceType) {
    updates.reference_type = referenceType;
  }

  const updatedDoc = await updateIdempotencyKey(key, updates, correlationId);
  logger.info(`[IdempotencyService] Completed idempotency record for key ${key}`, undefined, correlationId);
  return updatedDoc;
}

/**
 * Handles failed idempotency lifecycle. Optionally removes lease to allow immediate retry.
 */
export async function failIdempotencyRecord(
  params: FailIdempotencyParams
): Promise<void> {
  const {
    key,
    userId,
    error,
    allowImmediateRetry = true,
    correlationId,
  } = params;

  if (allowImmediateRetry) {
    await deleteIdempotencyKey(key, correlationId);
    logger.info(`[IdempotencyService] Deleted failed lease for key ${key} to allow immediate retry`, undefined, correlationId);
  } else {
    const nowIso = new Date().toISOString();
    await updateIdempotencyKey(
      key,
      {
        status: IdempotencyStatus.FAILED,
        response_code: 500,
        response_body: {
          error: error instanceof Error ? error.message : String(error || 'Internal error'),
        },
        updated_at: nowIso,
      },
      correlationId
    );
    logger.info(`[IdempotencyService] Marked idempotency record ${key} as FAILED`, undefined, correlationId);
  }
}

/**
 * High-level orchestration wrapper for executing any business operation idempotently.
 */
export async function executeWithIdempotency<T>(
  options: ExecuteIdempotentOptions<T>
): Promise<ExecuteIdempotentResult<T>> {
  const {
    key,
    userId,
    requestPath,
    requestPayload,
    retentionPolicy = 'ORDERS',
    referenceId,
    referenceType,
    leaseTimeoutMs,
    correlationId,
    handler,
  } = options;

  // If no idempotency key is provided, execute standard handler directly
  if (!key || key.trim().length === 0) {
    const directResult = await handler({ key: '', requestHash: '' });
    return {
      data: directResult.responseBody,
      isIdempotentReplay: false,
      responseCode: directResult.responseCode || 200,
    };
  }

  const cleanKey = key.trim();

  // 1. Acquire Lease or Check Replay
  const leaseResult = await acquireIdempotencyLease({
    key: cleanKey,
    userId,
    requestPath,
    requestPayload,
    retentionPolicy,
    referenceId,
    referenceType,
    leaseTimeoutMs,
    correlationId,
  });

  if (leaseResult.status === 'REPLAY') {
    return {
      data: leaseResult.responseBody as unknown as T,
      isIdempotentReplay: true,
      responseCode: leaseResult.responseCode,
      record: leaseResult.record,
    };
  }

  // 2. Execute Handler
  try {
    const executionOutput = await handler({
      key: cleanKey,
      requestHash: leaseResult.requestHash,
    });

    const responseCode = executionOutput.responseCode || 200;
    const finalRefId = executionOutput.referenceId || referenceId || null;
    const finalRefType = executionOutput.referenceType || referenceType || null;

    // 3. Mark COMPLETED
    const completedRecord = await completeIdempotencyRecord({
      key: cleanKey,
      userId,
      responseCode,
      responseBody: executionOutput.responseBody as unknown as Record<string, unknown>,
      referenceId: finalRefId,
      referenceType: finalRefType,
      correlationId,
    });

    return {
      data: executionOutput.responseBody,
      isIdempotentReplay: false,
      responseCode,
      record: completedRecord,
    };
  } catch (handlerErr: any) {
    // 4. Handle Execution Failure -> Release lease for retry
    await failIdempotencyRecord({
      key: cleanKey,
      userId,
      error: handlerErr,
      allowImmediateRetry: true,
      correlationId,
    });
    throw handlerErr;
  }
}

/**
 * Fetches an idempotency record by key.
 */
export async function getIdempotencyRecord(
  key: string,
  correlationId?: string
): Promise<IdempotencyKeyDocument | null> {
  return await getIdempotencyKey(key, correlationId);
}

/**
 * Fetches an idempotency record by associated business reference ID.
 */
export async function getRecordByReferenceId(
  referenceId: string,
  correlationId?: string
): Promise<IdempotencyKeyDocument | null> {
  return await queryIdempotencyKeyByReferenceId(referenceId, correlationId);
}

/**
 * Fetches all idempotency records for a specific user ID.
 */
export async function getRecordsByUserId(
  userId: string,
  limitCount = 50,
  correlationId?: string
): Promise<IdempotencyKeyDocument[]> {
  return await queryIdempotencyKeysByUserId(userId, limitCount, correlationId);
}
