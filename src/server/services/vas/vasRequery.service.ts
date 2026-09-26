/**
 * Alexvya Platform — VAS Status Requery & Automated Reconciliation Engine
 * Stage 2.7 V1 VAS Service Purchase Engine
 * 
 * Requery Schedule (Locked Stage 1.4/1.5):
 * T+30s, T+90s, T+150s, T+210s, T+270s, T+300s (5-minute terminal window)
 * 
 * CORE INVARIANTS:
 * 1. An UNKNOWN or pending provider response does NOT automatically trigger a refund or second order!
 * 2. ONLY confirmed non-delivery triggers an atomic refund.
 * 3. A failed VAS order must NEVER receive two refunds (permanent deduplication tied to parent transaction).
 * 4. Profit is recognized ONLY upon confirmed SUCCESS, and is NEVER recognized on FAILED/UNKNOWN.
 */

import { randomUUID } from 'crypto';
import {
  getServiceOrderById,
  updateServiceOrder,
  getAirtimeOrder,
  getDataOrder,
  getBillOrder,
  updateBillOrder,
} from '../../repositories/serviceOrders.repository.ts';
import {
  getTransactionById,
  updateTransaction,
} from '../../repositories/transactions.repository.ts';
import {
  queryProviderTransactionsByOrder,
  createProviderTransaction,
  updateProviderTransaction,
} from '../../repositories/providerTransactions.repository.ts';
import { createAuditLog } from '../../repositories/auditLogs.repository.ts';
import { createNotification } from '../../repositories/notifications.repository.ts';
import { refundWallet } from '../../wallet/mutation.service.ts';
import { ProviderRouterService } from './providerRouter.service.ts';
import {
  TransactionStatus,
  ServiceOrderStatus,
  ProviderNormalizedStatus,
  LedgerCategory,
  AuditAction,
  NotificationCategory,
  ProviderId,
  ServiceCategory,
} from '../../../types/enums.ts';
import { IntegerKobo } from '../../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';
import { logger } from '../../../lib/logger/logger.ts';

export const REQUERY_INTERVALS_SECONDS = [30, 90, 150, 210, 270, 300] as const;

class OrderMutex {
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
}

const requeryMutex = new OrderMutex();

export interface RequeryResult {
  orderId: string;
  transactionReference: string;
  previousStatus: TransactionStatus;
  currentStatus: TransactionStatus;
  providerStatus: ProviderNormalizedStatus;
  refunded: boolean;
  refundAmountKobo: IntegerKobo;
  alreadySettled: boolean;
  message: string;
}

