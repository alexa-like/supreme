/**
 * Alexvya Platform — Inbound Webhook Events Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: webhookEvents/{webhookEventId}
 */

import { inMemoryStore, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { WebhookEventDocument } from '../../types/firestore.ts';
import { ProviderId, WebhookProcessingStatus } from '../../types/enums.ts';
import { webhookEventDocumentSchema } from '../../lib/validation/firestore.ts';

const COLLECTION_NAME = 'webhookEvents';

export async function getWebhookEventById(webhookEventId: string): Promise<WebhookEventDocument | null> {
  return inMemoryStore.getDoc(COLLECTION_NAME, webhookEventId);
}

export async function createWebhookEvent(event: WebhookEventDocument): Promise<WebhookEventDocument> {
  webhookEventDocumentSchema.parse(event);
  inMemoryStore.setDoc(COLLECTION_NAME, event.id, event);
  return event;
}

/**
 * Queue query for asynchronous webhook processors.
 * Uses composite index: provider ASC, processing_status ASC, received_at ASC.
 */
export async function queryPendingWebhooks(
  provider?: ProviderId,
  options: PaginationOptions = {}
): Promise<PaginatedResult<WebhookEventDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  let events: WebhookEventDocument[] = Array.from(col.values())
    .filter((w) => w.processing_status === WebhookProcessingStatus.PENDING);

  if (provider) {
    events = events.filter((w) => w.provider === provider);
  }

  events.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime()); // FIFO order

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = events.findIndex((w) => w.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = events.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < events.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: events.length,
  };
}

export async function updateWebhookEvent(
  webhookEventId: string,
  updates: Partial<WebhookEventDocument>
): Promise<WebhookEventDocument | null> {
  const existing = await getWebhookEventById(webhookEventId);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  webhookEventDocumentSchema.parse(updated);
  inMemoryStore.setDoc(COLLECTION_NAME, webhookEventId, updated);
  return updated;
}

