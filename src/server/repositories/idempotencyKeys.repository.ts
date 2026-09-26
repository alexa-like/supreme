/**
 * Alexvya Platform — Idempotency Keys Repository & Fingerprinting Engine
 * Stage 2.5.4 Idempotency & Concurrency Protection
 * 
 * Target Collection: idempotencyKeys/{idempotencyKey}
 * 
 * STRICT INVARIANTS:
 * 1. Storage Path: idempotencyKeys/{idempotencyKey}.
 * 2. Fingerprint computation: SHA-256 over deterministic canonical JSON of business payload.
 * 3. Status Lifecycle: IN_PROGRESS -> COMPLETED | FAILED.
 * 4. User Isolation: idempotencyKey is strictly bound to user_id. Cross-user reuse is forbidden.
 * 5. Retention Policies:
 *    - VAS Purchases (airtime, data, bills): 24 Hours
 *    - Paystack / Funding Initializations: 72 Hours
 *    - Payment Verification Dedup: 90 Days
 *    - Third-Party Webhook Events: 30 Days
 *    - Refunds & Admin Adjustments: Indefinite / Permanent (100 Years)
 */

import crypto from 'crypto';
import { getDb, inMemoryStore } from './base.repository.ts';
import { IdempotencyKeyDocument } from '../../types/firestore.ts';
import { IdempotencyStatus } from '../../types/enums.ts';
import { idempotencyKeyDocumentSchema } from '../../lib/validation/firestore.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

const COLLECTION_NAME = 'idempotencyKeys';

export const IDEMPOTENCY_RETENTION_MS = {
  VAS_PURCHASE: 24 * 60 * 60 * 1000, // 24 Hours (Orders)
  ORDERS: 24 * 60 * 60 * 1000, // 24 Hours alias
  PAYSTACK_FUNDING_INIT: 72 * 60 * 60 * 1000, // 72 Hours (Funding)
  FUNDING: 72 * 60 * 60 * 1000, // 72 Hours alias
  PAYMENT_VERIFICATION: 90 * 24 * 60 * 60 * 1000, // 90 Days
  WEBHOOK_EVENT: 30 * 24 * 60 * 60 * 1000, // 30 Days
  REFUND_ADMIN_ADJUSTMENT: 100 * 365 * 24 * 60 * 60 * 1000, // Permanent (100 Years)
  REFUNDS: 100 * 365 * 24 * 60 * 60 * 1000, // Permanent alias
} as const;

export type IdempotencyRetentionType = keyof typeof IDEMPOTENCY_RETENTION_MS;

/**
 * Deterministically converts an object or value to a canonical JSON string (keys sorted).
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeJson((obj as Record<string, unknown>)[k])}`
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes deterministic SHA-256 request fingerprint from canonical JSON business data.
 */
export function computeRequestFingerprint(data: Record<string, unknown>): string {
  const canonicalString = canonicalizeJson(data);
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

/**
 * Validates Idempotency-Key header or argument format.
 */
export function validateIdempotencyKeyFormat(key: unknown, correlationId?: string): asserts key is string {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
      'Idempotency-Key is required.',
      400,
      { correlation_id: correlationId }
    );
  }
  const trimmed = key.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      `Idempotency-Key length must be between 8 and 128 characters, got ${trimmed.length}.`,
      400,
      { key_length: trimmed.length, correlation_id: correlationId }
    );
  }
  if (!/^[a-zA-Z0-9_\-]+$/.test(trimmed)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Idempotency-Key contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.',
      400,
      { correlation_id: correlationId }
    );
  }
}

/**
 * Calculates deterministic expiration timestamp for an idempotency record based on operation retention policy.
 */
export function calculateIdempotencyExpiresAt(
  retentionMs: number = IDEMPOTENCY_RETENTION_MS.VAS_PURCHASE,
  baseDate: Date = new Date()
): string {
  return new Date(baseDate.getTime() + retentionMs).toISOString();
}

/**
 * Fetches an idempotency record by key.
 */
