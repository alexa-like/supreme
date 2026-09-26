/**
 * Alexvya Platform — Wallets Repository (Server-Authoritative Foundation)
 * Stage 2.5.1 Wallet Foundation
 * 
 * Terminology: "Immutable Single-Account Wallet Balance Journal with Running Balance Snapshots"
 * Target Canonical Collection: wallets/{userId}
 * 
 * Invariants:
 * 1. Document ID is ALWAYS the authenticated Firebase UID: wallets/{userId}.
 * 2. Client CANNOT mutate or create wallet documents directly.
 * 3. All monetary values are strictly non-negative integer kobo within safe integer limits.
 * 4. Invariant relation: ledger_balance_kobo === available_balance_kobo + locked_balance_kobo.
 * 5. Version counter initialized to 1 and strictly monotonic for future atomic updates.
 * 6. Balance capped at MAX_ACCOUNT_BALANCE_KOBO (₦10,000,000.00 / 1,000,000,000 kobo).
 */

import { getDb, inMemoryStore, recordFirestoreError } from './base.repository.ts';
import { WalletDocument } from '../../types/firestore.ts';
import { WalletStatus } from '../../types/enums.ts';
import { walletDocumentSchema } from '../../lib/validation/firestore.ts';
import { MONEY_CONSTANTS, isSafeKobo } from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

const COLLECTION_NAME = 'wallets';

/**
 * Validates internal wallet invariants and safe integer bounds.
 * Throws deterministic AlexvyaApiError if corrupted or invariant is violated.
 */
