/**
 * Alexvya Platform — Server-Authoritative Transaction & Receipt Service
 * Stage 2.10: Customer Transactions, Receipts, Wallet History & Notifications Experience
 * 
 * STRICT INVARIANTS:
 * 1. Read-only operation: Receipt generation must cause ZERO financial mutations or database writes.
 * 2. Never re-vend: Viewing an Airtime/Data/Electricity/Cable receipt never dispatches a provider call.
 * 3. Never double-credit: Viewing a funding receipt never credits a wallet or invokes Paystack verification.
 * 4. Never leak internal financials: Provider cost, expected margin, and net recognized profit are excluded.
 * 5. Multi-tenant isolation: Enforces strict user ownership verification (user_id === authenticatedUid).
 */

import { TransactionDocument, ServiceOrderDocument, BillOrderDocument, AirtimeOrderDocument, DataOrderDocument, PaymentAttemptDocument } from '../../../types/firestore.ts';
import { TransactionStatus, TransactionType, ServiceCategory } from '../../../types/enums.ts';
import { getTransactionById } from '../../repositories/transactions.repository.ts';
import { getServiceOrderById, getAirtimeOrder, getDataOrder, getBillOrder } from '../../repositories/serviceOrders.repository.ts';
import { getPaymentAttemptByTransactionId } from '../../repositories/paymentAttempts.repository.ts';
import { getUserById } from '../../repositories/users.repository.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';

export interface CustomerReceiptResponse {
  transaction_id: string;
  transaction_reference: string;
  transaction_type: TransactionType;
  service_category: ServiceCategory | null;
  status: TransactionStatus;
  created_at: string;
  settled_at: string | null;
  customer_display: {
    uid: string;
    name: string | null;
    email: string | null;
  };
  financial_summary: {
    face_value_kobo: number;
    amount_charged_kobo: number;
    discount_kobo: number;
    service_fee_kobo: number;
    refund_amount_kobo: number | null;
    reversal_amount_kobo: number | null;
  };
  fulfillment: {
    recipient_identifier: string | null;
    product_name: string | null;
    service_specific: Record<string, unknown>;
  };
  lifecycle: {
    is_terminal: boolean;
    is_successful: boolean;
    is_refunded: boolean;
    is_reversed: boolean;
    is_unresolved: boolean;
    status_headline: string;
    status_explanation: string;
  };
}

export class ReceiptService {
  /**
   * Generates a server-authoritative, customer-safe receipt for a transaction.
   * Read-only. Never mutates database or dispatches external provider calls.
   */
  public static async generateReceipt(
    transactionId: string,
    authenticatedUserId: string,
    userRole: string = 'CUSTOMER',
    correlationId?: string
  ): Promise<CustomerReceiptResponse> {
    if (!transactionId || transactionId.trim().length === 0) {
      throw new AlexvyaApiError(ErrorCodes.INVALID_INPUT, 'Transaction ID is required.', 400, { correlation_id: correlationId });
    }

    const tx = await getTransactionById(transactionId.trim());
    if (!tx) {
      throw new AlexvyaApiError(ErrorCodes.TRANSACTION_NOT_FOUND, `Transaction '${transactionId}' not found.`, 404, { correlation_id: correlationId });
    }

    // Multi-tenant isolation: Customer can only access their own transaction
    const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
    if (tx.user_id !== authenticatedUserId && !isAdmin) {
      throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, 'Access to transaction receipt is forbidden.', 403, { correlation_id: correlationId });
    }

    // Fetch customer details for display
    const user = await getUserById(tx.user_id);
    const customerName = user
      ? user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || null
      : null;
    const customerEmail = user?.email || null;

    // Financial economics extraction (Never exposing internal provider cost or profit margin!)
    const faceValue = tx.amount_kobo;
    const chargedAmount = tx.total_charged_kobo ?? tx.amount_kobo;
    const discountKobo = tx.discount_kobo ?? tx.original_economics?.discount_kobo ?? 0;
    const serviceFeeKobo = tx.fee_kobo ?? 0;
    const refundAmountKobo = tx.settlement_economics?.refund_amount_kobo ?? (tx.status === TransactionStatus.REFUNDED ? tx.amount_kobo : null);
    const reversalAmountKobo = tx.settlement_economics?.reversal_amount_kobo ?? (tx.status === TransactionStatus.REVERSED ? tx.amount_kobo : null);

