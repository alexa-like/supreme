/**
 * Alexvya Platform — Base Repository & Pagination Foundation
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Provides:
 * - Standard cursor-based pagination types
 * - Server Firestore Admin SDK connection resolver
 * - In-memory test store fallback for hermetic unit testing / offline execution
 */

import { getAdminFirestore } from '../firebase/admin.ts';
import { logger } from '../../lib/logger/logger.ts';

export interface PaginationOptions {
  limit?: number;
  cursor?: string | null; // Document ID to start after
  direction?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function sanitizePageLimit(limit?: number): number {
  if (!limit || !Number.isSafeInteger(limit) || limit <= 0) {
    return DEFAULT_PAGE_LIMIT;
  }
  return Math.min(limit, MAX_PAGE_LIMIT);
}

/**
 * Standard in-memory test store for isolated testing and development environments
 * where GCP credentials or Firebase Emulator are unavailable.
 */
class InMemoryRepositoryStore {
  private collections: Map<string, Map<string, any>> = new Map();

  getCollection(name: string): Map<string, any> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    return this.collections.get(name)!;
  }

  getDoc(collection: string, id: string): any | null {
    const col = this.getCollection(collection);
    return col.get(id) || null;
  }

  setDoc(collection: string, id: string, data: any): void {
    const col = this.getCollection(collection);
    col.set(id, { ...data, id });
  }

  updateDoc(collection: string, id: string, updates: any): any {
    const col = this.getCollection(collection);
    const existing = col.get(id);
    if (!existing) {
      throw new Error(`Document ${collection}/${id} not found in in-memory store`);
    }
    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
    col.set(id, updated);
    return updated;
  }

  deleteDoc(collection: string, id: string): void {
    const col = this.getCollection(collection);
    col.delete(id);
  }

  listDocs<T = any>(collection: string): T[] {
    const col = this.getCollection(collection);
    return Array.from(col.values()) as T[];
  }

  clear(): void {
    this.collections.clear();
  }
}

let lastPermissionDeniedTimestamp = 0;
const RETRY_INTERVAL_MS = 15000;

export function recordFirestoreError(err: any): void {
  const errMsg = String(err?.message || err);
  if (err?.code === 7 || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('insufficient permissions')) {
    lastPermissionDeniedTimestamp = Date.now();
  }
}

export function isFirestoreAvailable(): boolean {
  if (lastPermissionDeniedTimestamp > 0 && Date.now() - lastPermissionDeniedTimestamp < RETRY_INTERVAL_MS) {
    return false;
  }
  return true;
}

export const inMemoryStore = new InMemoryRepositoryStore();

let forceHermeticStore = false;

export function __setHermeticTestStore(enabled: boolean): void {
  forceHermeticStore = enabled;
}

/**
 * Safe helper to obtain Firestore instance or fallback
 */
export function getDb() {
  if (forceHermeticStore || process.env.NODE_ENV === 'test') {
    return null;
  }
  if (!isFirestoreAvailable()) {
    return null;
  }
  try {
    return getAdminFirestore();
  } catch (err) {
    return null;
  }
}