export function validateWalletState(
  wallet: unknown,
  correlationId?: string
): asserts wallet is WalletDocument {
  if (!wallet || typeof wallet !== 'object') {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_WALLET_STATE,
      'Wallet document is missing or invalid.',
      500,
      { correlation_id: correlationId }
    );
  }

  const raw = wallet as Record<string, any>;

  // 1. Negative balance forbidden pre-check
  if (typeof raw.available_balance_kobo === 'number' && raw.available_balance_kobo < 0) {
    throw new AlexvyaApiError(
      ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN,
      `Negative available balance is forbidden: ${raw.available_balance_kobo} kobo.`,
      500,
      { available_balance_kobo: raw.available_balance_kobo, correlation_id: correlationId }
    );
  }

  if (typeof raw.ledger_balance_kobo === 'number' && raw.ledger_balance_kobo < 0) {
    throw new AlexvyaApiError(
      ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN,
      `Negative ledger balance is forbidden: ${raw.ledger_balance_kobo} kobo.`,
      500,
      { ledger_balance_kobo: raw.ledger_balance_kobo, correlation_id: correlationId }
    );
  }

  if (typeof raw.locked_balance_kobo === 'number' && raw.locked_balance_kobo < 0) {
    throw new AlexvyaApiError(
      ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN,
      `Negative locked balance is forbidden: ${raw.locked_balance_kobo} kobo.`,
      500,
      { locked_balance_kobo: raw.locked_balance_kobo, correlation_id: correlationId }
    );
  }

  // 2. Version counter invariant pre-check
  if (raw.version !== undefined && (!Number.isSafeInteger(raw.version) || raw.version < 1)) {
    throw new AlexvyaApiError(
      ErrorCodes.WALLET_VERSION_INVALID,
      `Invalid wallet version counter: ${raw.version}. Version must be a positive integer >= 1.`,
      500,
      { version: raw.version, correlation_id: correlationId }
    );
  }

  // 3. Zod schema structural and enum verification
  const parseResult = walletDocumentSchema.safeParse(wallet);
  if (!parseResult.success) {
    logger.error(
      `[WalletsRepository] Schema validation failed for wallet: ${JSON.stringify(parseResult.error.flatten())}`,
      undefined,
      correlationId
    );
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_WALLET_STATE,
      'Wallet data integrity schema violation.',
      500,
      { validation_errors: parseResult.error.flatten(), correlation_id: correlationId }
    );
  }

  const w = wallet as WalletDocument;

  // 2. Safe Kobo bounds verification
  if (
    typeof w.available_balance_kobo === 'number' &&
    w.available_balance_kobo < 0
  ) {
    throw new AlexvyaApiError(
      ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN,
      `Negative available balance is forbidden: ${w.available_balance_kobo} kobo.`,
      500,
      { available_balance_kobo: w.available_balance_kobo, correlation_id: correlationId }
    );
  }

  if (
    typeof w.ledger_balance_kobo === 'number' &&
    w.ledger_balance_kobo < 0
  ) {
    throw new AlexvyaApiError(
      ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN,
      `Negative ledger balance is forbidden: ${w.ledger_balance_kobo} kobo.`,
      500,
      { ledger_balance_kobo: w.ledger_balance_kobo, correlation_id: correlationId }
    );
  }

  if (
    typeof w.locked_balance_kobo === 'number' &&
    w.locked_balance_kobo < 0
  ) {
    throw new AlexvyaApiError(
      ErrorCodes.NEGATIVE_BALANCE_FORBIDDEN,
      `Negative locked balance is forbidden: ${w.locked_balance_kobo} kobo.`,
      500,
      { locked_balance_kobo: w.locked_balance_kobo, correlation_id: correlationId }
    );
  }

  if (!isSafeKobo(w.available_balance_kobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.BALANCE_INVARIANT_VIOLATION,
      'Available balance is not a safe non-negative integer kobo.',
      500,
      { available_balance_kobo: w.available_balance_kobo, correlation_id: correlationId }
    );
  }

  if (!isSafeKobo(w.ledger_balance_kobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.BALANCE_INVARIANT_VIOLATION,
      'Ledger balance is not a safe non-negative integer kobo.',
      500,
      { ledger_balance_kobo: w.ledger_balance_kobo, correlation_id: correlationId }
    );
  }

  if (!isSafeKobo(w.locked_balance_kobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.BALANCE_INVARIANT_VIOLATION,
      'Locked balance is not a safe non-negative integer kobo.',
      500,
      { locked_balance_kobo: w.locked_balance_kobo, correlation_id: correlationId }
    );
  }

  if (!isSafeKobo(w.daily_spent_kobo)) {
    throw new AlexvyaApiError(
      ErrorCodes.BALANCE_INVARIANT_VIOLATION,
      'Daily spent is not a safe non-negative integer kobo.',
      500,
      { daily_spent_kobo: w.daily_spent_kobo, correlation_id: correlationId }
    );
  }

  // 3. Maximum account balance cap (₦10,000,000.00 / 1,000,000,000 kobo)
  if (w.ledger_balance_kobo > MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO) {
    throw new AlexvyaApiError(
      ErrorCodes.MAX_BALANCE_EXCEEDED,
      `Ledger balance exceeds maximum account balance limit (${MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO} kobo).`,
      500,
      { ledger_balance_kobo: w.ledger_balance_kobo, correlation_id: correlationId }
    );
  }

  // 4. Mathematical balance relationship invariant: ledger === available + locked
  const expectedLedger = w.available_balance_kobo + w.locked_balance_kobo;
  if (w.ledger_balance_kobo !== expectedLedger) {
    throw new AlexvyaApiError(
      ErrorCodes.BALANCE_INVARIANT_VIOLATION,
      `Balance invariant violation: ledger_balance (${w.ledger_balance_kobo}) must equal available (${w.available_balance_kobo}) + locked (${w.locked_balance_kobo}).`,
      500,
      {
        ledger_balance_kobo: w.ledger_balance_kobo,
        available_balance_kobo: w.available_balance_kobo,
        locked_balance_kobo: w.locked_balance_kobo,
        correlation_id: correlationId,
      }
    );
  }

  // 5. Version counter invariant
  if (!Number.isSafeInteger(w.version) || w.version < 1) {
    throw new AlexvyaApiError(
      ErrorCodes.WALLET_VERSION_INVALID,
      `Invalid wallet version counter: ${w.version}. Version must be a positive integer >= 1.`,
      500,
      { version: w.version, correlation_id: correlationId }
    );
  }
}

/**
 * Validates that wallet status is ACTIVE for transactional operations.
 */
export function enforceWalletStatus(wallet: WalletDocument, correlationId?: string): void {
  if (wallet.status === WalletStatus.LOCKED) {
    throw new AlexvyaApiError(
      ErrorCodes.WALLET_LOCKED,
      'Your wallet is temporarily locked. Please contact customer support.',
      403,
      { status: wallet.status, correlation_id: correlationId }
    );
  }

  if (wallet.status === WalletStatus.FROZEN) {
    throw new AlexvyaApiError(
      ErrorCodes.WALLET_FROZEN,
      'Your wallet is frozen due to security review. Contact support.',
      403,
      { status: wallet.status, correlation_id: correlationId }
    );
  }
}

/**
 * Retrieves the authoritative wallet document for a user.
 */
