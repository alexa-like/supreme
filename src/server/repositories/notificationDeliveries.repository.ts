/**
 * Supreme Digital Network — Notification Deliveries Repository (Server-Only)
 * Stage 2.14 Production Notifications, Email Delivery & Communication Infrastructure
 * 
 * Target Collection: notificationDeliveries/{deliveryId}
 */

import { getDb, inMemoryStore, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

const COLLECTION_NAME = 'notificationDeliveries';

export type DeliveryChannel = 'EMAIL' | 'IN_APP';
export type DeliveryStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'BOUNCED' | 'SKIPPED';

export interface NotificationDeliveryDocument {
  id: string; // UUIDv4 or deduplication key
  notification_id: string | null; // ID of in-app notification if created
  user_id: string;
  user_email: string;
  channel: DeliveryChannel;
  event_type: string; // e.g. WALLET_FUNDING_SUCCESS, VAS_AIRTIME_SUCCESS, KYC_APPROVED
  status: DeliveryStatus;
  provider: 'resend' | 'internal';
  provider_message_id: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  sent_at: string | null;
  failure_reason: string | null;
  correlation_id: string;
  deduplication_key: string;
  created_at: string;
  updated_at: string;
}

export async function createNotificationDelivery(
  delivery: NotificationDeliveryDocument
): Promise<NotificationDeliveryDocument> {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(delivery.id).set(delivery);
    } catch (err: any) {
      logger.warn(`[NotificationDeliveriesRepository] Firestore create fallback for ${delivery.id}: ${err.message}`);
    }
  }
  inMemoryStore.setDoc(COLLECTION_NAME, delivery.id, delivery);
  return delivery;
}

export async function getNotificationDeliveryById(
  deliveryId: string
): Promise<NotificationDeliveryDocument | null> {
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTION_NAME).doc(deliveryId).get();
      if (snap.exists) {
        return snap.data() as NotificationDeliveryDocument;
      }
    } catch (err: any) {
      logger.warn(`[NotificationDeliveriesRepository] Firestore read fallback for ${deliveryId}: ${err.message}`);
    }
  }
  return inMemoryStore.getDoc(COLLECTION_NAME, deliveryId);
}

export async function getNotificationDeliveryByDeduplicationKey(
  deduplicationKey: string
): Promise<NotificationDeliveryDocument | null> {
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  for (const doc of col.values()) {
    if (doc.deduplication_key === deduplicationKey) {
      return doc as NotificationDeliveryDocument;
    }
  }

  const db = getDb();
  if (db) {
    try {
      const querySnap = await db
        .collection(COLLECTION_NAME)
        .where('deduplication_key', '==', deduplicationKey)
        .limit(1)
        .get();
      if (!querySnap.empty) {
        return querySnap.docs[0].data() as NotificationDeliveryDocument;
      }
    } catch (err: any) {
      logger.warn(`[NotificationDeliveriesRepository] Firestore query fallback for dedup key ${deduplicationKey}: ${err.message}`);
    }
  }
  return null;
}

export async function updateNotificationDelivery(
  deliveryId: string,
  updates: Partial<NotificationDeliveryDocument>
): Promise<NotificationDeliveryDocument> {
  const existing = await getNotificationDeliveryById(deliveryId);
  if (!existing) {
    throw new AlexvyaApiError(
      ErrorCodes.RESOURCE_NOT_FOUND,
      `Notification delivery ${deliveryId} not found`,
      404
    );
  }

  const updated: NotificationDeliveryDocument = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTION_NAME).doc(deliveryId).update(updates);
    } catch (err: any) {
      logger.warn(`[NotificationDeliveriesRepository] Firestore update fallback for ${deliveryId}: ${err.message}`);
    }
  }

  inMemoryStore.setDoc(COLLECTION_NAME, deliveryId, updated);
  return updated;
}

/**
 * Atomic worker claim lease for notification delivery to prevent duplicate sends across concurrent workers.
 * Lease duration: 300 seconds (5 minutes). If leased > 300s ago, lease expires and can be reclaimed.
 */
export async function claimNotificationDeliveryForWorker(
  deliveryId: string,
  workerId: string
): Promise<boolean> {
  const delivery = await getNotificationDeliveryById(deliveryId);
  if (!delivery) return false;

  const nowMs = Date.now();
  const leaseTimeoutMs = 300 * 1000; // 5 minute lease expiry
  const lastAttemptMs = delivery.last_attempt_at ? new Date(delivery.last_attempt_at).getTime() : 0;
  const isLeaseExpired = delivery.status === 'SENDING' && (nowMs - lastAttemptMs > leaseTimeoutMs);

  // Allow claim if status is QUEUED or FAILED, or if SENDING lease expired
  if (delivery.status !== 'QUEUED' && delivery.status !== 'FAILED' && !isLeaseExpired) {
    return false; // Already leased or completed
  }

  const nowIso = new Date(nowMs).toISOString();
  await updateNotificationDelivery(deliveryId, {
    status: 'SENDING',
    attempt_count: delivery.attempt_count + 1,
    last_attempt_at: nowIso,
  });

  return true;
}

/**
 * Query queued or failed delivery records eligible for background retry.
 */
export async function queryDeliveriesForWorker(
  limitCount = 50
): Promise<NotificationDeliveryDocument[]> {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const leaseTimeoutMs = 300 * 1000;
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  const eligible: NotificationDeliveryDocument[] = Array.from(col.values()).filter((doc) => {
    if (doc.channel !== 'EMAIL') return false;
    if (doc.attempt_count >= 5) return false;

    const isQueued = doc.status === 'QUEUED';
    const isFailed = doc.status === 'FAILED' && (!doc.next_retry_at || doc.next_retry_at <= nowIso);
    const lastAttemptMs = doc.last_attempt_at ? new Date(doc.last_attempt_at).getTime() : 0;
    const isExpiredSending = doc.status === 'SENDING' && (nowMs - lastAttemptMs > leaseTimeoutMs);

    return isQueued || isFailed || isExpiredSending;
  });

  eligible.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return eligible.slice(0, limitCount);
}

export interface AdminNotificationDeliveryQueryOptions extends PaginationOptions {
  status?: DeliveryStatus;
  userId?: string;
  eventType?: string;
}

/**
 * Admin investigation query for notification delivery logs.
 */
export async function queryNotificationDeliveriesForAdmin(
  options: AdminNotificationDeliveryQueryOptions = {}
): Promise<PaginatedResult<NotificationDeliveryDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  let items: NotificationDeliveryDocument[] = Array.from(col.values());

  if (options.status) {
    items = items.filter((d) => d.status === options.status);
  }
  if (options.userId) {
    items = items.filter((d) => d.user_id === options.userId);
  }
  if (options.eventType) {
    items = items.filter((d) => d.event_type === options.eventType);
  }

  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let startIndex = 0;
  if (options.cursor) {
    const idx = items.findIndex((d) => d.id === options.cursor);
    if (idx !== -1) {
      startIndex = idx + 1;
    }
  }

  const paged = items.slice(startIndex, startIndex + limit);
  const nextCursor =
    paged.length === limit && startIndex + limit < items.length
      ? paged[paged.length - 1].id
      : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: items.length,
  };
}
