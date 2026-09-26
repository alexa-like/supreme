/**
 * Alexvya Platform — Atomic Wallet Mutation Engine with Idempotency & Concurrency Protection
 * Stage 2.5.3 + Stage 2.5.4 Hardened Financial Engine
 * 
 * CORE INVARIANT:
 * WALLET STATE CHANGE + LEDGER ENTRY + IDEMPOTENCY RECORD = ONE ATOMIC OPERATION
 * 
 * Primitives:
 * 1. creditWallet(...) — Atomic balance increase + immutable CREDIT ledger entry + Idempotency Protection
 * 2. debitWallet(...) — Atomic balance decrease + immutable DEBIT ledger entry + Idempotency Protection
 * 3. refundWallet(...) — Atomic compensating balance increase + immutable REFUND ledger entry + Permanent Dedup
 * 
 * Strict Guarantees:
 * - Atomic execution via Firestore runTransaction() / transactional serialized store.
 * - Idempotency key validation, canonical request fingerprinting (SHA-256).
 * - Exact idempotency replay with isIdempotentReplay: true.
 * - Same key with conflicting payload rejected (IDEMPOTENCY_CONFLICT).
 * - User isolation: Idempotency keys cannot be shared or replayed across different users.
 * - Insufficient balance protection under extreme concurrency.
 * - Duplicate refund prevention (permanent deduplication tied to parent transaction).
 * - Monotonic wallet version increment (version = version + 1).
 * - Zero external side-effects inside transaction boundary.
 */

import { randomUUID } from 'crypto';
import { getDb, inMemoryStore } from '../repositories/base.repository.ts';
import { validateWalletState, enforceWalletStatus } from '../repositories/wallets.repository.ts';
import { validateLedgerEntry } from '../repositories/ledger.repository.ts';
import {
  computeRequestFingerprint,
  validateIdempotencyKeyFormat,
  calculateIdempotencyExpiresAt,
  IDEMPOTENCY_RETENTION_MS,
} from '../repositories/idempotencyKeys.repository.ts';
import { WalletDocument, LedgerDocument, IdempotencyKeyDocument } from '../../types/firestore.ts';
import {
  LedgerEntryType,
  LedgerDirection,
  LedgerCategory,
  IdempotencyStatus,
} from '../../types/enums.ts';
import { MONEY_CONSTANTS, isSafeKobo, IntegerKobo } from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

const WALLETS_COLLECTION = 'wallets';
const IDEMPOTENCY_COLLECTION = 'idempotencyKeys';
const SUBCOLLECTION_PREFIX = 'wallets_ledger_';

// In-Memory Async Mutex for local test environments to ensure strict transaction-like concurrency serialization
class AsyncMutex {
  private activeLocks = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const currentPromise = this.activeLocks.get(key) || Promise.resolve();
    let release: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.activeLocks.set(key, nextPromise);

    try {
      await currentPromise;
      return await fn();
    } finally {
      release!();
      if (this.activeLocks.get(key) === nextPromise) {
        this.activeLocks.delete(key);
      }
    }
  }

  clear(): void {
    this.activeLocks.clear();
  }
}

const inMemoryMutex = new AsyncMutex();

export function resetMutationMutexes(): void {
  inMemoryMutex.clear();
}

export interface WalletMutationActor {
  type: 'SYSTEM' | 'ADMIN' | 'SUPER_ADMIN' | 'USER' | 'CUSTOMER' | 'AUDITOR';
  id: string;
}

export interface CreditWalletParams {
  userId: string;
  amountKobo: IntegerKobo;
  category?: LedgerCategory;
  description: string;
  transactionId?: string;
  transactionReference?: string;
  idempotencyKey?: string;
  actor?: WalletMutationActor;
  correlationId?: string;
}

export interface DebitWalletParams {
  userId: string;
  amountKobo: IntegerKobo;
  category?: LedgerCategory;
  description: string;
  transactionId?: string;
  transactionReference?: string;
  idempotencyKey?: string;
  actor?: WalletMutationActor;
  correlationId?: string;
}

export interface RefundWalletParams {
  userId: string;
  amountKobo: IntegerKobo;
  originalTransactionId: string;
  originalTransactionReference: string;
  category?: LedgerCategory;
  description?: string;
  idempotencyKey?: string;
  actor?: WalletMutationActor;
  correlationId?: string;
}

export interface WalletMutationResult {
  wallet: WalletDocument;
  ledgerEntry: LedgerDocument;
  previousVersion: number;
  newVersion: number;
  balanceBeforeKobo: IntegerKobo;
  balanceAfterKobo: IntegerKobo;
  amountKobo: IntegerKobo;
  isIdempotentReplay?: boolean;
}

/**
 * Validates mutation amount is a safe, strictly positive integer in kobo (> 0).
 */
function validateMutationAmount(amountKobo: unknown, correlationId?: string): asserts amountKobo is IntegerKobo {
  if (amountKobo === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.ZERO_AMOUNT_NOT_ALLOWED,
      'Mutation amount cannot be zero (0). Financial operations require a positive non-zero amount.',
      400,
      { amount_kobo: amountKobo, correlation_id: correlationId }
    );
  }

  if (typeof amountKobo === 'number' && amountKobo > Number.MAX_SAFE_INTEGER) {
    throw new AlexvyaApiError(
      ErrorCodes.MONEY_OVERFLOW,
      `Mutation amount (${amountKobo}) exceeds maximum safe integer limit.`,
      400,
      { amount_kobo: amountKobo, correlation_id: correlationId }
    );
  }

  if (!isSafeKobo(amountKobo) || amountKobo <= 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_KOBO_AMOUNT,
      `Mutation amount (${amountKobo}) must be a safe positive non-zero integer in kobo.`,
      400,
      { amount_kobo: amountKobo, correlation_id: correlationId }
    );
  }
}

/**
 * Validates mutation actor privileges (blocks AUDITOR, blocks customer-initiated refunds).
 */
function validateMutationActor(
  actor: WalletMutationActor | undefined,
  operationType: 'CREDIT' | 'DEBIT' | 'REFUND',
  correlationId?: string
): void {
  if (!actor) return;

  if (actor.type === 'AUDITOR') {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      'Auditor accounts have read-only visibility and cannot execute financial mutations.',
      403,
      { actor, operation_type: operationType, correlation_id: correlationId }
    );
  }

  if (operationType === 'REFUND' && (actor.type === 'CUSTOMER' || actor.type === 'USER')) {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      'Customers cannot directly trigger administrative wallet refunds.',
      403,
      { actor, correlation_id: correlationId }
    );
  }
}