export async function getWallet(userId: string, correlationId?: string): Promise<WalletDocument | null> {
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'User ID is required to retrieve wallet.',
      400,
      { correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();
  const db = getDb();

  if (!db) {
    const memDoc = inMemoryStore.getDoc(COLLECTION_NAME, cleanUserId);
    if (memDoc) {
      validateWalletState(memDoc, correlationId);
      return memDoc as WalletDocument;
    }
    return null;
  }

  try {
    const docRef = db.collection(COLLECTION_NAME).doc(cleanUserId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      const fallbackDoc = inMemoryStore.getDoc(COLLECTION_NAME, cleanUserId);
      if (fallbackDoc) {
        validateWalletState(fallbackDoc, correlationId);
        return fallbackDoc as WalletDocument;
      }
      return null;
    }

    const data = { ...snapshot.data(), id: snapshot.id } as WalletDocument;
    validateWalletState(data, correlationId);
    return data;
  } catch (err: any) {
    if (err instanceof AlexvyaApiError) {
      throw err;
    }
    recordFirestoreError(err);
    logger.info(`[WalletsRepository] In-memory read for ${cleanUserId}`, undefined, correlationId);
    const fallbackDoc = inMemoryStore.getDoc(COLLECTION_NAME, cleanUserId);
    if (fallbackDoc) {
      validateWalletState(fallbackDoc, correlationId);
      return fallbackDoc as WalletDocument;
    }
    return null;
  }
}

/**
 * Backwards-compatible alias for getWallet.
 */
export async function getWalletByUserId(userId: string, correlationId?: string): Promise<WalletDocument | null> {
  return getWallet(userId, correlationId);
}

/**
 * Authoritative, idempotent wallet initialization.
 * If wallet exists, returns existing wallet unchanged (zero balance reset risk).
 * If wallet does not exist, provisions initial wallet with zero balances and version = 1.
 */
export async function ensureWallet(userId: string, correlationId?: string): Promise<WalletDocument> {
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Valid user ID is required to initialize wallet.',
      400,
      { correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();

  // 1. Check for existing wallet
  const existing = await getWallet(cleanUserId, correlationId);
  if (existing) {
    return existing;
  }

  // 2. Initialize new canonical wallet document
  const now = new Date().toISOString();
  const newWallet: WalletDocument = {
    id: cleanUserId,
    user_id: cleanUserId,
    currency: 'NGN',
    available_balance_kobo: 0,
    ledger_balance_kobo: 0,
    locked_balance_kobo: 0,
    status: WalletStatus.ACTIVE,
    daily_spent_kobo: 0,
    last_ledger_entry_id: null,
    version: 1,
    created_at: now,
    updated_at: now,
  };

  validateWalletState(newWallet, correlationId);

  const db = getDb();
  if (!db) {
    inMemoryStore.setDoc(COLLECTION_NAME, cleanUserId, newWallet);
    logger.info(`[WalletsRepository] Initialized in-memory wallet for ${cleanUserId}`, undefined, correlationId);
    return newWallet;
  }

  try {
    const docRef = db.collection(COLLECTION_NAME).doc(cleanUserId);
    await docRef.set(newWallet);
    inMemoryStore.setDoc(COLLECTION_NAME, cleanUserId, newWallet);
    logger.info(`[WalletsRepository] Initialized Firestore wallet for ${cleanUserId}`, undefined, correlationId);
    return newWallet;
  } catch (err: any) {
    recordFirestoreError(err);
    logger.info(`[WalletsRepository] Initialized in-memory wallet for ${cleanUserId}`, undefined, correlationId);
    inMemoryStore.setDoc(COLLECTION_NAME, cleanUserId, newWallet);
    return newWallet;
  }
}

/**
 * Backwards-compatible alias for ensureWallet.
 */
export async function createWalletIfMissing(userId: string, correlationId?: string): Promise<WalletDocument> {
  return ensureWallet(userId, correlationId);
}

/**
 * Retrieves only the current version counter of a wallet.
 */
export async function getWalletVersion(userId: string, correlationId?: string): Promise<number | null> {
  const wallet = await getWallet(userId, correlationId);
  return wallet ? wallet.version : null;
}

/**
 * Reads sanitized authoritative wallet balance snapshot.
 */
export async function readWalletState(userId: string, correlationId?: string): Promise<{
  exists: boolean;
  status: WalletStatus | null;
  available_balance_kobo: number;
  ledger_balance_kobo: number;
  locked_balance_kobo: number;
  version: number;
} | null> {
  const wallet = await getWallet(userId, correlationId);
  if (!wallet) {
    return null;
  }
  return {
    exists: true,
    status: wallet.status,
    available_balance_kobo: wallet.available_balance_kobo,
    ledger_balance_kobo: wallet.ledger_balance_kobo,
    locked_balance_kobo: wallet.locked_balance_kobo,
    version: wallet.version,
  };
}

/**
 * Test helper to update wallet document directly in both Firestore and in-memory cache.
 */
export async function __testUpdateWallet(userId: string, updates: Partial<WalletDocument>): Promise<void> {
  const cleanUserId = userId.trim();
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(cleanUserId).set(updates, { merge: true });
    } catch {
      // In-memory fallback updated below
    }
  }
  try {
    inMemoryStore.updateDoc(COLLECTION_NAME, cleanUserId, updates);
  } catch {
    // ignore
  }
}
