/**
 * Alexvya Platform — Wallet Ledger Repository (Server-Only Foundation)
 * Stage 2.5.2 Immutable Wallet Ledger
 * 
 * Terminology: "Immutable Single-Account Wallet Balance Journal with Running Balance Snapshots"
 * Target Subcollection: wallets/{userId}/ledger/{ledgerId}
 * 
 * STRICT INVARIANTS:
 * 1. Subcollection path: wallets/{userId}/ledger/{ledgerId}.
 * 2. Ledger entries are STRICTLY IMMUTABLE and APPEND-ONLY.
 * 3. Mutation, deletion, or overwriting of historical ledger records is forbidden.
 * 4. Every ledger entry records the financial event and the resulting running balance snapshot (balance_after_kobo).
 * 5. Arithmetic invariants:
 *    - CREDIT (INFLOW): balance_after_kobo === balance_before_kobo + amount_kobo
 *    - DEBIT (OUTFLOW): balance_after_kobo === balance_before_kobo - amount_kobo (balance_before_kobo >= amount_kobo)
 * 6. All monetary amounts are positive integer kobo.
 * 7. Server-only financial authority: browser/client cannot create or mutate ledger entries.
 */

import { getDb, inMemoryStore, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { LedgerDocument } from '../../types/firestore.ts';
import { LedgerEntryType, LedgerDirection } from '../../types/enums.ts';
import { ledgerDocumentSchema } from '../../lib/validation/firestore.ts';
import { MONEY_CONSTANTS, isSafeKobo } from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

const SUBCOLLECTION_PREFIX = 'wallets_ledger_';

export interface LedgerQueryOptions extends PaginationOptions {
  entry_type?: LedgerEntryType;
}

/**
 * Validates internal ledger entry invariants, monetary boundaries, and arithmetic snapshots.
 * Throws deterministic AlexvyaApiError on any schema or financial invariant violation.
 */
export function validateLedgerEntry(
  entry: unknown,
  correlationId?: string
): asserts entry is LedgerDocument {
  if (!entry || typeof entry !== 'object') {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_LEDGER_ENTRY,
      'Ledger entry is missing or invalid.',
      400,
      { correlation_id: correlationId }
    );
  }

  // 1. Safe Kobo bounds verification for amount_kobo
  const rawAmount = (entry as any).amount_kobo;
  if (rawAmount === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED,
      'Ledger entry amount cannot be zero.',
      400,
      { amount_kobo: rawAmount, correlation_id: correlationId }
    );
  }
  if (rawAmount !== undefined && (!isSafeKobo(rawAmount) || rawAmount <= 0)) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_AMOUNT,
      `Ledger amount_kobo (${rawAmount}) must be a safe positive integer in kobo.`,
      400,
      { amount_kobo: rawAmount, correlation_id: correlationId }
    );
  }

  // 2. Zod structural schema verification
  const parseResult = ledgerDocumentSchema.safeParse(entry);
  if (!parseResult.success) {
    logger.error(
      `[LedgerRepository] Schema validation failed for ledger entry: ${JSON.stringify(parseResult.error.flatten())}`,
      undefined,
      correlationId
    );
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_LEDGER_ENTRY,
      'Ledger entry data integrity schema violation.',
      400,
      { validation_errors: parseResult.error.flatten(), correlation_id: correlationId }
    );
  }

  const e = entry as LedgerDocument;

  // 2. Safe Kobo bounds verification
  if (e.amount_kobo === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED,
      'Ledger amount_kobo cannot be zero.',
      400,
      { amount_kobo: e.amount_kobo, correlation_id: correlationId }
    );
  }

  if (!isSafeKobo(e.amount_kobo) || e.amount_kobo <= 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_AMOUNT,
      `Ledger amount_kobo (${e.amount_kobo}) must be a safe positive integer in kobo.`,
      400,
      { amount_kobo: e.amount_kobo, correlation_id: correlationId }
    );
  }

  if (!isSafeKobo(e.balance_before_kobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.BALANCE_INVARIANT_VIOLATION,
      `Ledger balance_before_kobo (${e.balance_before_kobo}) must be a safe non-negative integer.`,
      400,
      { balance_before_kobo: e.balance_before_kobo, correlation_id: correlationId }
    );
  }

  if (!isSafeKobo(e.balance_after_kobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.BALANCE_INVARIANT_VIOLATION,
      `Ledger balance_after_kobo (${e.balance_after_kobo}) must be a safe non-negative integer.`,
      400,
      { balance_after_kobo: e.balance_after_kobo, correlation_id: correlationId }
    );
  }

  // 3. Balance cap invariant
  if (e.balance_after_kobo > MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO) {
    throw new AlexvyaApiError(
      ErrorCodes.MAX_BALANCE_EXCEEDED,
      `Ledger balance_after_kobo exceeds maximum account balance cap (${MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO} kobo).`,
      400,
      { balance_after_kobo: e.balance_after_kobo, correlation_id: correlationId }
    );
  }

  // 4. Arithmetic running balance snapshot invariant
  if (e.entry_type === LedgerEntryType.CREDIT) {
    if (e.direction !== LedgerDirection.INFLOW) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_LEDGER_DIRECTION,
        `Credit ledger entry must have direction INFLOW, got ${e.direction}`,
        400,
        { entry_type: e.entry_type, direction: e.direction, correlation_id: correlationId }
      );
    }
    const expectedAfter = e.balance_before_kobo + e.amount_kobo;
    if (e.balance_after_kobo !== expectedAfter) {
      throw new AlexvyaApiError(
        ErrorCodes.BALANCE_INVARIANT_VIOLATION,
        `Credit running balance arithmetic mismatch: expected ${expectedAfter} (${e.balance_before_kobo} + ${e.amount_kobo}), received ${e.balance_after_kobo}`,
        400,
        {
          balance_before_kobo: e.balance_before_kobo,
          amount_kobo: e.amount_kobo,
          balance_after_kobo: e.balance_after_kobo,
          correlation_id: correlationId,
        }
      );
    }
  } else if (e.entry_type === LedgerEntryType.DEBIT) {
    if (e.direction !== LedgerDirection.OUTFLOW) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_LEDGER_DIRECTION,
        `Debit ledger entry must have direction OUTFLOW, got ${e.direction}`,
        400,
        { entry_type: e.entry_type, direction: e.direction, correlation_id: correlationId }
      );
    }
    if (e.balance_before_kobo < e.amount_kobo) {
      throw new AlexvyaApiError(
        ErrorCodes.INSUFFICIENT_BALANCE,
        `Debit amount (${e.amount_kobo}) exceeds balance before transaction (${e.balance_before_kobo})`,
        400,
        {
          balance_before_kobo: e.balance_before_kobo,
          amount_kobo: e.amount_kobo,
          correlation_id: correlationId,
        }
      );
    }
    const expectedAfter = e.balance_before_kobo - e.amount_kobo;
    if (e.balance_after_kobo !== expectedAfter) {
      throw new AlexvyaApiError(
        ErrorCodes.BALANCE_INVARIANT_VIOLATION,
        `Debit running balance arithmetic mismatch: expected ${expectedAfter} (${e.balance_before_kobo} - ${e.amount_kobo}), received ${e.balance_after_kobo}`,
        400,
        {
          balance_before_kobo: e.balance_before_kobo,
          amount_kobo: e.amount_kobo,
          balance_after_kobo: e.balance_after_kobo,
          correlation_id: correlationId,
        }
      );
    }
  } else {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_LEDGER_ENTRY,
      `Unsupported ledger entry_type: ${e.entry_type}`,
      400,
      { entry_type: e.entry_type, correlation_id: correlationId }
    );
  }
}

