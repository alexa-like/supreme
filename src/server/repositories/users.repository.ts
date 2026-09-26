/**
 * Alexvya Platform — Users Repository (Server-Only)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: users/{userId}
 */

import { getDb, inMemoryStore, recordFirestoreError, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { UserDocument, UpdateProfileInput } from '../../types/user.ts';
import { UserRole, AccountStatus, KycTier } from '../../types/enums.ts';
import { userDocumentSchema } from '../../lib/validation/firestore.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

const COLLECTION_NAME = 'users';

export async function getUserById(userId: string): Promise<UserDocument | null> {
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
    return { ...data, id: snapshot.id, uid: snapshot.id } as UserDocument;
  } catch (err: any) {
    recordFirestoreError(err);
    logger.info(`[UsersRepository] In-memory read for ${userId}`);
    return inMemoryStore.getDoc(COLLECTION_NAME, userId);
  }
}

export async function userExists(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  return user !== null;
}

export async function createUser(user: UserDocument): Promise<UserDocument> {
  const userId = user.uid || user.id || '';
  if (!userId) {
    throw new Error('User ID is required to create a user profile');
  }
  const normalizedDoc: UserDocument = {
    ...user,
    id: userId,
    uid: userId,
    role: user.role || UserRole.CUSTOMER,
    account_status: user.account_status || AccountStatus.ACTIVE,
    tier: user.tier || KycTier.TIER_1,
    kyc_tier: user.kyc_tier ?? 1,
    daily_funding_limit_kobo: user.daily_funding_limit_kobo ?? 5000000,
    notification_preferences: user.notification_preferences || {
      email_on_wallet_credit: true,
      email_on_purchase: true,
    },
    email_verified: user.email_verified ?? false,
    phone_verified: user.phone_verified ?? false,
    two_factor_enabled: user.two_factor_enabled ?? false,
    created_at: user.created_at || new Date().toISOString(),
    updated_at: user.updated_at || new Date().toISOString(),
    last_login_at: user.last_login_at || new Date().toISOString(),
  };

  // Validate document against schema
  userDocumentSchema.parse(normalizedDoc);

  const db = getDb();
  if (!db) {
    inMemoryStore.setDoc(COLLECTION_NAME, userId, normalizedDoc);
    return normalizedDoc;
  }

  try {
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    await docRef.set(normalizedDoc);
    inMemoryStore.setDoc(COLLECTION_NAME, userId, normalizedDoc);
    return normalizedDoc;
  } catch (err: any) {
    recordFirestoreError(err);
    logger.info(`[UsersRepository] In-memory create for ${userId}`);
    inMemoryStore.setDoc(COLLECTION_NAME, userId, normalizedDoc);
    return normalizedDoc;
  }
}

/**
 * Updates allowed personal profile fields.
 * Explicitly rejects modifications to protected fields (role, status, tier, balance).
 */
export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput,
  correlationId?: string
): Promise<UserDocument> {
  const existing = await getUserById(userId);
  if (!existing) {
    throw new AlexvyaApiError(
      ErrorCodes.USER_NOT_FOUND,
      `User with ID ${userId} does not exist`,
      404,
      { correlation_id: correlationId }
    );
  }

  const updates: Partial<UserDocument> = {
    first_name: input.first_name !== undefined ? input.first_name : existing.first_name,
    last_name: input.last_name !== undefined ? input.last_name : existing.last_name,
    display_name: input.display_name !== undefined ? input.display_name : existing.display_name,
    phone_number: input.phone_number !== undefined ? input.phone_number : existing.phone_number,
    updated_at: new Date().toISOString(),
  };

  const db = getDb();
  if (!db) {
    return inMemoryStore.updateDoc(COLLECTION_NAME, userId, updates);
  }

  try {
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    await docRef.update(updates);
    const updated = { ...existing, ...updates };
    inMemoryStore.setDoc(COLLECTION_NAME, userId, updated);
    return updated;
  } catch (err: any) {
    recordFirestoreError(err);
    logger.info(`[UsersRepository] In-memory update for ${userId}`);
    return inMemoryStore.updateDoc(COLLECTION_NAME, userId, updates);
  }
}

/**
 * Administrative update of account status (ACTIVE, SUSPENDED, FROZEN, CLOSED)
 */
export async function updateUserStatus(
  userId: string,
  status: AccountStatus,
  correlationId?: string
): Promise<UserDocument> {
  const existing = await getUserById(userId);
  if (!existing) {
    throw new AlexvyaApiError(
      ErrorCodes.USER_NOT_FOUND,
      `User with ID ${userId} does not exist`,
      404,
      { correlation_id: correlationId }
    );
  }

  const updates = {
    account_status: status,
    updated_at: new Date().toISOString(),
  };

  const db = getDb();
  if (!db) {
    return inMemoryStore.updateDoc(COLLECTION_NAME, userId, updates);
  }

  try {
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    await docRef.update(updates);
    const updated = { ...existing, ...updates };
    inMemoryStore.setDoc(COLLECTION_NAME, userId, updated);
    return updated;
  } catch (err: any) {
    recordFirestoreError(err);
    logger.info(`[UsersRepository] In-memory update status for ${userId}`);
    return inMemoryStore.updateDoc(COLLECTION_NAME, userId, updates);
  }
}

/**
 * Paginated query for users (admin only)
 */
export async function queryUsers(options: PaginationOptions = {}): Promise<PaginatedResult<UserDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  const allUsers: UserDocument[] = Array.from(col.values());

  // In-memory pagination
  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = allUsers.findIndex((u) => u.id === options.cursor || u.uid === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = allUsers.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < allUsers.length
    ? (paged[paged.length - 1].id || paged[paged.length - 1].uid)
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: allUsers.length,
  };
}
