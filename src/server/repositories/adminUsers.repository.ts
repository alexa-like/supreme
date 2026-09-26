/**
 * Alexvya Platform — Administrative Staff Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: adminUsers/{userId}
 * 
 * STRICT INVARIANT: Database-gated authorization requirement.
 * Privileged actions verify `adminUsers/{userId}.is_active == true`
 * directly before execution.
 */

import { getDb, inMemoryStore, recordFirestoreError } from './base.repository.ts';
import { AdminUserDocument } from '../../types/firestore.ts';
import { AdminRole } from '../../types/enums.ts';
import { adminUserDocumentSchema } from '../../lib/validation/firestore.ts';
import { logger } from '../../lib/logger/logger.ts';

const COLLECTION_NAME = 'adminUsers';

export async function getAdminUserById(userId: string): Promise<AdminUserDocument | null> {
  const db = getDb();
  if (!db) {
    return inMemoryStore.getDoc(COLLECTION_NAME, userId);
  }

  try {
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return inMemoryStore.getDoc(COLLECTION_NAME, userId);
    }
    const data = snapshot.data();
    return { ...data, id: snapshot.id } as AdminUserDocument;
  } catch (err: any) {
    recordFirestoreError(err);
    logger.info(`[AdminUsersRepository] In-memory read for ${userId}`);
    return inMemoryStore.getDoc(COLLECTION_NAME, userId);
  }
}

export async function createAdminUser(admin: AdminUserDocument): Promise<AdminUserDocument> {
  adminUserDocumentSchema.parse(admin);
  
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(admin.id).set(admin);
    } catch (err: any) {
      recordFirestoreError(err);
      logger.warn(`[AdminUsersRepository] Firestore create failed for ${admin.id}: ${err.message}`);
    }
  }

  inMemoryStore.setDoc(COLLECTION_NAME, admin.id, admin);
  return admin;
}

export async function listAdminUsers(): Promise<AdminUserDocument[]> {
  const db = getDb();
  if (db) {
    try {
      const snapshot = await db.collection(COLLECTION_NAME).get();
      if (!snapshot.empty) {
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as AdminUserDocument));
      }
    } catch (err: any) {
      recordFirestoreError(err);
    }
  }

  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  return Array.from(col.values());
}

export async function verifyIsActiveAdmin(userId: string, requiredRole?: AdminRole): Promise<boolean> {
  const admin = await getAdminUserById(userId);
  if (!admin || !admin.is_active) {
    return false;
  }
  if (requiredRole && admin.role !== requiredRole && admin.role !== AdminRole.SUPER_ADMIN) {
    return false;
  }
  return true;
}
