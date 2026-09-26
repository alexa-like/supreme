/**
 * Alexvya Platform — Payment Attempts Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: paymentAttempts/{paymentAttemptId}
 */

import { inMemoryStore, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { PaymentAttemptDocument } from '../../types/firestore.ts';
import { paymentAttemptDocumentSchema } from '../../lib/validation/firestore.ts';

const COLLECTION_NAME = 'paymentAttempts';

export async function getPaymentAttemptById(paymentAttemptId: string): Promise<PaymentAttemptDocument | null> {
  return inMemoryStore.getDoc(COLLECTION_NAME, paymentAttemptId);
}

export async function getPaymentAttemptByReference(gatewayReference: string): Promise<PaymentAttemptDocument | null> {
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  for (const doc of col.values()) {
    if (doc.gateway_reference === gatewayReference) {
      return doc as PaymentAttemptDocument;
    }
  }
  return null;
}

export async function getPaymentAttemptByTransactionId(transactionId: string): Promise<PaymentAttemptDocument | null> {
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  for (const doc of col.values()) {
    if (doc.transaction_id === transactionId) {
      return doc as PaymentAttemptDocument;
    }
  }
  return null;
}

export async function createPaymentAttempt(paymentAttempt: PaymentAttemptDocument): Promise<PaymentAttemptDocument> {
  paymentAttemptDocumentSchema.parse(paymentAttempt);
  inMemoryStore.setDoc(COLLECTION_NAME, paymentAttempt.id, paymentAttempt);
  return paymentAttempt;
}

export async function queryPaymentAttemptsByUser(
  userId: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<PaymentAttemptDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  const attempts: PaymentAttemptDocument[] = Array.from(col.values())
    .filter((p) => p.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = attempts.findIndex((p) => p.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = attempts.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < attempts.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: attempts.length,
  };
}

export async function updatePaymentAttempt(
  paymentAttemptId: string,
  updates: Partial<PaymentAttemptDocument>
): Promise<PaymentAttemptDocument | null> {
  const existing = await getPaymentAttemptById(paymentAttemptId);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  paymentAttemptDocumentSchema.parse(updated);
  inMemoryStore.setDoc(COLLECTION_NAME, paymentAttemptId, updated);
  return updated;
}

