/**
 * Alexvya Platform — In-App Notifications Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: notifications/{notificationId}
 */

import { inMemoryStore, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { NotificationDocument } from '../../types/firestore.ts';
import { notificationDocumentSchema } from '../../lib/validation/firestore.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';

const COLLECTION_NAME = 'notifications';

export async function getNotificationById(notificationId: string): Promise<NotificationDocument | null> {
  return inMemoryStore.getDoc(COLLECTION_NAME, notificationId);
}

let shouldFailNotification = false;

export function setSimulateNotificationFailure(fail: boolean): void {
  shouldFailNotification = fail;
}

export async function createNotification(notification: NotificationDocument): Promise<NotificationDocument> {
  if (shouldFailNotification) {
    throw new Error('Simulated FCM / In-App Notification Delivery Failure');
  }
  notificationDocumentSchema.parse(notification);
  inMemoryStore.setDoc(COLLECTION_NAME, notification.id, notification);
  return notification;
}


export interface NotificationQueryOptions extends PaginationOptions {
  is_read?: boolean;
}

/**
 * Customer notifications inbox query.
 * Uses composite index: user_id ASC, is_read ASC, created_at DESC.
 */
export async function queryNotificationsByUser(
  userId: string,
  options: NotificationQueryOptions = {}
): Promise<PaginatedResult<NotificationDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  let notifs: NotificationDocument[] = Array.from(col.values()).filter((n) => n.user_id === userId);

  if (options.is_read !== undefined) {
    notifs = notifs.filter((n) => n.is_read === options.is_read);
  }

  notifs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = notifs.findIndex((n) => n.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = notifs.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < notifs.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: notifs.length,
  };
}

export async function markNotificationAsRead(userId: string, notificationId: string): Promise<NotificationDocument> {
  const notif = await getNotificationById(notificationId);
  if (!notif) {
    throw new AlexvyaApiError(ErrorCodes.RESOURCE_NOT_FOUND, `Notification ${notificationId} not found`, 404);
  }
  if (notif.user_id !== userId) {
    throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, `Cross-user notification modification forbidden`, 403);
  }
  return inMemoryStore.updateDoc(COLLECTION_NAME, notificationId, { is_read: true });
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  return Array.from(col.values()).filter((n) => n.user_id === userId && !n.is_read).length;
}

export async function markAllNotificationsAsRead(userId: string): Promise<number> {
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  let updatedCount = 0;
  for (const notif of col.values()) {
    if (notif.user_id === userId && !notif.is_read) {
      inMemoryStore.updateDoc(COLLECTION_NAME, notif.id, { is_read: true });
      updatedCount++;
    }
  }
  return updatedCount;
}