/**
 * Creates an immutable ledger entry under wallets/{userId}/ledger/{ledgerId}.
 * Enforces create-only semantics (cannot overwrite an existing entry).
 */
export async function createLedgerEntry(
  userId: string,
  entry: LedgerDocument,
  correlationId?: string
): Promise<LedgerDocument> {
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Valid user ID is required to create a ledger entry.',
      400,
      { correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();

  // Validate user/wallet association
  if (entry.user_id !== cleanUserId || entry.wallet_id !== cleanUserId) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_LEDGER_ENTRY,
      `Ledger entry user_id (${entry.user_id}) and wallet_id (${entry.wallet_id}) must match target wallet (${cleanUserId}).`,
      400,
      { user_id: entry.user_id, wallet_id: entry.wallet_id, targetUserId: cleanUserId, correlation_id: correlationId }
    );
  }

  // Validate entry schema and running balance arithmetic
  validateLedgerEntry(entry, correlationId);

  const collectionKey = `${SUBCOLLECTION_PREFIX}${cleanUserId}`;
  const db = getDb();

  if (!db) {
    // Check create-only semantics in memory store
    const existing = inMemoryStore.getDoc(collectionKey, entry.id);
    if (existing) {
      throw new AlexvyaApiError(
        ErrorCodes.LEDGER_ENTRY_EXISTS,
        `Ledger entry ${entry.id} already exists. Ledger entries are strictly immutable.`,
        409,
        { ledger_id: entry.id, correlation_id: correlationId }
      );
    }
    inMemoryStore.setDoc(collectionKey, entry.id, entry);
    logger.info(`[LedgerRepository] Appended in-memory ledger entry ${entry.id} for ${cleanUserId}`, undefined, correlationId);
    return entry;
  }

  try {
    const docRef = db
      .collection('wallets')
      .doc(cleanUserId)
      .collection('ledger')
      .doc(entry.id);

    // Using create() ensures failure if doc already exists
    await docRef.create(entry);
    inMemoryStore.setDoc(collectionKey, entry.id, entry);
    logger.info(`[LedgerRepository] Created Firestore ledger entry ${entry.id} for ${cleanUserId}`, undefined, correlationId);
    return entry;
  } catch (err: any) {
    if (err.code === 6 || err.message?.includes('ALREADY_EXISTS') || err.message?.includes('already exists')) {
      throw new AlexvyaApiError(
        ErrorCodes.LEDGER_ENTRY_EXISTS,
        `Ledger entry ${entry.id} already exists. Ledger entries are strictly immutable.`,
        409,
        { ledger_id: entry.id, correlation_id: correlationId }
      );
    }
    if (err instanceof AlexvyaApiError) {
      throw err;
    }

    logger.warn(`[LedgerRepository] Firestore create fallback for ${entry.id}: ${err.message}`, undefined, correlationId);
    
    // Check in-memory store before setting fallback
    const existing = inMemoryStore.getDoc(collectionKey, entry.id);
    if (existing) {
      throw new AlexvyaApiError(
        ErrorCodes.LEDGER_ENTRY_EXISTS,
        `Ledger entry ${entry.id} already exists. Ledger entries are strictly immutable.`,
        409,
        { ledger_id: entry.id, correlation_id: correlationId }
      );
    }
    inMemoryStore.setDoc(collectionKey, entry.id, entry);
    return entry;
  }
}