    // Associated sub-order and fulfillment details
    let recipientIdentifier: string | null = (tx.service_details?.recipient as string) || (tx.service_details?.phone_number as string) || null;
    let productName: string | null = (tx.service_details?.product_name as string) || (tx.service_details?.description as string) || null;
    const serviceSpecific: Record<string, unknown> = {};

    const serviceOrder = await getServiceOrderById(tx.id);
    if (serviceOrder) {
      if (!recipientIdentifier) recipientIdentifier = serviceOrder.recipient_identifier;
      if (!productName) productName = serviceOrder.product_name_snapshot;
    }

    const serviceCategory: ServiceCategory | null = (
      serviceOrder?.service_category ||
      (tx.service_details?.category as ServiceCategory) ||
      (tx.service_details?.service_category as ServiceCategory) ||
      null
    );

    // Service-specific data assembly
    if (tx.type === TransactionType.WALLET_FUNDING) {
      const paymentAttempt = await getPaymentAttemptByTransactionId(tx.id);
      serviceSpecific.gateway = 'PAYSTACK';
      serviceSpecific.funding_amount_kobo = tx.amount_kobo;
      serviceSpecific.gateway_reference = paymentAttempt?.gateway_reference || tx.reference;
      serviceSpecific.channel = paymentAttempt?.channel || 'CARD';
      serviceSpecific.settled_at = paymentAttempt?.verified_at || tx.completed_at || null;
    } else if (serviceCategory === ServiceCategory.AIRTIME) {
      const airtime = await getAirtimeOrder(tx.id);
      serviceSpecific.network = airtime?.network || tx.service_details?.network || null;
      serviceSpecific.phone_number = airtime?.phone_number || recipientIdentifier;
      serviceSpecific.airtime_type = airtime?.airtime_type || 'VTU';
      serviceSpecific.operator_reference = airtime?.operator_reference || tx.provider_reference || null;
    } else if (serviceCategory === ServiceCategory.DATA) {
      const data = await getDataOrder(tx.id);
      serviceSpecific.network = data?.network || tx.service_details?.network || null;
      serviceSpecific.phone_number = data?.phone_number || recipientIdentifier;
      serviceSpecific.data_volume_mb = data?.data_volume_mb || tx.service_details?.volume_mb || null;
      serviceSpecific.validity_days = data?.validity_days || tx.service_details?.validity_days || null;
      serviceSpecific.bundle_name = productName;
    } else if (serviceCategory === ServiceCategory.ELECTRICITY) {
      const bill = await getBillOrder(tx.id);
      // AUTHORITATIVE TOKEN EXTRACTION: Strictly from stored bill order or transaction fulfillment
      const token = bill?.sts_token || (tx.service_details?.token as string) || null;
      const units = bill?.token_units || (tx.service_details?.units as string) || null;
      const receiptNumber = bill?.receipt_number || (tx.service_details?.receipt as string) || null;
      const customerMeterName = bill?.customer_name || (tx.service_details?.customer_name as string) || null;
      const customerAddress = bill?.customer_address || (tx.service_details?.customer_address as string) || null;
      const meterType = bill?.meter_type || (tx.service_details?.meter_type as string) || 'PREPAID';

      serviceSpecific.disco = bill?.provider_code || tx.service_details?.disco || 'ELECTRICITY';
      serviceSpecific.meter_number = bill?.customer_identifier || recipientIdentifier;
      serviceSpecific.meter_type = meterType;
      serviceSpecific.customer_name = customerMeterName;
      serviceSpecific.customer_address = customerAddress;
      serviceSpecific.token = token;
      serviceSpecific.token_type = token ? 'STS' : null;
      serviceSpecific.units = units;
      serviceSpecific.receipt_number = receiptNumber;
      serviceSpecific.token_metadata = {
        token_available: Boolean(token && token.trim().length > 0),
        generated_at: tx.completed_at || tx.created_at,
      };
    } else if (serviceCategory === ServiceCategory.CABLE_TV) {
      const bill = await getBillOrder(tx.id);
      serviceSpecific.operator = bill?.provider_code || tx.service_details?.operator || 'CABLE_TV';
      serviceSpecific.smartcard_number = bill?.customer_identifier || recipientIdentifier;
      serviceSpecific.customer_name = bill?.customer_name || (tx.service_details?.customer_name as string) || null;
      serviceSpecific.bouquet = bill?.cable_package_name || productName;
      serviceSpecific.subscription_reference = bill?.receipt_number || tx.provider_reference || null;
    }

