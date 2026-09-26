/**
 * Supreme Digital Network — Core Unified Notification Service
 * Stage 2.14 Production Notifications, Email Delivery & Communication Infrastructure
 * 
 * CORE ARCHITECTURAL INVARIANTS:
 * 1. Financial Failure Isolation: Notification failures NEVER roll back wallet credits, debits, refunds, or KYC decisions.
 * 2. Idempotent Delivery: Deduplicates on event_type + user_id + source_entity_id + channel to prevent double emails.
 * 3. User Preferences: Respects notification_preferences (email_on_wallet_credit, email_on_purchase) except for security/KYC alerts.
 * 4. Resend Integration: Uses Resend email provider adapter; missing RESEND_API_KEY enters SKIPPED state safely.
 * 5. Correlation & Observability: Propagates correlation_id through all logs and delivery records.
 */

import { randomUUID } from 'crypto';
import { createNotification } from '../../repositories/notifications.repository.ts';
import {
  createNotificationDelivery,
  getNotificationDeliveryByDeduplicationKey,
  updateNotificationDelivery,
  NotificationDeliveryDocument,
  DeliveryStatus,
} from '../../repositories/notificationDeliveries.repository.ts';
import { getUserById } from '../../repositories/users.repository.ts';
import { sendTransactionalEmail } from './emailProvider.ts';
import { renderEmailTemplate } from './emailTemplates.ts';
import { NotificationCategory } from '../../../types/enums.ts';
import { logger } from '../../../lib/logger/logger.ts';

export interface DispatchNotificationParams {
  userId: string;
  eventType: string; // e.g. WALLET_FUNDING_SUCCESS, VAS_AIRTIME_SUCCESS, KYC_APPROVED
  title: string;
  message: string;
  category: NotificationCategory;
  amountKobo?: number | null;
  relatedTransactionReference?: string | null;
  sourceEntityId?: string | null; // e.g. orderId, transactionId, verificationId
  details?: Record<string, any>;
  correlationId?: string;
}