/**
 * Generates a standard server-controlled internal mutation reference.
 */
function generateMutationReference(prefix: 'CRD' | 'DBT' | 'REF'): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ALX-${prefix}-${timestamp}-${randomSuffix}`;
}

// ============================================================================
// 1. CREDIT WALLET PRIMITIVE
// ============================================================================

/**
 * Atomically credits a customer wallet, creates an immutable CREDIT ledger entry,
 * and records/replays idempotency keys.
 */
export async function creditWallet(params: CreditWalletParams): Promise<WalletMutationResult> {
  const {
    userId,
    amountKobo,
    category = LedgerCategory.WALLET_FUNDING,
    description,
    transactionId,
    transactionReference,
    idempotencyKey,
    actor = { type: 'SYSTEM', id: 'SYSTEM' },
    correlationId,
  } = params;

  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Valid userId is required to credit wallet.',
      400,
      { correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();
  validateMutationAmount(amountKobo, correlationId);
  validateMutationActor(actor, 'CREDIT', correlationId);

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Description is required for wallet credit audit trail.',
      400,
      { correlation_id: correlationId }
    );
  }

  let cleanIdempotencyKey: string | null = null;
  let requestHash: string | null = null;

  if (idempotencyKey !== undefined) {
    validateIdempotencyKeyFormat(idempotencyKey, correlationId);
    cleanIdempotencyKey = idempotencyKey.trim();
    requestHash = computeRequestFingerprint({
      user_id: cleanUserId,
      operation_type: 'CREDIT',
      amount_kobo: amountKobo,
      category,
      description: description.trim(),
      transaction_id: transactionId || null,
      transaction_reference: transactionReference || null,
    });
  }

  const txId = transactionId || `tx_${randomUUID()}`;
  const txRef = transactionReference || generateMutationReference('CRD');
  const ledgerId = `led_${randomUUID()}`;
  const now = new Date().toISOString();

  const db = getDb();

  // Live Firestore Transaction Path
  if (db) {
    try {
      return await db.runTransaction(async (transaction) => {
        // 1. Check Idempotency Record if key is provided
        if (cleanIdempotencyKey && requestHash) {
          const idempotencyRef = db.collection(IDEMPOTENCY_COLLECTION).doc(cleanIdempotencyKey);
          const idempotencySnap = await transaction.get(idempotencyRef);

          if (idempotencySnap.exists) {
            const existingKeyDoc = idempotencySnap.data() as IdempotencyKeyDocument;

            // Enforce user isolation
            if (existingKeyDoc.user_id !== cleanUserId) {
              throw new AlexvyaApiError(
                ErrorCodes.FORBIDDEN,
                'Idempotency key does not belong to authenticated user.',
                403,
                { correlation_id: correlationId }
              );
            }

            // Enforce request fingerprint equality
            if (existingKeyDoc.request_hash !== requestHash) {
              throw new AlexvyaApiError(
                ErrorCodes.IDEMPOTENCY_CONFLICT,
                'Idempotency key reused with different request parameters.',
                409,
                { correlation_id: correlationId }
              );
            }

            // Replay completed result
            if (existingKeyDoc.status === IdempotencyStatus.COMPLETED && existingKeyDoc.response_body) {
              logger.info(`[WalletMutationEngine] Idempotent replay for credit key ${cleanIdempotencyKey}`, undefined, correlationId);
              return {
                ...(existingKeyDoc.response_body as unknown as WalletMutationResult),
                isIdempotentReplay: true,
              };
            }

            // Reject if still in progress
            if (existingKeyDoc.status === IdempotencyStatus.IN_PROGRESS) {
              throw new AlexvyaApiError(
                ErrorCodes.IDEMPOTENCY_IN_PROGRESS,
                'Operation is currently being processed. Please wait.',
                409,
                { correlation_id: correlationId }
              );
            }
          }
        }

        // 2. Read and Validate Current Wallet State
        const walletRef = db.collection(WALLETS_COLLECTION).doc(cleanUserId);
        const walletSnap = await transaction.get(walletRef);

        if (!walletSnap.exists) {
          throw new AlexvyaApiError(
            ErrorCodes.WALLET_NOT_FOUND,
            `Wallet for user '${cleanUserId}' does not exist.`,
            404,
            { user_id: cleanUserId, correlation_id: correlationId }
          );
        }

        const currentWallet = { ...walletSnap.data(), id: walletSnap.id } as WalletDocument;
        validateWalletState(currentWallet, correlationId);
        enforceWalletStatus(currentWallet, correlationId);

        const balanceBeforeKobo = currentWallet.available_balance_kobo;
        const newAvailableBalance = currentWallet.available_balance_kobo + amountKobo;
        const newLedgerBalance = currentWallet.ledger_balance_kobo + amountKobo;

        if (newLedgerBalance > MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO) {
          throw new AlexvyaApiError(
            ErrorCodes.MAX_BALANCE_EXCEEDED,
            `Credit of ${amountKobo} kobo would exceed maximum account balance cap (${MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO} kobo).`,
            400,
            {
              current_ledger_balance_kobo: currentWallet.ledger_balance_kobo,
              amount_kobo: amountKobo,
              max_balance_kobo: MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO,
              correlation_id: correlationId,
            }
          );
        }

        const previousVersion = currentWallet.version;
        const newVersion = previousVersion + 1;

        const ledgerEntry: LedgerDocument = {
          id: ledgerId,
          wallet_id: cleanUserId,
          user_id: cleanUserId,
          transaction_id: txId,
          transaction_reference: txRef,
          entry_type: LedgerEntryType.CREDIT,
          direction: LedgerDirection.INFLOW,
          amount_kobo: amountKobo,
          balance_before_kobo: balanceBeforeKobo,
          balance_after_kobo: newAvailableBalance,
          category,
          description,
          actor,
          created_at: now,
        };

        validateLedgerEntry(ledgerEntry, correlationId);

        const updatedWallet: WalletDocument = {
          ...currentWallet,
          available_balance_kobo: newAvailableBalance,
          ledger_balance_kobo: newLedgerBalance,
          last_ledger_entry_id: ledgerId,
          version: newVersion,
          updated_at: now,
        };

        validateWalletState(updatedWallet, correlationId);

        const result: WalletMutationResult = {
          wallet: updatedWallet,
          ledgerEntry,
          previousVersion,
          newVersion,
          balanceBeforeKobo,
          balanceAfterKobo: newAvailableBalance,
          amountKobo,
        };

        const ledgerRef = db.collection(WALLETS_COLLECTION).doc(cleanUserId).collection('ledger').doc(ledgerId);

        // Atomic commit inside transaction
        transaction.set(ledgerRef, ledgerEntry);
        transaction.update(walletRef, {
          available_balance_kobo: updatedWallet.available_balance_kobo,
          ledger_balance_kobo: updatedWallet.ledger_balance_kobo,
          last_ledger_entry_id: updatedWallet.last_ledger_entry_id,
          version: updatedWallet.version,
          updated_at: updatedWallet.updated_at,
        });

        // Write Idempotency Record if key was provided
        if (cleanIdempotencyKey && requestHash) {
          const idempotencyRef = db.collection(IDEMPOTENCY_COLLECTION).doc(cleanIdempotencyKey);
          const idempotencyDoc: IdempotencyKeyDocument = {
            id: cleanIdempotencyKey,
            user_id: cleanUserId,
            request_path: '/api/v1/wallet/credit',
            request_hash: requestHash,
            status: IdempotencyStatus.COMPLETED,
            response_code: 200,
            response_body: result as unknown as Record<string, unknown>,
            created_at: now,
            expires_at: calculateIdempotencyExpiresAt(IDEMPOTENCY_RETENTION_MS.PAYSTACK_FUNDING_INIT),
          };
          transaction.set(idempotencyRef, idempotencyDoc);
          inMemoryStore.setDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey, idempotencyDoc);
        }

        // Mirror to in-memory store for cache consistency
        inMemoryStore.setDoc(WALLETS_COLLECTION, cleanUserId, updatedWallet);
        inMemoryStore.setDoc(`${SUBCOLLECTION_PREFIX}${cleanUserId}`, ledgerId, ledgerEntry);

        logger.info(
          `[WalletMutationEngine] Atomically credited ${amountKobo} kobo to wallet ${cleanUserId}. Version: ${previousVersion} -> ${newVersion}`,
          undefined,
          correlationId
        );

        return result;
      });
    } catch (err: any) {
      if (err instanceof AlexvyaApiError) {
        throw err;
      }
      if (process.env.NODE_ENV === 'production') {
        throw new AlexvyaApiError(
          ErrorCodes.SERVICE_UNAVAILABLE,
          'Database error during credit transaction. Transaction aborted.',
          500,
          { correlation_id: correlationId }
        );
      }
      logger.warn(`[WalletMutationEngine] Firestore credit transaction failed, attempting fallback: ${err.message}`, undefined, correlationId);
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new AlexvyaApiError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      'Database is unavailable. Financial operations are disabled in production.',
      503,
      { correlation_id: correlationId }
    );
  }

  // Serialized Transactional In-Memory Execution (Local Dev / Fallback / Concurrent Unit Tests)
  return await inMemoryMutex.runExclusive(cleanUserId, async () => {
    // 1. Check Idempotency Record
    if (cleanIdempotencyKey && requestHash) {
      const existingKeyDoc = inMemoryStore.getDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey) as IdempotencyKeyDocument | null;
      if (existingKeyDoc) {
        if (existingKeyDoc.user_id !== cleanUserId) {
          throw new AlexvyaApiError(
            ErrorCodes.FORBIDDEN,
            'Idempotency key does not belong to authenticated user.',
            403,
            { correlation_id: correlationId }
          );
        }
        if (existingKeyDoc.request_hash !== requestHash) {
          throw new AlexvyaApiError(
            ErrorCodes.IDEMPOTENCY_CONFLICT,
            'Idempotency key reused with different request parameters.',
            409,
            { correlation_id: correlationId }
          );
        }
        if (existingKeyDoc.status === IdempotencyStatus.COMPLETED && existingKeyDoc.response_body) {
          return {
            ...(existingKeyDoc.response_body as unknown as WalletMutationResult),
            isIdempotentReplay: true,
          };
        }
        if (existingKeyDoc.status === IdempotencyStatus.IN_PROGRESS) {
          throw new AlexvyaApiError(
            ErrorCodes.IDEMPOTENCY_IN_PROGRESS,
            'Operation is currently being processed. Please wait.',
            409,
            { correlation_id: correlationId }
          );
        }
      }
    }

    const currentWallet = inMemoryStore.getDoc(WALLETS_COLLECTION, cleanUserId) as WalletDocument | null;
    if (!currentWallet) {
      throw new AlexvyaApiError(
        ErrorCodes.WALLET_NOT_FOUND,
        `Wallet for user '${cleanUserId}' does not exist.`,
        404,
        { user_id: cleanUserId, correlation_id: correlationId }
      );
    }

    validateWalletState(currentWallet, correlationId);
    enforceWalletStatus(currentWallet, correlationId);

    const balanceBeforeKobo = currentWallet.available_balance_kobo;
    const newAvailableBalance = currentWallet.available_balance_kobo + amountKobo;
    const newLedgerBalance = currentWallet.ledger_balance_kobo + amountKobo;

    if (newLedgerBalance > MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO) {
      throw new AlexvyaApiError(
        ErrorCodes.MAX_BALANCE_EXCEEDED,
        `Credit of ${amountKobo} kobo would exceed maximum account balance cap (${MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO} kobo).`,
        400,
        {
          current_ledger_balance_kobo: currentWallet.ledger_balance_kobo,
          amount_kobo: amountKobo,
          max_balance_kobo: MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO,
          correlation_id: correlationId,
        }
      );
    }

    const previousVersion = currentWallet.version;
    const newVersion = previousVersion + 1;

    const ledgerEntry: LedgerDocument = {
      id: ledgerId,
      wallet_id: cleanUserId,
      user_id: cleanUserId,
      transaction_id: txId,
      transaction_reference: txRef,
      entry_type: LedgerEntryType.CREDIT,
      direction: LedgerDirection.INFLOW,
      amount_kobo: amountKobo,
      balance_before_kobo: balanceBeforeKobo,
      balance_after_kobo: newAvailableBalance,
      category,
      description,
      actor,
      created_at: now,
    };

    validateLedgerEntry(ledgerEntry, correlationId);

    const updatedWallet: WalletDocument = {
      ...currentWallet,
      available_balance_kobo: newAvailableBalance,
      ledger_balance_kobo: newLedgerBalance,
      last_ledger_entry_id: ledgerId,
      version: newVersion,
      updated_at: now,
    };

    validateWalletState(updatedWallet, correlationId);

    const result: WalletMutationResult = {
      wallet: updatedWallet,
      ledgerEntry,
      previousVersion,
      newVersion,
      balanceBeforeKobo,
      balanceAfterKobo: newAvailableBalance,
      amountKobo,
    };

    // Atomic in-memory commit
    inMemoryStore.setDoc(WALLETS_COLLECTION, cleanUserId, updatedWallet);
    inMemoryStore.setDoc(`${SUBCOLLECTION_PREFIX}${cleanUserId}`, ledgerId, ledgerEntry);

    if (cleanIdempotencyKey && requestHash) {
      const idempotencyDoc: IdempotencyKeyDocument = {
        id: cleanIdempotencyKey,
        user_id: cleanUserId,
        request_path: '/api/v1/wallet/credit',
        request_hash: requestHash,
        status: IdempotencyStatus.COMPLETED,
        response_code: 200,
        response_body: result as unknown as Record<string, unknown>,
        created_at: now,
        expires_at: calculateIdempotencyExpiresAt(IDEMPOTENCY_RETENTION_MS.PAYSTACK_FUNDING_INIT),
      };
      inMemoryStore.setDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey, idempotencyDoc);
    }

    logger.info(
      `[WalletMutationEngine] Atomically credited ${amountKobo} kobo (in-memory) to wallet ${cleanUserId}. Version: ${previousVersion} -> ${newVersion}`,
      undefined,
      correlationId
    );

    return result;
  });
}

// ============================================================================
// 2. DEBIT WALLET PRIMITIVE
// ============================================================================

/**
 * Atomically debits a customer wallet, appends an immutable DEBIT ledger entry,
 * and records/replays idempotency keys.
 */
export async function debitWallet(params: DebitWalletParams): Promise<WalletMutationResult> {
  const {
    userId,
    amountKobo,
    category = LedgerCategory.AIRTIME_PURCHASE,
    description,
    transactionId,
    transactionReference,
    idempotencyKey,
    actor,
    correlationId,
  } = params;

  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Valid userId is required to debit wallet.',
      400,
      { correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();
  validateMutationAmount(amountKobo, correlationId);
  validateMutationActor(actor, 'DEBIT', correlationId);

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Description is required for wallet debit audit trail.',
      400,
      { correlation_id: correlationId }
    );
  }

  let cleanIdempotencyKey: string | null = null;
  let requestHash: string | null = null;

  if (idempotencyKey !== undefined) {
    validateIdempotencyKeyFormat(idempotencyKey, correlationId);
    cleanIdempotencyKey = idempotencyKey.trim();
    requestHash = computeRequestFingerprint({
      user_id: cleanUserId,
      operation_type: 'DEBIT',
      amount_kobo: amountKobo,
      category,
      description: description.trim(),
      transaction_id: transactionId || null,
      transaction_reference: transactionReference || null,
    });
  }

  const txId = transactionId || `tx_${randomUUID()}`;
  const txRef = transactionReference || generateMutationReference('DBT');
  const ledgerId = `led_${randomUUID()}`;
  const mutationActor: WalletMutationActor = actor || { type: 'CUSTOMER', id: cleanUserId };
  const now = new Date().toISOString();

  const db = getDb();

  // Live Firestore Transaction Path
  if (db) {
    try {
      return await db.runTransaction(async (transaction) => {
        // 1. Check Idempotency Record
        if (cleanIdempotencyKey && requestHash) {
          const idempotencyRef = db.collection(IDEMPOTENCY_COLLECTION).doc(cleanIdempotencyKey);
          const idempotencySnap = await transaction.get(idempotencyRef);

          if (idempotencySnap.exists) {
            const existingKeyDoc = idempotencySnap.data() as IdempotencyKeyDocument;

            // Enforce user isolation
            if (existingKeyDoc.user_id !== cleanUserId) {
              throw new AlexvyaApiError(
                ErrorCodes.FORBIDDEN,
                'Idempotency key does not belong to authenticated user.',
                403,
                { correlation_id: correlationId }
              );
            }

            // Enforce request fingerprint equality
            if (existingKeyDoc.request_hash !== requestHash) {
              throw new AlexvyaApiError(
                ErrorCodes.IDEMPOTENCY_CONFLICT,
                'Idempotency key reused with different request parameters.',
                409,
                { correlation_id: correlationId }
              );
            }

            // Replay completed result
            if (existingKeyDoc.status === IdempotencyStatus.COMPLETED && existingKeyDoc.response_body) {
              logger.info(`[WalletMutationEngine] Idempotent replay for debit key ${cleanIdempotencyKey}`, undefined, correlationId);
              return {
                ...(existingKeyDoc.response_body as unknown as WalletMutationResult),
                isIdempotentReplay: true,
              };
            }

            // Reject if still in progress
            if (existingKeyDoc.status === IdempotencyStatus.IN_PROGRESS) {
              throw new AlexvyaApiError(
                ErrorCodes.IDEMPOTENCY_IN_PROGRESS,
                'Operation is currently being processed. Please wait.',
                409,
                { correlation_id: correlationId }
              );
            }
          }
        }

        // 2. Read and Validate Current Wallet State
        const walletRef = db.collection(WALLETS_COLLECTION).doc(cleanUserId);
        const walletSnap = await transaction.get(walletRef);

        if (!walletSnap.exists) {
          throw new AlexvyaApiError(
            ErrorCodes.WALLET_NOT_FOUND,
            `Wallet for user '${cleanUserId}' does not exist.`,
            404,
            { user_id: cleanUserId, correlation_id: correlationId }
          );
        }

        const currentWallet = { ...walletSnap.data(), id: walletSnap.id } as WalletDocument;
        validateWalletState(currentWallet, correlationId);
        enforceWalletStatus(currentWallet, correlationId);

        const balanceBeforeKobo = currentWallet.available_balance_kobo;

        if (currentWallet.available_balance_kobo < amountKobo) {
          throw new AlexvyaApiError(
            ErrorCodes.INSUFFICIENT_BALANCE,
            `Insufficient available balance. Required: ${amountKobo} kobo, Available: ${currentWallet.available_balance_kobo} kobo.`,
            402,
            {
              required_amount_kobo: amountKobo,
              available_balance_kobo: currentWallet.available_balance_kobo,
              correlation_id: correlationId,
            }
          );
        }

        const newAvailableBalance = currentWallet.available_balance_kobo - amountKobo;
        const newLedgerBalance = currentWallet.ledger_balance_kobo - amountKobo;
        const newDailySpent = currentWallet.daily_spent_kobo + amountKobo;

        const previousVersion = currentWallet.version;
        const newVersion = previousVersion + 1;

        const ledgerEntry: LedgerDocument = {
          id: ledgerId,
          wallet_id: cleanUserId,
          user_id: cleanUserId,
          transaction_id: txId,
          transaction_reference: txRef,
          entry_type: LedgerEntryType.DEBIT,
          direction: LedgerDirection.OUTFLOW,
          amount_kobo: amountKobo,
          balance_before_kobo: balanceBeforeKobo,
          balance_after_kobo: newAvailableBalance,
          category,
          description,
          actor: mutationActor,
          created_at: now,
        };

        validateLedgerEntry(ledgerEntry, correlationId);

        const updatedWallet: WalletDocument = {
          ...currentWallet,
          available_balance_kobo: newAvailableBalance,
          ledger_balance_kobo: newLedgerBalance,
          daily_spent_kobo: newDailySpent,
          last_ledger_entry_id: ledgerId,
          version: newVersion,
          updated_at: now,
        };

        validateWalletState(updatedWallet, correlationId);

        const result: WalletMutationResult = {
          wallet: updatedWallet,
          ledgerEntry,
          previousVersion,
          newVersion,
          balanceBeforeKobo,
          balanceAfterKobo: newAvailableBalance,
          amountKobo,
        };

        const ledgerRef = db.collection(WALLETS_COLLECTION).doc(cleanUserId).collection('ledger').doc(ledgerId);

        // Atomic commit inside transaction
        transaction.set(ledgerRef, ledgerEntry);
        transaction.update(walletRef, {
          available_balance_kobo: updatedWallet.available_balance_kobo,
          ledger_balance_kobo: updatedWallet.ledger_balance_kobo,
          daily_spent_kobo: updatedWallet.daily_spent_kobo,
          last_ledger_entry_id: updatedWallet.last_ledger_entry_id,
          version: updatedWallet.version,
          updated_at: updatedWallet.updated_at,
        });

        // Write Idempotency Record if key was provided
        if (cleanIdempotencyKey && requestHash) {
          const idempotencyRef = db.collection(IDEMPOTENCY_COLLECTION).doc(cleanIdempotencyKey);
          const idempotencyDoc: IdempotencyKeyDocument = {
            id: cleanIdempotencyKey,
            user_id: cleanUserId,
            request_path: '/api/v1/wallet/debit',
            request_hash: requestHash,
            status: IdempotencyStatus.COMPLETED,
            response_code: 200,
            response_body: result as unknown as Record<string, unknown>,
            created_at: now,
            expires_at: calculateIdempotencyExpiresAt(IDEMPOTENCY_RETENTION_MS.VAS_PURCHASE),
          };
          transaction.set(idempotencyRef, idempotencyDoc);
          inMemoryStore.setDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey, idempotencyDoc);
        }

        // Mirror to in-memory store for cache consistency
        inMemoryStore.setDoc(WALLETS_COLLECTION, cleanUserId, updatedWallet);
        inMemoryStore.setDoc(`${SUBCOLLECTION_PREFIX}${cleanUserId}`, ledgerId, ledgerEntry);

        logger.info(
          `[WalletMutationEngine] Atomically debited ${amountKobo} kobo from wallet ${cleanUserId}. Version: ${previousVersion} -> ${newVersion}`,
          undefined,
          correlationId
        );

        return result;
      });
    } catch (err: any) {
      if (err instanceof AlexvyaApiError) {
        throw err;
      }
      logger.warn(`[WalletMutationEngine] Firestore debit transaction failed: ${err.message}`, undefined, correlationId);
      if (process.env.NODE_ENV === 'production') {
        throw new AlexvyaApiError(
          ErrorCodes.SERVICE_UNAVAILABLE,
          'Financial ledger service temporarily unavailable. Please retry shortly.',
          503,
          { original_error: err?.message, correlation_id: correlationId }
        );
      }
    }
  }

  // Serialized Transactional In-Memory Execution (Local Dev / Fallback / Concurrent Unit Tests)
  return await inMemoryMutex.runExclusive(cleanUserId, async () => {
    // 1. Check Idempotency Record
    if (cleanIdempotencyKey && requestHash) {
      const existingKeyDoc = inMemoryStore.getDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey) as IdempotencyKeyDocument | null;
      if (existingKeyDoc) {
        if (existingKeyDoc.user_id !== cleanUserId) {
          throw new AlexvyaApiError(
            ErrorCodes.FORBIDDEN,
            'Idempotency key does not belong to authenticated user.',
            403,
            { correlation_id: correlationId }
          );
        }
        if (existingKeyDoc.request_hash !== requestHash) {
          throw new AlexvyaApiError(
            ErrorCodes.IDEMPOTENCY_CONFLICT,
            'Idempotency key reused with different request parameters.',
            409,
            { correlation_id: correlationId }
          );
        }
        if (existingKeyDoc.status === IdempotencyStatus.COMPLETED && existingKeyDoc.response_body) {
          return {
            ...(existingKeyDoc.response_body as unknown as WalletMutationResult),
            isIdempotentReplay: true,
          };
        }
        if (existingKeyDoc.status === IdempotencyStatus.IN_PROGRESS) {
          throw new AlexvyaApiError(
            ErrorCodes.IDEMPOTENCY_IN_PROGRESS,
            'Operation is currently being processed. Please wait.',
            409,
            { correlation_id: correlationId }
          );
        }
      }
    }

    const currentWallet = inMemoryStore.getDoc(WALLETS_COLLECTION, cleanUserId) as WalletDocument | null;
    if (!currentWallet) {
      throw new AlexvyaApiError(
        ErrorCodes.WALLET_NOT_FOUND,
        `Wallet for user '${cleanUserId}' does not exist.`,
        404,
        { user_id: cleanUserId, correlation_id: correlationId }
      );
    }

    validateWalletState(currentWallet, correlationId);
    enforceWalletStatus(currentWallet, correlationId);

    const balanceBeforeKobo = currentWallet.available_balance_kobo;

    if (currentWallet.available_balance_kobo < amountKobo) {
      throw new AlexvyaApiError(
        ErrorCodes.INSUFFICIENT_BALANCE,
        `Insufficient available balance. Required: ${amountKobo} kobo, Available: ${currentWallet.available_balance_kobo} kobo.`,
        402,
        {
          required_amount_kobo: amountKobo,
          available_balance_kobo: currentWallet.available_balance_kobo,
          correlation_id: correlationId,
        }
      );
    }

    const newAvailableBalance = currentWallet.available_balance_kobo - amountKobo;
    const newLedgerBalance = currentWallet.ledger_balance_kobo - amountKobo;
    const newDailySpent = currentWallet.daily_spent_kobo + amountKobo;

    const previousVersion = currentWallet.version;
    const newVersion = previousVersion + 1;

    const ledgerEntry: LedgerDocument = {
      id: ledgerId,
      wallet_id: cleanUserId,
      user_id: cleanUserId,
      transaction_id: txId,
      transaction_reference: txRef,
      entry_type: LedgerEntryType.DEBIT,
      direction: LedgerDirection.OUTFLOW,
      amount_kobo: amountKobo,
      balance_before_kobo: balanceBeforeKobo,
      balance_after_kobo: newAvailableBalance,
      category,
      description,
      actor: mutationActor,
      created_at: now,
    };

    validateLedgerEntry(ledgerEntry, correlationId);

    const updatedWallet: WalletDocument = {
      ...currentWallet,
      available_balance_kobo: newAvailableBalance,
      ledger_balance_kobo: newLedgerBalance,
      daily_spent_kobo: newDailySpent,
      last_ledger_entry_id: ledgerId,
      version: newVersion,
      updated_at: now,
    };

    validateWalletState(updatedWallet, correlationId);

    const result: WalletMutationResult = {
      wallet: updatedWallet,
      ledgerEntry,
      previousVersion,
      newVersion,
      balanceBeforeKobo,
      balanceAfterKobo: newAvailableBalance,
      amountKobo,
    };

    // Atomic state commit
    inMemoryStore.setDoc(WALLETS_COLLECTION, cleanUserId, updatedWallet);
    inMemoryStore.setDoc(`${SUBCOLLECTION_PREFIX}${cleanUserId}`, ledgerId, ledgerEntry);

    if (cleanIdempotencyKey && requestHash) {
      const idempotencyDoc: IdempotencyKeyDocument = {
        id: cleanIdempotencyKey,
        user_id: cleanUserId,
        request_path: '/api/v1/wallet/debit',
        request_hash: requestHash,
        status: IdempotencyStatus.COMPLETED,
        response_code: 200,
        response_body: result as unknown as Record<string, unknown>,
        created_at: now,
        expires_at: calculateIdempotencyExpiresAt(IDEMPOTENCY_RETENTION_MS.VAS_PURCHASE),
      };
      inMemoryStore.setDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey, idempotencyDoc);
    }

    logger.info(
      `[WalletMutationEngine] Atomically debited ${amountKobo} kobo (in-memory) from wallet ${cleanUserId}. Version: ${previousVersion} -> ${newVersion}`,
      undefined,
      correlationId
    );

    return result;
  });
}

// ============================================================================
// 3. REFUND / COMPENSATING CREDIT PRIMITIVE WITH PERMANENT DEDUPLICATION
// ============================================================================

/**
 * Atomically executes a compensating refund to a customer wallet with permanent deduplication.
 * Original debit records are NEVER modified.
 */
export async function refundWallet(params: RefundWalletParams): Promise<WalletMutationResult> {
  const {
    userId,
    amountKobo,
    originalTransactionId,
    originalTransactionReference,
    category = LedgerCategory.REFUND,
    description,
    idempotencyKey,
    actor = { type: 'SYSTEM', id: 'SYSTEM' },
    correlationId,
  } = params;

  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Valid userId is required to refund wallet.',
      400,
      { correlation_id: correlationId }
    );
  }

  if (!originalTransactionId || !originalTransactionReference) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      'Original transaction ID and transaction reference are required for traceable refund.',
      400,
      { originalTransactionId, originalTransactionReference, correlation_id: correlationId }
    );
  }

  const cleanUserId = userId.trim();
  validateMutationAmount(amountKobo, correlationId);
  validateMutationActor(actor, 'REFUND', correlationId);

  const refundDescription =
    description && description.trim().length > 0
      ? description.trim()
      : `Compensating refund for failed transaction ${originalTransactionReference}`;

  // Deterministic permanent deduplication key for this parent transaction's refund
  const refundDedupKey = `ref_dedup_${originalTransactionId}`;

  let cleanIdempotencyKey: string = idempotencyKey ? idempotencyKey.trim() : refundDedupKey;
  validateIdempotencyKeyFormat(cleanIdempotencyKey, correlationId);

  const requestHash = computeRequestFingerprint({
    user_id: cleanUserId,
    operation_type: 'REFUND',
    amount_kobo: amountKobo,
    original_transaction_id: originalTransactionId,
    original_transaction_reference: originalTransactionReference,
  });

  const txId = originalTransactionId;
  const txRef = originalTransactionReference;
  const ledgerId = `led_${randomUUID()}`;
  const now = new Date().toISOString();

  const db = getDb();

  // Live Firestore Transaction Path
  if (db) {
    try {
      return await db.runTransaction(async (transaction) => {
        // 1. Check Permanent Dedup / Idempotency Record
        const idempotencyRef = db.collection(IDEMPOTENCY_COLLECTION).doc(cleanIdempotencyKey);
        const idempotencySnap = await transaction.get(idempotencyRef);

        if (idempotencySnap.exists) {
          const existingKeyDoc = idempotencySnap.data() as IdempotencyKeyDocument;

          // User isolation
          if (existingKeyDoc.user_id !== cleanUserId) {
            throw new AlexvyaApiError(
              ErrorCodes.FORBIDDEN,
              'Refund record does not belong to authenticated user.',
              403,
              { correlation_id: correlationId }
            );
          }

          // If identical key ID and identical request hash, return idempotent replay
          if (
            existingKeyDoc.id === cleanIdempotencyKey &&
            existingKeyDoc.request_hash === requestHash &&
            existingKeyDoc.status === IdempotencyStatus.COMPLETED &&
            existingKeyDoc.response_body
          ) {
            logger.info(`[WalletMutationEngine] Idempotent replay for refund tx ${originalTransactionId}`, undefined, correlationId);
            return {
              ...(existingKeyDoc.response_body as unknown as WalletMutationResult),
              isIdempotentReplay: true,
            };
          }

          // Otherwise, duplicate refund conflict
          throw new AlexvyaApiError(
            ErrorCodes.DUPLICATE_REFUND,
            `Transaction ${originalTransactionReference} has already been refunded.`,
            409,
            { originalTransactionId, originalTransactionReference, correlation_id: correlationId }
          );
        }

        // Also check if dedup record exists under default ref_dedup key if client used a custom idempotency key
        if (cleanIdempotencyKey !== refundDedupKey) {
          const defaultDedupRef = db.collection(IDEMPOTENCY_COLLECTION).doc(refundDedupKey);
          const defaultDedupSnap = await transaction.get(defaultDedupRef);
          if (defaultDedupSnap.exists) {
            const existingDoc = defaultDedupSnap.data() as IdempotencyKeyDocument;
            if (
              existingDoc.id === cleanIdempotencyKey &&
              existingDoc.request_hash === requestHash &&
              existingDoc.status === IdempotencyStatus.COMPLETED &&
              existingDoc.response_body
            ) {
              return {
                ...(existingDoc.response_body as unknown as WalletMutationResult),
                isIdempotentReplay: true,
              };
            }
            throw new AlexvyaApiError(
              ErrorCodes.DUPLICATE_REFUND,
              `Transaction ${originalTransactionReference} has already been refunded.`,
              409,
              { originalTransactionId, correlation_id: correlationId }
            );
          }
        }

        // 2. Read and Validate Current Wallet State
        const walletRef = db.collection(WALLETS_COLLECTION).doc(cleanUserId);
        const walletSnap = await transaction.get(walletRef);

        if (!walletSnap.exists) {
          throw new AlexvyaApiError(
            ErrorCodes.WALLET_NOT_FOUND,
            `Wallet for user '${cleanUserId}' does not exist.`,
            404,
            { user_id: cleanUserId, correlation_id: correlationId }
          );
        }

        const currentWallet = { ...walletSnap.data(), id: walletSnap.id } as WalletDocument;
        validateWalletState(currentWallet, correlationId);
        enforceWalletStatus(currentWallet, correlationId);

        const balanceBeforeKobo = currentWallet.available_balance_kobo;
        const newAvailableBalance = currentWallet.available_balance_kobo + amountKobo;
        const newLedgerBalance = currentWallet.ledger_balance_kobo + amountKobo;
        const newDailySpent = Math.max(0, currentWallet.daily_spent_kobo - amountKobo);

        if (newLedgerBalance > MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO) {
          throw new AlexvyaApiError(
            ErrorCodes.MAX_BALANCE_EXCEEDED,
            `Refund of ${amountKobo} kobo would exceed maximum account balance cap (${MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO} kobo).`,
            400,
            {
              current_ledger_balance_kobo: currentWallet.ledger_balance_kobo,
              amount_kobo: amountKobo,
              max_balance_kobo: MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO,
              correlation_id: correlationId,
            }
          );
        }

        const previousVersion = currentWallet.version;
        const newVersion = previousVersion + 1;

        const ledgerEntry: LedgerDocument = {
          id: ledgerId,
          wallet_id: cleanUserId,
          user_id: cleanUserId,
          transaction_id: txId,
          transaction_reference: txRef,
          entry_type: LedgerEntryType.CREDIT,
          direction: LedgerDirection.INFLOW,
          amount_kobo: amountKobo,
          balance_before_kobo: balanceBeforeKobo,
          balance_after_kobo: newAvailableBalance,
          category,
          description: refundDescription,
          actor,
          created_at: now,
        };

        validateLedgerEntry(ledgerEntry, correlationId);

        const updatedWallet: WalletDocument = {
          ...currentWallet,
          available_balance_kobo: newAvailableBalance,
          ledger_balance_kobo: newLedgerBalance,
          daily_spent_kobo: newDailySpent,
          last_ledger_entry_id: ledgerId,
          version: newVersion,
          updated_at: now,
        };

        validateWalletState(updatedWallet, correlationId);

        const result: WalletMutationResult = {
          wallet: updatedWallet,
          ledgerEntry,
          previousVersion,
          newVersion,
          balanceBeforeKobo,
          balanceAfterKobo: newAvailableBalance,
          amountKobo,
        };

        const ledgerRef = db.collection(WALLETS_COLLECTION).doc(cleanUserId).collection('ledger').doc(ledgerId);

        // Atomic commit inside transaction
        transaction.set(ledgerRef, ledgerEntry);
        transaction.update(walletRef, {
          available_balance_kobo: updatedWallet.available_balance_kobo,
          ledger_balance_kobo: updatedWallet.ledger_balance_kobo,
          daily_spent_kobo: updatedWallet.daily_spent_kobo,
          last_ledger_entry_id: updatedWallet.last_ledger_entry_id,
          version: updatedWallet.version,
          updated_at: updatedWallet.updated_at,
        });

        // Set Permanent Dedup Idempotency Record (100 Years)
        const idempotencyDoc: IdempotencyKeyDocument = {
          id: cleanIdempotencyKey,
          user_id: cleanUserId,
          request_path: '/api/v1/wallet/refund',
          request_hash: requestHash,
          status: IdempotencyStatus.COMPLETED,
          response_code: 200,
          response_body: result as unknown as Record<string, unknown>,
          created_at: now,
          expires_at: calculateIdempotencyExpiresAt(IDEMPOTENCY_RETENTION_MS.REFUND_ADMIN_ADJUSTMENT),
        };
        transaction.set(idempotencyRef, idempotencyDoc);

        if (cleanIdempotencyKey !== refundDedupKey) {
          const defaultDedupRef = db.collection(IDEMPOTENCY_COLLECTION).doc(refundDedupKey);
          transaction.set(defaultDedupRef, idempotencyDoc);
          inMemoryStore.setDoc(IDEMPOTENCY_COLLECTION, refundDedupKey, idempotencyDoc);
        }

        // Mirror to in-memory store for cache consistency
        inMemoryStore.setDoc(WALLETS_COLLECTION, cleanUserId, updatedWallet);
        inMemoryStore.setDoc(`${SUBCOLLECTION_PREFIX}${cleanUserId}`, ledgerId, ledgerEntry);
        inMemoryStore.setDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey, idempotencyDoc);

        logger.info(
          `[WalletMutationEngine] Atomically refunded ${amountKobo} kobo to wallet ${cleanUserId} for tx ${txRef}. Version: ${previousVersion} -> ${newVersion}`,
          undefined,
          correlationId
        );

        return result;
      });
    } catch (err: any) {
      if (err instanceof AlexvyaApiError) {
        throw err;
      }
      logger.warn(`[WalletMutationEngine] Firestore refund transaction failed: ${err.message}`, undefined, correlationId);
      if (process.env.NODE_ENV === 'production') {
        throw new AlexvyaApiError(
          ErrorCodes.SERVICE_UNAVAILABLE,
          'Financial ledger service temporarily unavailable. Please retry shortly.',
          503,
          { original_error: err?.message, correlation_id: correlationId }
        );
      }
    }
  }

  // Serialized Transactional In-Memory Execution (Local Dev / Fallback / Isolated Tests)
  return await inMemoryMutex.runExclusive(cleanUserId, async () => {
    // 1. Check Permanent Dedup / Idempotency Record
    const existingKeyDoc =
      (inMemoryStore.getDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey) as IdempotencyKeyDocument | null) ||
      (inMemoryStore.getDoc(IDEMPOTENCY_COLLECTION, refundDedupKey) as IdempotencyKeyDocument | null);

    if (existingKeyDoc) {
      if (existingKeyDoc.user_id !== cleanUserId) {
        throw new AlexvyaApiError(
          ErrorCodes.FORBIDDEN,
          'Refund record does not belong to authenticated user.',
          403,
          { correlation_id: correlationId }
        );
      }
      if (
        existingKeyDoc.id === cleanIdempotencyKey &&
        existingKeyDoc.request_hash === requestHash &&
        existingKeyDoc.status === IdempotencyStatus.COMPLETED &&
        existingKeyDoc.response_body
      ) {
        return {
          ...(existingKeyDoc.response_body as unknown as WalletMutationResult),
          isIdempotentReplay: true,
        };
      }
      throw new AlexvyaApiError(
        ErrorCodes.DUPLICATE_REFUND,
        `Transaction ${originalTransactionReference} has already been refunded.`,
        409,
        { originalTransactionId, correlation_id: correlationId }
      );
    }

    const currentWallet = inMemoryStore.getDoc(WALLETS_COLLECTION, cleanUserId) as WalletDocument | null;
    if (!currentWallet) {
      throw new AlexvyaApiError(
        ErrorCodes.WALLET_NOT_FOUND,
        `Wallet for user '${cleanUserId}' does not exist.`,
        404,
        { user_id: cleanUserId, correlation_id: correlationId }
      );
    }

    validateWalletState(currentWallet, correlationId);
    enforceWalletStatus(currentWallet, correlationId);

    const balanceBeforeKobo = currentWallet.available_balance_kobo;
    const newAvailableBalance = currentWallet.available_balance_kobo + amountKobo;
    const newLedgerBalance = currentWallet.ledger_balance_kobo + amountKobo;
    const newDailySpent = Math.max(0, currentWallet.daily_spent_kobo - amountKobo);

    if (newLedgerBalance > MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO) {
      throw new AlexvyaApiError(
        ErrorCodes.MAX_BALANCE_EXCEEDED,
        `Refund of ${amountKobo} kobo would exceed maximum account balance cap (${MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO} kobo).`,
        400,
        {
          current_ledger_balance_kobo: currentWallet.ledger_balance_kobo,
          amount_kobo: amountKobo,
          max_balance_kobo: MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO,
          correlation_id: correlationId,
        }
      );
    }

    const previousVersion = currentWallet.version;
    const newVersion = previousVersion + 1;

    const ledgerEntry: LedgerDocument = {
      id: ledgerId,
      wallet_id: cleanUserId,
      user_id: cleanUserId,
      transaction_id: txId,
      transaction_reference: txRef,
      entry_type: LedgerEntryType.CREDIT,
      direction: LedgerDirection.INFLOW,
      amount_kobo: amountKobo,
      balance_before_kobo: balanceBeforeKobo,
      balance_after_kobo: newAvailableBalance,
      category,
      description: refundDescription,
      actor,
      created_at: now,
    };

    validateLedgerEntry(ledgerEntry, correlationId);

    const updatedWallet: WalletDocument = {
      ...currentWallet,
      available_balance_kobo: newAvailableBalance,
      ledger_balance_kobo: newLedgerBalance,
      daily_spent_kobo: newDailySpent,
      last_ledger_entry_id: ledgerId,
      version: newVersion,
      updated_at: now,
    };

    validateWalletState(updatedWallet, correlationId);

    const result: WalletMutationResult = {
      wallet: updatedWallet,
      ledgerEntry,
      previousVersion,
      newVersion,
      balanceBeforeKobo,
      balanceAfterKobo: newAvailableBalance,
      amountKobo,
    };

    // Atomic state commit
    inMemoryStore.setDoc(WALLETS_COLLECTION, cleanUserId, updatedWallet);
    inMemoryStore.setDoc(`${SUBCOLLECTION_PREFIX}${cleanUserId}`, ledgerId, ledgerEntry);

    const idempotencyDoc: IdempotencyKeyDocument = {
      id: cleanIdempotencyKey,
      user_id: cleanUserId,
      request_path: '/api/v1/wallet/refund',
      request_hash: requestHash,
      status: IdempotencyStatus.COMPLETED,
      response_code: 200,
      response_body: result as unknown as Record<string, unknown>,
      created_at: now,
      expires_at: calculateIdempotencyExpiresAt(IDEMPOTENCY_RETENTION_MS.REFUND_ADMIN_ADJUSTMENT),
    };

    inMemoryStore.setDoc(IDEMPOTENCY_COLLECTION, cleanIdempotencyKey, idempotencyDoc);
    if (cleanIdempotencyKey !== refundDedupKey) {
      inMemoryStore.setDoc(IDEMPOTENCY_COLLECTION, refundDedupKey, idempotencyDoc);
    }

    logger.info(
      `[WalletMutationEngine] Atomically refunded ${amountKobo} kobo (in-memory) to wallet ${cleanUserId} for tx ${txRef}. Version: ${previousVersion} -> ${newVersion}`,
      undefined,
      correlationId
    );

    return result;
  });
}