export class VasRequeryService {
  /**
   * Requeries provider status for a pending or unknown service order.
   * Serialized per order ID to prevent concurrent refund or mutation races.
   */
  public static async requeryOrder(orderId: string, correlationId?: string): Promise<RequeryResult> {
    return requeryMutex.runExclusive(orderId, async () => {
      const order = await getServiceOrderById(orderId);
      if (!order) {
        throw new AlexvyaApiError(
          ErrorCodes.ORDER_NOT_FOUND,
          `Service order '${orderId}' not found.`,
          404,
          { orderId }
        );
      }

      const transaction = await getTransactionById(order.id);
      if (!transaction) {
        throw new AlexvyaApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          `Transaction for order '${orderId}' not found.`,
          404,
          { orderId }
        );
      }

      // If already finalized to SUCCESSFUL or REFUNDED, return cached settled state
      if (
        transaction.status === TransactionStatus.SUCCESSFUL ||
        transaction.status === TransactionStatus.REFUNDED
      ) {
        logger.info(`[VasRequeryService] Order ${orderId} already in terminal state '${transaction.status}'`);
        return {
          orderId,
          transactionReference: transaction.reference,
          previousStatus: transaction.status,
          currentStatus: transaction.status,
          providerStatus: transaction.status === TransactionStatus.SUCCESSFUL ? ProviderNormalizedStatus.SUCCESS : ProviderNormalizedStatus.FAILED,
          refunded: transaction.status === TransactionStatus.REFUNDED,
          refundAmountKobo: (transaction.settlement_economics?.refund_amount_kobo || 0) as IntegerKobo,
          alreadySettled: true,
          message: `Order is already finalized in state ${transaction.status}.`,
        };
      }

      // Authoritative requery via provider adapter
      const providerId = (order.active_provider || ProviderId.VTPASS) as ProviderId;
      const providerAdapter = ProviderRouterService.getProviderAdapter(providerId);

      // Find provider reference
      const providerTxs = await queryProviderTransactionsByOrder(orderId);
      const latestProviderTx = providerTxs.length > 0 ? providerTxs[providerTxs.length - 1] : null;
      const providerReference = latestProviderTx?.provider_reference || undefined;

      const providerResult = await providerAdapter.requeryStatus(orderId, providerReference);

      // Record audit event for requery
      await createAuditLog({
        id: randomUUID(),
        actor_id: 'system_requery_worker',
        actor_role: 'SYSTEM',
        action: AuditAction.VAS_REQUERY,
        target_collection: 'serviceOrders',
        target_id: orderId,
        before_state: { previous_status: transaction.status },
        after_state: { provider_status: providerResult.normalizedStatus },
        reason: `Requeried provider ${providerId} for order ${orderId}. Result: ${providerResult.normalizedStatus}`,
        correlation_id: correlationId || `cor_${Date.now()}`,
        ip_address: null,
        created_at: new Date().toISOString(),
      });

      // Update provider transaction
      if (latestProviderTx) {
        await updateProviderTransaction(latestProviderTx.id, {
          response_code: providerResult.responseCode,
          response_payload_safe: providerResult.rawResponse,
          normalized_status: providerResult.normalizedStatus,
          completed_at: new Date().toISOString(),
        });
      }

      const now = new Date().toISOString();

      // ======================================================================
      // OUTCOME 1: SUCCESS CONFIRMED BY PROVIDER
      // ======================================================================
      if (providerResult.normalizedStatus === ProviderNormalizedStatus.SUCCESS) {
        // Update service order to SUCCESSFUL
        await updateServiceOrder(orderId, {
          status: ServiceOrderStatus.SUCCESSFUL,
        });

        // Update sub-order details if electricity or bill
        if (order.service_category === ServiceCategory.ELECTRICITY && providerResult.token) {
          await updateBillOrder(orderId, {
            sts_token: providerResult.token,
            token_units: providerResult.units || null,
            receipt_number: providerResult.receiptNumber || null,
          });
        }

        // Recognize expected gross profit authoritatively
        const recognizedProfitKobo = transaction.original_economics
          ? transaction.original_economics.expected_gross_profit_kobo
          : (transaction.gross_profit_kobo || (0 as IntegerKobo));

        await updateTransaction(transaction.id, {
          status: TransactionStatus.SUCCESSFUL,
          gross_profit_kobo: recognizedProfitKobo,
          provider_reference: providerResult.providerReference || transaction.provider_reference,
          completed_at: now,
        });

        await ProviderRouterService.recordProviderSuccess(providerId, providerResult.latencyMs || 50);

        // Customer notification
        try {
          await createNotification({
            id: randomUUID(),
            user_id: transaction.user_id,
            title: `${order.service_category} Recharge Successful`,
            message: `Your ${order.service_category} purchase of ₦${(order.amount_debited_kobo / 100).toFixed(2)} has been successfully fulfilled.`,
            category: NotificationCategory.SERVICE_DELIVERY,
            is_read: false,
            related_transaction_reference: transaction.reference,
            email_sent: false,
            created_at: new Date().toISOString(),
          });
        } catch (notifErr: any) {
          logger.warn(`[VasRequeryService] Notification delivery failed for ${transaction.user_id}: ${notifErr.message}`);
        }

        return {
          orderId,
          transactionReference: transaction.reference,
          previousStatus: transaction.status,
          currentStatus: TransactionStatus.SUCCESSFUL,
          providerStatus: ProviderNormalizedStatus.SUCCESS,
          refunded: false,
          refundAmountKobo: 0 as IntegerKobo,
          alreadySettled: false,
          message: 'Order fulfillment confirmed successful.',
        };
      }

      // ======================================================================
      // OUTCOME 2: CONFIRMED FAILURE / NON-DELIVERY
      // ======================================================================
      if (providerResult.normalizedStatus === ProviderNormalizedStatus.FAILED) {
        // Update service order to FAILED
        await updateServiceOrder(orderId, {
          status: ServiceOrderStatus.FAILED,
        });

        // Atomic refund via refundWallet()
        const refundAmountKobo = order.amount_debited_kobo;
        const refundResult = await refundWallet({
          userId: transaction.user_id,
          amountKobo: refundAmountKobo,
          originalTransactionId: transaction.id,
          originalTransactionReference: transaction.reference,
          category: LedgerCategory.REFUND,
          description: `Refund for failed ${order.service_category} order: ${orderId}`,
          idempotencyKey: `refund_${orderId}`,
          actor: { type: 'SYSTEM', id: 'system_requery_worker' },
          correlationId,
        });

        // Update transaction to REFUNDED with settlement economics (zero profit)
        await updateTransaction(transaction.id, {
          status: TransactionStatus.REFUNDED,
          gross_profit_kobo: 0 as IntegerKobo,
          failure_reason: providerResult.errorMessage || 'Confirmed non-delivery by operator',
          settlement_economics: {
            refund_amount_kobo: refundAmountKobo,
            reversal_amount_kobo: 0 as IntegerKobo,
            net_recognized_profit_kobo: 0 as IntegerKobo,
            settled_at: now,
          },
          completed_at: now,
        });

        await ProviderRouterService.recordProviderFailure(providerId);

        // Customer notification
        try {
          await createNotification({
            id: randomUUID(),
            user_id: transaction.user_id,
            title: `${order.service_category} Failed - Refund Processed`,
            message: `Your ${order.service_category} order could not be completed. ₦${(refundAmountKobo / 100).toFixed(2)} has been refunded to your wallet.`,
            category: NotificationCategory.FINANCIAL,
            is_read: false,
            related_transaction_reference: transaction.reference,
            email_sent: false,
            created_at: new Date().toISOString(),
          });
        } catch (notifErr: any) {
          logger.warn(`[VasRequeryService] Notification delivery failed for ${transaction.user_id}: ${notifErr.message}`);
        }

        return {
          orderId,
          transactionReference: transaction.reference,
          previousStatus: transaction.status,
          currentStatus: TransactionStatus.REFUNDED,
          providerStatus: ProviderNormalizedStatus.FAILED,
          refunded: true,
          refundAmountKobo,
          alreadySettled: false,
          message: 'Order failed at provider. Full refund issued to wallet.',
        };
      }

      // ======================================================================
      // OUTCOME 3: UNKNOWN / STILL PROCESSING
      // ======================================================================
      // CRITICAL: DO NOT REFUND! DO NOT SWITCH PROVIDERS!
      await updateServiceOrder(orderId, {
        status: ServiceOrderStatus.PROCESSING,
        retry_count: (order.retry_count || 0) + 1,
      });

      await updateTransaction(transaction.id, {
        status: TransactionStatus.UNKNOWN,
      });

      return {
        orderId,
        transactionReference: transaction.reference,
        previousStatus: transaction.status,
        currentStatus: TransactionStatus.UNKNOWN,
        providerStatus: ProviderNormalizedStatus.UNKNOWN,
        refunded: false,
        refundAmountKobo: 0 as IntegerKobo,
        alreadySettled: false,
        message: 'Order outcome remains pending/unknown with operator. Scheduled for subsequent requery.',
      };
    });
  }
}
