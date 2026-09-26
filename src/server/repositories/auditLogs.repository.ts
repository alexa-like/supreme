/**
 * Alexvya Platform — Audit Logs Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: auditLogs/{auditLogId}
 * 
 * STRICT INVARIANT: Audit logs are append-only. Zero updates or deletions permitted.
 */

import { inMemoryStore, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { AuditLogDocument } from '../../types/firestore.ts';
import { AuditAction } from '../../types/enums.ts';
import { auditLogDocumentSchema } from '../../lib/validation/firestore.ts';

const COLLECTION_NAME = 'auditLogs';

export async function getAuditLogById(auditLogId: string): Promise<AuditLogDocument | null> {
  return inMemoryStore.getDoc(COLLECTION_NAME, auditLogId);
}

export async function createAuditLog(log: AuditLogDocument): Promise<AuditLogDocument> {
  auditLogDocumentSchema.parse(log);
  inMemoryStore.setDoc(COLLECTION_NAME, log.id, log);
  return log;
}

/**
 * Administrative compliance query by staff actor.
 * Uses composite index: actor_id ASC, created_at DESC.
 */
export async function queryAuditLogsByActor(
  actorId: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<AuditLogDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  const logs: AuditLogDocument[] = Array.from(col.values())
    .filter((l) => l.actor_id === actorId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = logs.findIndex((l) => l.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = logs.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < logs.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: logs.length,
  };
}

/**
 * Compliance query by action (e.g. WALLET_ADJUSTMENT).
 * Uses composite index: action ASC, created_at DESC.
 */
export async function queryAuditLogsByAction(
  action: AuditAction,
  options: PaginationOptions = {}
): Promise<PaginatedResult<AuditLogDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  const logs: AuditLogDocument[] = Array.from(col.values())
    .filter((l) => l.action === action)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = logs.findIndex((l) => l.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = logs.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < logs.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: logs.length,
  };
}