/**
 * Backwards-compatible alias for createLedgerEntry.
 */
export async function appendLedgerEntry(
  userId: string,
  entry: LedgerDocument,
  correlationId?: string
): Promise<LedgerDocument> {
  return createLedgerEntry(userId, entry, correlationId);
}

/**
 * Retrieves a single immutable ledger entry by ID.
 */
export async function getLedgerEntry(
  userId: string,
  ledgerId: string,
  correlationId?: string
): Promise<LedgerDocument | null> {
  if (!userId || !ledgerId) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'User ID and Ledger ID are required.',
      400,
      { correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();
  const cleanLedgerId = ledgerId.trim();
  const collectionKey = `${SUBCOLLECTION_PREFIX}${cleanUserId}`;
  const db = getDb();

  if (!db) {
    const memDoc = inMemoryStore.getDoc(collectionKey, cleanLedgerId);
    if (memDoc) {
      validateLedgerEntry(memDoc, correlationId);
      return memDoc as LedgerDocument;
    }
    return null;
  }

  try {
    const docRef = db
      .collection('wallets')
      .doc(cleanUserId)
      .collection('ledger')
      .doc(cleanLedgerId);

    const snap = await docRef.get();
    if (!snap.exists) {
      const fallbackDoc = inMemoryStore.getDoc(collectionKey, cleanLedgerId);
      if (fallbackDoc) {
        validateLedgerEntry(fallbackDoc, correlationId);
        return fallbackDoc as LedgerDocument;
      }
      return null;
    }

    const data = { ...snap.data(), id: snap.id } as LedgerDocument;
    validateLedgerEntry(data, correlationId);
    return data;
  } catch (err: any) {
    if (err instanceof AlexvyaApiError) {
      throw err;
    }
    logger.warn(`[LedgerRepository] Firestore read fallback for ${cleanLedgerId}: ${err.message}`, undefined, correlationId);
    const fallbackDoc = inMemoryStore.getDoc(collectionKey, cleanLedgerId);
    if (fallbackDoc) {
      validateLedgerEntry(fallbackDoc, correlationId);
      return fallbackDoc as LedgerDocument;
    }
    return null;
  }
}

/**
 * Backwards-compatible alias for getLedgerEntry.
 */
export async function getLedgerEntryById(
  userId: string,
  ledgerId: string,
  correlationId?: string
): Promise<LedgerDocument | null> {
  return getLedgerEntry(userId, ledgerId, correlationId);
}

/**
 * Paginated query for a customer's wallet ledger journal.
 * Conforms to composite index: user_id ASC, created_at DESC (and optional entry_type ASC).
 */
export async function queryLedgerByWalletId(
  userId: string,
  options: LedgerQueryOptions = {},
  correlationId?: string
): Promise<PaginatedResult<LedgerDocument>> {
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Valid user ID is required to query ledger.',
      400,
      { correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();
  const limit = sanitizePageLimit(options.limit);
  const collectionKey = `${SUBCOLLECTION_PREFIX}${cleanUserId}`;
  const db = getDb();

  if (!db) {
    const col = inMemoryStore.getCollection(collectionKey);
    let entries: LedgerDocument[] = Array.from(col.values()) as LedgerDocument[];

    // Filter by entry_type if provided
    if (options.entry_type) {
      entries = entries.filter((e) => e.entry_type === options.entry_type);
    }

    // Sort by created_at DESC
    entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Cursor pagination
    let startIndex = 0;
    if (options.cursor) {
      const cursorIdx = entries.findIndex((e) => e.id === options.cursor);
      if (cursorIdx !== -1) {
        startIndex = cursorIdx + 1;
      }
    }

    const paged = entries.slice(startIndex, startIndex + limit);
    const nextCursor = paged.length === limit && startIndex + limit < entries.length
      ? paged[paged.length - 1].id
      : null;

    return {
      items: paged,
      nextCursor,
      hasMore: nextCursor !== null,
      total: entries.length,
    };
  }

  try {
    let query: FirebaseFirestore.Query = db
      .collection('wallets')
      .doc(cleanUserId)
      .collection('ledger');

    if (options.entry_type) {
      query = query.where('entry_type', '==', options.entry_type);
    }

    query = query.orderBy('created_at', 'desc');

    if (options.cursor) {
      const cursorDoc = await db
        .collection('wallets')
        .doc(cleanUserId)
        .collection('ledger')
        .doc(options.cursor)
        .get();

      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    query = query.limit(limit + 1);

    const snapshot = await query.get();
    const docs = snapshot.docs;
    const hasMore = docs.length > limit;
    const items = (hasMore ? docs.slice(0, limit) : docs).map(
      (doc) => ({ ...doc.data(), id: doc.id } as LedgerDocument)
    );

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

    return {
      items,
      nextCursor,
      hasMore,
    };
  } catch (err: any) {
    if (err instanceof AlexvyaApiError) {
      throw err;
    }
    logger.warn(`[LedgerRepository] Firestore query fallback for ${cleanUserId}: ${err.message}`, undefined, correlationId);
    
    // In-memory fallback
    const col = inMemoryStore.getCollection(collectionKey);
    let entries: LedgerDocument[] = Array.from(col.values()) as LedgerDocument[];

    if (options.entry_type) {
      entries = entries.filter((e) => e.entry_type === options.entry_type);
    }

    entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    let startIndex = 0;
    if (options.cursor) {
      const cursorIdx = entries.findIndex((e) => e.id === options.cursor);
      if (cursorIdx !== -1) {
        startIndex = cursorIdx + 1;
      }
    }

    const paged = entries.slice(startIndex, startIndex + limit);
    const nextCursor = paged.length === limit && startIndex + limit < entries.length
      ? paged[paged.length - 1].id
      : null;

    return {
      items: paged,
      nextCursor,
      hasMore: nextCursor !== null,
      total: entries.length,
    };
  }
}
