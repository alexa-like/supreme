/**
 * Alexvya Platform — Transactions Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: transactions/{transactionId}
 */

import { getDb, inMemoryStore, recordFirestoreError, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { TransactionDocument } from '../../types/firestore.ts';
import { TransactionStatus, TransactionType } from '../../types/enums.ts';
import { transactionDocumentSchema } from '../../lib/validation/firestore.ts';
import { logger } from '../../lib/logger/logger.ts';

const COLLECTION_NAME = 'transactions';

export async function getTransactionById(transactionId: string): Promise<TransactionDocument | null> {
  const db = getDb();
  if (db) {
    try {
      const doc = await db.collection(COLLECTION_NAME).doc(transactionId).get();
      if (doc.exists) {
        const data = doc.data() as TransactionDocument;
        inMemoryStore.setDoc(COLLECTION_NAME, transactionId, data);
        return data;
      }
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[TransactionsRepository] In-memory read for ${transactionId}`);
    }
  }
  return inMemoryStore.getDoc(COLLECTION_NAME, transactionId);
}

export async function getTransactionByReference(reference: string): Promise<TransactionDocument | null> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTION_NAME).where('reference', '==', reference).limit(1).get();
      if (!snap.empty) {
        const data = snap.docs[0].data() as TransactionDocument;
        inMemoryStore.setDoc(COLLECTION_NAME, snap.docs[0].id, data);
        return data;
      }
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[TransactionsRepository] In-memory query for reference ${reference}`);
    }
  }

  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  for (const doc of col.values()) {
    if (doc.reference === reference) {
      return doc as TransactionDocument;
    }
  }
  return null;
}

export async function createTransaction(transaction: TransactionDocument): Promise<TransactionDocument> {
  transactionDocumentSchema.parse(transaction);
  
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(transaction.id).set(transaction);
    } catch (err: any) {
      recordFirestoreError(err);
      logger.warn(`[TransactionsRepository] Firestore create failed for ${transaction.id}: ${err.message}`);
    }
  }

  inMemoryStore.setDoc(COLLECTION_NAME, transaction.id, transaction);
  return transaction;
}

export interface TransactionQueryOptions extends PaginationOptions {
  status?: TransactionStatus;
  type?: TransactionType;
}

/**
 * Paginated query for transactions belonging to a specific customer.
 * Uses composite index: user_id ASC, created_at DESC (with optional status ASC or type ASC).
 */
export async function queryTransactionsByUser(
  userId: string,
  options: TransactionQueryOptions = {}
): Promise<PaginatedResult<TransactionDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const db = getDb();

  if (db) {
    try {
      let q = db.collection(COLLECTION_NAME).where('user_id', '==', userId);
      if (options.status) q = q.where('status', '==', options.status);
      if (options.type) q = q.where('type', '==', options.type);
      q = q.orderBy('created_at', 'desc').limit(limit + 1);

      const snap = await q.get();
      const docs = snap.docs.map((d) => d.data() as TransactionDocument);
      const hasMore = docs.length > limit;
      const items = hasMore ? docs.slice(0, limit) : docs;
      const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

      // Sync into in-memory store
      items.forEach((item) => inMemoryStore.setDoc(COLLECTION_NAME, item.id, item));

      return {
        items,
        nextCursor,
        hasMore,
        total: items.length,
      };
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[TransactionsRepository] In-memory user query fallback for ${userId}`);
    }
  }

  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  let txs: TransactionDocument[] = Array.from(col.values()).filter((t) => t.user_id === userId);

  if (options.status) {
    txs = txs.filter((t) => t.status === options.status);
  }
  if (options.type) {
    txs = txs.filter((t) => t.type === options.type);
  }

  txs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = txs.findIndex((t) => t.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = txs.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < txs.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: txs.length,
  };
}

/**
 * Paginated query for transactions across the platform (Admin dashboard).
 * Uses composite index: status ASC, created_at DESC or type ASC, status ASC, created_at DESC.
 */
export async function queryTransactionsForAdmin(
  options: TransactionQueryOptions = {}
): Promise<PaginatedResult<TransactionDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const db = getDb();

  if (db) {
    try {
      let q = db.collection(COLLECTION_NAME) as FirebaseFirestore.Query;
      if (options.status) q = q.where('status', '==', options.status);
      if (options.type) q = q.where('type', '==', options.type);
      q = q.orderBy('created_at', 'desc').limit(limit + 1);

      const snap = await q.get();
      const docs = snap.docs.map((d) => d.data() as TransactionDocument);
      const hasMore = docs.length > limit;
      const items = hasMore ? docs.slice(0, limit) : docs;
      const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

      items.forEach((item) => inMemoryStore.setDoc(COLLECTION_NAME, item.id, item));

      return {
        items,
        nextCursor,
        hasMore,
        total: items.length,
      };
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[TransactionsRepository] In-memory admin query fallback`);
    }
  }

  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  let txs: TransactionDocument[] = Array.from(col.values());

  if (options.status) {
    txs = txs.filter((t) => t.status === options.status);
  }
  if (options.type) {
    txs = txs.filter((t) => t.type === options.type);
  }

  txs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = txs.findIndex((t) => t.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = txs.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < txs.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: txs.length,
  };
}

export async function updateTransaction(
  transactionId: string,
  updates: Partial<TransactionDocument>
): Promise<TransactionDocument | null> {
  const existing = await getTransactionById(transactionId);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
  transactionDocumentSchema.parse(updated);

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(transactionId).set(updated, { merge: true });
    } catch (err: any) {
      recordFirestoreError(err);
      logger.warn(`[TransactionsRepository] Firestore update failed for ${transactionId}: ${err.message}`);
    }
  }

  inMemoryStore.setDoc(COLLECTION_NAME, transactionId, updated);
  return updated;
}

