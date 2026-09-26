/**
 * Alexvya Platform — KYC Verifications Repository (Server-Only Foundation)
 * Stage 2.12 KYC, Customer Verification & Tier Management Architecture
 * 
 * Target Collection: kycVerifications/{kycId}
 * 
 * STRICT INVARIANT:
 * Zero client-side direct writes to kycVerifications. All lifecycle transitions
 * are server-authoritative and audited.
 */

import { getDb, inMemoryStore, recordFirestoreError, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { KycVerificationDocument } from '../../types/user.ts';
import { KycStatus } from '../../types/enums.ts';
import { logger } from '../../lib/logger/logger.ts';

const COLLECTION_NAME = 'kycVerifications';

/**
 * Retrieves a KYC verification record by its unique request ID.
 */
export async function getKycVerificationById(id: string): Promise<KycVerificationDocument | null> {
  const db = getDb();
  if (db) {
    try {
      const doc = await db.collection(COLLECTION_NAME).doc(id).get();
      if (doc.exists) {
        return doc.data() as KycVerificationDocument;
      }
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[KycRepository] In-memory read for ${id}`);
    }
  }
  return inMemoryStore.getDoc(COLLECTION_NAME, id);
}

/**
 * Retrieves the latest KYC verification record for a user.
 */
export async function getLatestKycVerificationByUserId(userId: string): Promise<KycVerificationDocument | null> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db
        .collection(COLLECTION_NAME)
        .where('user_id', '==', userId)
        .orderBy('created_at', 'desc')
        .limit(1)
        .get();

      if (!snap.empty) {
        return snap.docs[0].data() as KycVerificationDocument;
      }
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[KycRepository] In-memory query for ${userId}`);
    }
  }

  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  const userDocs = Array.from(col.values())
    .filter((d) => d.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return userDocs[0] || null;
}

/**
 * Creates a new KYC verification document.
 */
export async function createKycVerification(doc: KycVerificationDocument): Promise<KycVerificationDocument> {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(doc.id).set(doc);
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[KycRepository] In-memory create for ${doc.id}`);
    }
  }

  inMemoryStore.setDoc(COLLECTION_NAME, doc.id, doc);
  return doc;
}

/**
 * Updates an existing KYC verification document.
 */
export async function updateKycVerification(
  id: string,
  updates: Partial<KycVerificationDocument>
): Promise<KycVerificationDocument | null> {
  const existing = await getKycVerificationById(id);
  if (!existing) return null;

  const merged: KycVerificationDocument = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
    verification_version: (existing.verification_version || 1) + 1,
  };

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(id).set(merged, { merge: true });
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[KycRepository] In-memory update for ${id}`);
    }
  }

  inMemoryStore.setDoc(COLLECTION_NAME, id, merged);
  return merged;
}

/**
 * Queries KYC verification requests with optional filtering and pagination (for Admin compliance queue).
 */
export async function queryKycVerifications(
  filter: { status?: KycStatus; userId?: string } = {},
  options: PaginationOptions = {}
): Promise<PaginatedResult<KycVerificationDocument>> {
  const limit = sanitizePageLimit(options.limit);

  const db = getDb();
  if (db) {
    try {
      let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

      if (filter.status) {
        query = query.where('status', '==', filter.status);
      }
      if (filter.userId) {
        query = query.where('user_id', '==', filter.userId);
      }

      query = query.orderBy('created_at', 'desc');

      if (options.cursor) {
        const cursorDoc = await db.collection(COLLECTION_NAME).doc(options.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snap = await query.limit(limit + 1).get();
      const items = snap.docs.slice(0, limit).map((d) => d.data() as KycVerificationDocument);
      const hasMore = snap.docs.length > limit;
      const nextCursor = hasMore ? items[items.length - 1].id : null;

      return {
        items,
        nextCursor,
        hasMore,
        total: snap.size,
      };
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[KycRepository] In-memory query fallback`);
    }
  }

  // Fallback to in-memory store
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  let all = Array.from(col.values());

  if (filter.status) {
    all = all.filter((d) => d.status === filter.status);
  }
  if (filter.userId) {
    all = all.filter((d) => d.user_id === filter.userId);
  }

  all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = all.findIndex((d) => d.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = all.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < all.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: all.length,
  };
}