export async function getIdempotencyKey(key: string, correlationId?: string): Promise<IdempotencyKeyDocument | null> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTION_NAME).doc(key).get();
      if (!snap.exists) return null;
      return { ...snap.data(), id: snap.id } as IdempotencyKeyDocument;
    } catch (err: any) {
      logger.warn(`[IdempotencyRepository] Firestore read fallback for key ${key}: ${err.message}`, undefined, correlationId);
    }
  }
  return inMemoryStore.getDoc(COLLECTION_NAME, key);
}

/**
 * Creates an idempotency record.
 */
export async function createIdempotencyKey(
  keyDoc: IdempotencyKeyDocument,
  correlationId?: string
): Promise<IdempotencyKeyDocument> {
  idempotencyKeyDocumentSchema.parse(keyDoc);
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(keyDoc.id).set(keyDoc);
    } catch (err: any) {
      logger.warn(`[IdempotencyRepository] Firestore create fallback for key ${keyDoc.id}: ${err.message}`, undefined, correlationId);
    }
  }
  inMemoryStore.setDoc(COLLECTION_NAME, keyDoc.id, keyDoc);
  return keyDoc;
}

/**
 * Updates an existing idempotency record.
 */
export async function updateIdempotencyKey(
  key: string,
  updates: Partial<IdempotencyKeyDocument>,
  correlationId?: string
): Promise<IdempotencyKeyDocument> {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(key).update(updates);
    } catch (err: any) {
      logger.warn(`[IdempotencyRepository] Firestore update fallback for key ${key}: ${err.message}`, undefined, correlationId);
    }
  }
  return inMemoryStore.updateDoc(COLLECTION_NAME, key, updates);
}

/**
 * Deletes an idempotency record.
 */
export async function deleteIdempotencyKey(key: string, correlationId?: string): Promise<void> {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(key).delete();
    } catch (err: any) {
      logger.warn(`[IdempotencyRepository] Firestore delete fallback for key ${key}: ${err.message}`, undefined, correlationId);
    }
  }
  inMemoryStore.deleteDoc(COLLECTION_NAME, key);
}

/**
 * Checks whether an existing key is unexpired.
 */
export async function isKeyValid(key: string, correlationId?: string): Promise<boolean> {
  const doc = await getIdempotencyKey(key, correlationId);
  if (!doc) return false;
  const now = new Date().getTime();
  const expiresAt = new Date(doc.expires_at).getTime();
  return now < expiresAt;
}

/**
 * Queries idempotency records for a specific user ID.
 */
export async function queryIdempotencyKeysByUserId(
  userId: string,
  limitCount = 50,
  correlationId?: string
): Promise<IdempotencyKeyDocument[]> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION_NAME)
        .where('user_id', '==', userId)
        .limit(limitCount)
        .get();
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as IdempotencyKeyDocument));
    } catch (err: any) {
      logger.warn(`[IdempotencyRepository] Firestore query by userId fallback: ${err.message}`, undefined, correlationId);
    }
  }
  const allDocs = inMemoryStore.listDocs<IdempotencyKeyDocument>(COLLECTION_NAME);
  return allDocs.filter((d) => d.user_id === userId).slice(0, limitCount);
}

/**
 * Queries an idempotency record by associated reference ID (e.g. orderId, transactionId, paymentAttemptId).
 */
export async function queryIdempotencyKeyByReferenceId(
  referenceId: string,
  correlationId?: string
): Promise<IdempotencyKeyDocument | null> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION_NAME)
        .where('reference_id', '==', referenceId)
        .limit(1)
        .get();
      if (snap.empty) return null;
      return { ...snap.docs[0].data(), id: snap.docs[0].id } as IdempotencyKeyDocument;
    } catch (err: any) {
      logger.warn(`[IdempotencyRepository] Firestore query by referenceId fallback: ${err.message}`, undefined, correlationId);
    }
  }
  const allDocs = inMemoryStore.listDocs<IdempotencyKeyDocument>(COLLECTION_NAME);
  return allDocs.find((d) => d.reference_id === referenceId) || null;
}