    // Normalized lifecycle status presentation
    const isTerminal = (
      tx.status === TransactionStatus.SUCCESSFUL ||
      tx.status === TransactionStatus.FAILED ||
      tx.status === TransactionStatus.REFUNDED ||
      tx.status === TransactionStatus.REVERSED
    );

    const isSuccessful = tx.status === TransactionStatus.SUCCESSFUL;
    const isRefunded = tx.status === TransactionStatus.REFUNDED;
    const isReversed = tx.status === TransactionStatus.REVERSED;
    const isUnresolved = (
      tx.status === TransactionStatus.UNKNOWN ||
      tx.status === TransactionStatus.PROCESSING ||
      tx.status === TransactionStatus.PENDING ||
      tx.status === TransactionStatus.INITIATED
    );

    let statusHeadline = 'Transaction Completed';
    let statusExplanation = 'This transaction completed successfully.';

    switch (tx.status) {
      case TransactionStatus.SUCCESSFUL:
        statusHeadline = 'Payment & Service Delivered';
        statusExplanation = 'Your purchase has been fulfilled and confirmed by the service provider.';
        break;
      case TransactionStatus.PENDING:
      case TransactionStatus.PROCESSING:
        statusHeadline = 'Fulfillment In Progress';
        statusExplanation = 'Your payment was debited and fulfillment is currently processing with the provider. Please do not re-attempt.';
        break;
      case TransactionStatus.UNKNOWN:
        statusHeadline = 'Verification In Progress';
        statusExplanation = "We're confirming this transaction with the provider. Do not repeat the purchase; our background system is resolving status automatically.";
        break;
      case TransactionStatus.FAILED:
        statusHeadline = 'Transaction Failed';
        statusExplanation = tx.failure_reason || 'The transaction could not be completed by the provider.';
        break;
      case TransactionStatus.REFUNDED:
        statusHeadline = 'Fulfillment Failed — Fully Refunded';
        statusExplanation = `The service provider could not fulfill this request. Your wallet has been automatically refunded with ₦${((refundAmountKobo || tx.amount_kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`;
        break;
      case TransactionStatus.REVERSED:
        statusHeadline = 'Transaction Administratively Reversed';
        statusExplanation = `This transaction was reversed and funds restored to your wallet on ${tx.completed_at || tx.created_at}.`;
        break;
    }

    return {
      transaction_id: tx.id,
      transaction_reference: tx.reference,
      transaction_type: tx.type,
      service_category: serviceCategory,
      status: tx.status,
      created_at: tx.created_at,
      settled_at: tx.completed_at || null,
      customer_display: {
        uid: tx.user_id,
        name: customerName,
        email: customerEmail,
      },
      financial_summary: {
        face_value_kobo: faceValue,
        amount_charged_kobo: chargedAmount,
        discount_kobo: discountKobo,
        service_fee_kobo: serviceFeeKobo,
        refund_amount_kobo: refundAmountKobo,
        reversal_amount_kobo: reversalAmountKobo,
      },
      fulfillment: {
        recipient_identifier: recipientIdentifier,
        product_name: productName,
        service_specific: serviceSpecific,
      },
      lifecycle: {
        is_terminal: isTerminal,
        is_successful: isSuccessful,
        is_refunded: isRefunded,
        is_reversed: isReversed,
        is_unresolved: isUnresolved,
        status_headline: statusHeadline,
        status_explanation: statusExplanation,
      },
    };
  }
}