export class NotificationService {
  /**
   * Primary entry point for dispatching in-app and email notifications.
   * NEVER throws an exception that breaks caller financial operations.
   */
  public static async dispatchNotification(params: DispatchNotificationParams): Promise<{
    inAppCreated: boolean;
    emailStatus: DeliveryStatus;
    deliveryId: string;
  }> {
    const correlationId = params.correlationId || `cor_notif_${Date.now()}`;
    const sourceId = params.sourceEntityId || params.relatedTransactionReference || randomUUID();
    const nowIso = new Date().toISOString();

    let inAppCreated = false;
    let emailStatus: DeliveryStatus = 'SKIPPED';
    let deliveryId = `del_${randomUUID()}`;

    try {
      // 1. Fetch User Profile
      const user = await getUserById(params.userId);
      const userEmail = user?.email || params.details?.email || '';
      const userName = user?.display_name || user?.first_name || 'Valued Customer';

      // 2. Persistent In-App Deduplication Check
      const inAppDedupKey = `dedup_inapp_${params.eventType}_${params.userId}_${sourceId}`;
      const existingInAppDelivery = await getNotificationDeliveryByDeduplicationKey(inAppDedupKey);

      let inAppNotifId = `notif_${randomUUID()}`;
      if (!existingInAppDelivery) {
        try {
          await createNotification({
            id: inAppNotifId,
            user_id: params.userId,
            title: params.title,
            message: params.message,
            category: params.category,
            is_read: false,
            related_transaction_reference: params.relatedTransactionReference || null,
            email_sent: false,
            created_at: nowIso,
          });
          inAppCreated = true;

          // Record In-App Delivery Log
          await createNotificationDelivery({
            id: `del_inapp_${randomUUID()}`,
            notification_id: inAppNotifId,
            user_id: params.userId,
            user_email: userEmail,
            channel: 'IN_APP',
            event_type: params.eventType,
            status: 'DELIVERED',
            provider: 'internal',
            provider_message_id: null,
            attempt_count: 1,
            last_attempt_at: nowIso,
            next_retry_at: null,
            sent_at: nowIso,
            failure_reason: null,
            correlation_id: correlationId,
            deduplication_key: inAppDedupKey,
            created_at: nowIso,
            updated_at: nowIso,
          });
        } catch (inAppErr: any) {
          logger.warn(`[NotificationService] In-App notification failed: ${inAppErr.message}`, undefined, correlationId);
        }
      } else {
        logger.info(`[NotificationService] Duplicate in-app notification skipped for key: ${inAppDedupKey}`, undefined, correlationId);
      }

      // 3. Persistent Email Deduplication Check
      const emailDedupKey = `dedup_email_${params.eventType}_${params.userId}_${sourceId}`;
      const existingEmailDelivery = await getNotificationDeliveryByDeduplicationKey(emailDedupKey);

      if (existingEmailDelivery) {
        logger.info(`[NotificationService] Duplicate email notification skipped for key: ${emailDedupKey}`, undefined, correlationId);
        return {
          inAppCreated,
          emailStatus: existingEmailDelivery.status,
          deliveryId: existingEmailDelivery.id,
        };
      }

      // 4. Evaluate User Notification Preferences
      const isPreferenceAllowed = this.checkNotificationPreference(params.eventType, user?.notification_preferences);

      if (!userEmail) {
        emailStatus = 'SKIPPED';
        logger.warn(`[NotificationService] User ${params.userId} has no email. Email delivery skipped.`, undefined, correlationId);
      } else if (!isPreferenceAllowed) {
        emailStatus = 'SKIPPED';
        logger.info(`[NotificationService] Email skipped due to user preference for event: ${params.eventType}`, undefined, correlationId);
      } else {
        // Create initial QUEUED delivery record
        const emailDeliveryRecord: NotificationDeliveryDocument = {
          id: deliveryId,
          notification_id: inAppNotifId,
          user_id: params.userId,
          user_email: userEmail,
          channel: 'EMAIL',
          event_type: params.eventType,
          status: 'QUEUED',
          provider: 'resend',
          provider_message_id: null,
          attempt_count: 0,
          last_attempt_at: null,
          next_retry_at: null,
          sent_at: null,
          failure_reason: null,
          correlation_id: correlationId,
          deduplication_key: emailDedupKey,
          created_at: nowIso,
          updated_at: nowIso,
        };

        await createNotificationDelivery(emailDeliveryRecord);

        // Render Email Template
        const amountFormatted =
          params.amountKobo !== undefined && params.amountKobo !== null
            ? `₦${(params.amountKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
            : undefined;

        const rendered = renderEmailTemplate({
          eventType: params.eventType,
          recipientName: userName,
          email: userEmail,
          amountFormatted,
          reference: params.relatedTransactionReference || sourceId,
          dateIso: nowIso,
          details: params.details,
        });

        // Attempt Immediate Email Dispatch
        const sendResult = await sendTransactionalEmail({
          to: userEmail,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          correlationId,
        });

        emailStatus = sendResult.status;

        if (sendResult.success) {
          await updateNotificationDelivery(deliveryId, {
            status: 'SENT',
            provider_message_id: sendResult.providerMessageId || null,
            attempt_count: 1,
            last_attempt_at: new Date().toISOString(),
            sent_at: new Date().toISOString(),
          });
        } else if (sendResult.status === 'SKIPPED') {
          await updateNotificationDelivery(deliveryId, {
            status: 'SKIPPED',
            failure_reason: sendResult.error || 'Resend not configured',
            attempt_count: 1,
            last_attempt_at: new Date().toISOString(),
          });
        } else {
          // Failure handling: schedule retry if transient
          const nextRetry = sendResult.isTransient
            ? new Date(Date.now() + 60 * 1000).toISOString() // 1 minute retry backoff
            : null;

          await updateNotificationDelivery(deliveryId, {
            status: 'FAILED',
            failure_reason: sendResult.error || 'Email dispatch failed',
            attempt_count: 1,
            last_attempt_at: new Date().toISOString(),
            next_retry_at: nextRetry,
          });
        }
      }
    } catch (err: any) {
      logger.error(`[NotificationService] Unexpected exception in dispatchNotification: ${err.message}`, undefined, correlationId);
    }

    return {
      inAppCreated,
      emailStatus,
      deliveryId,
    };
  }

  /**
   * Checks if user notification preferences allow email for the given event type.
   * Security, KYC, and Account Status alerts ALWAYS bypass marketing preferences.
   */
  private static checkNotificationPreference(
    eventType: string,
    preferences?: { email_on_wallet_credit?: boolean; email_on_purchase?: boolean }
  ): boolean {
    if (!preferences) {
      return true; // Default allow
    }

    // Security, KYC, and Account status updates bypass optional preferences
    if (
      eventType.startsWith('KYC_') ||
      eventType.startsWith('ACCOUNT_') ||
      eventType.startsWith('SECURITY_')
    ) {
      return true;
    }

    if (eventType === 'WALLET_FUNDING_SUCCESS') {
      return preferences.email_on_wallet_credit !== false;
    }

    if (eventType.startsWith('VAS_')) {
      return preferences.email_on_purchase !== false;
    }

    return true;
  }
}
