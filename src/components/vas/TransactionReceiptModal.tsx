/**
 * Alexvya Platform — Customer Transaction Receipt Modal
 * Stage 2.10: Customer Transactions, Receipts & Notifications
 * 
 * Mobile-first, print-friendly dialog displaying server-authoritative receipt data.
 * Zero client mutations: strictly reads receipt from backend API.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Printer,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Zap,
  Smartphone,
  Wifi,
  Tv,
  CreditCard,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../../lib/api/apiClient.ts';
import { formatKoboAsNaira, formatDate } from './formatters.ts';

export interface ReceiptData {
  transaction_id: string;
  transaction_reference: string;
  transaction_type: string;
  service_category: string | null;
  status: string;
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
    service_specific: Record<string, any>;
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

interface TransactionReceiptModalProps {
  transactionId: string;
  onClose: () => void;
}

export function TransactionReceiptModal({ transactionId, onClose }: TransactionReceiptModalProps) {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const fetchReceipt = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      // If customer explicitly requests a refresh and receipt is unresolved, attempt safe server requery first
      if (isRefresh && receipt?.lifecycle?.is_unresolved && receipt?.service_category) {
        try {
          await apiFetch(`/api/v1/services/orders/${transactionId}/requery`, {
            method: 'POST',
          });
        } catch {
          // Non-blocking fallback to standard receipt fetch
        }
      }

      const res = await apiFetch<{ data: ReceiptData }>(`/api/v1/transactions/${transactionId}/receipt`);
      if (res.data) {
        setReceipt(res.data);
      } else {
        throw new Error('Failed to load transaction receipt.');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve receipt. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReceipt();
  }, [transactionId]);

  const copyToClipboard = (text: string, type: 'ref' | 'token') => {
    navigator.clipboard.writeText(text);
    if (type === 'ref') {
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } else {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const getCategoryIcon = (category: string | null, type: string) => {
    if (type === 'WALLET_FUNDING') return <CreditCard className="w-5 h-5 text-emerald-400" />;
    switch (category) {
      case 'AIRTIME':
        return <Smartphone className="w-5 h-5 text-emerald-400" />;
      case 'DATA':
        return <Wifi className="w-5 h-5 text-cyan-400" />;
      case 'ELECTRICITY':
        return <Zap className="w-5 h-5 text-amber-400" />;
      case 'CABLE_TV':
        return <Tv className="w-5 h-5 text-purple-400" />;
      default:
        return <CreditCard className="w-5 h-5 text-slate-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SUCCESSFUL':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            SUCCESSFUL
          </span>
        );
      case 'PENDING':
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
            {status}
          </span>
        );
      case 'UNKNOWN':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5" />
            VERIFYING
          </span>
        );
      case 'REFUNDED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <RotateCcw className="w-3.5 h-3.5" />
            REFUNDED
          </span>
        );
      case 'REVERSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <RotateCcw className="w-3.5 h-3.5" />
            REVERSED
          </span>
        );
      case 'FAILED':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5" />
            FAILED
          </span>
        );
    }
  };

  const electricityToken = receipt?.fulfillment.service_specific?.token as string | undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto"
    >
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header / Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60 print:hidden">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span id="receipt-title" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Transaction Receipt
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchReceipt(true)}
              disabled={refreshing || loading}
              title="Refresh status from server"
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition disabled:opacity-50"
              aria-label="Refresh transaction status"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
            <button
              onClick={handlePrint}
              disabled={loading || !receipt}
              title="Print Receipt"
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition disabled:opacity-50"
              aria-label="Print receipt"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
              aria-label="Close receipt"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 print:p-0 print:space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
              <p className="text-xs font-mono text-slate-400">Generating authoritative receipt...</p>
            </div>
          ) : error ? (
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">Receipt Unavailable</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">{error}</p>
              <button
                onClick={() => fetchReceipt(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
              >
                Retry Request
              </button>
            </div>
          ) : receipt ? (
            <>
              {/* Receipt Brand Banner */}
              <div className="text-center space-y-2 border-b border-slate-800/80 pb-5">
                <div className="inline-flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-black text-slate-950 text-base shadow">
                    S
                  </div>
                  <span className="font-extrabold text-xl text-white tracking-tight">Supreme</span>
                  <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 bg-slate-800 text-emerald-400 rounded border border-slate-700">Digital Network</span>
                </div>
                <p className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Official Payment & Service Receipt</p>
                
                {/* Total Amount Headline */}
                <div className="pt-2">
                  <div className="text-3xl font-black text-white font-mono tracking-tight">
                    {formatKoboAsNaira(receipt.financial_summary.amount_charged_kobo)}
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-2">
                    {getStatusBadge(receipt.status)}
                  </div>
                </div>
              </div>

              {/* Status Explanation Alert */}
              {receipt.lifecycle.is_unresolved ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-300">{receipt.lifecycle.status_headline}</p>
                    <p className="text-xs text-amber-200/80 leading-relaxed">{receipt.lifecycle.status_explanation}</p>
                  </div>
                </div>
              ) : receipt.lifecycle.is_refunded ? (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-4 flex items-start gap-3">
                  <RotateCcw className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-blue-300">{receipt.lifecycle.status_headline}</p>
                    <p className="text-xs text-blue-200/80 leading-relaxed">{receipt.lifecycle.status_explanation}</p>
                  </div>
                </div>
              ) : null}

              {/* Electricity STS Token Banner (When applicable) */}
              {receipt.service_category === 'ELECTRICITY' && receipt.lifecycle.is_successful && (
                <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 uppercase tracking-wider">
                      <Zap className="w-4 h-4" /> Prepaid Token (STS)
                    </span>
                    {electricityToken && (
                      <button
                        onClick={() => copyToClipboard(electricityToken, 'token')}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:text-white bg-amber-500/20 hover:bg-amber-500/30 px-2 py-0.5 rounded-md transition"
                      >
                        {copiedToken ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedToken ? 'Copied!' : 'Copy Token'}
                      </button>
                    )}
                  </div>
                  {electricityToken ? (
                    <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-3 text-center">
                      <span className="font-mono text-xl sm:text-2xl font-black text-amber-300 tracking-widest select-all">
                        {electricityToken}
                      </span>
                      {receipt.fulfillment.service_specific?.units && (
                        <p className="text-xs text-slate-400 mt-1 font-mono">
                          Units: <strong className="text-white">{receipt.fulfillment.service_specific.units}</strong>
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">
                      Token details are temporarily unavailable. Please refresh or contact support with reference {receipt.transaction_reference}.
                    </p>
                  )}
                </div>
              )}

              {/* Transaction Key Details */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Reference:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-white font-bold">{receipt.transaction_reference}</span>
                    <button
                      onClick={() => copyToClipboard(receipt.transaction_reference, 'ref')}
                      className="text-slate-400 hover:text-white transition p-1"
                      title="Copy transaction reference"
                    >
                      {copiedRef ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Service:</span>
                  <div className="flex items-center gap-1.5 font-medium text-white">
                    {getCategoryIcon(receipt.service_category, receipt.transaction_type)}
                    <span>{receipt.fulfillment.product_name || receipt.service_category || receipt.transaction_type}</span>
                  </div>
                </div>

                {receipt.fulfillment.recipient_identifier && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Recipient / Identifier:</span>
                    <span className="font-mono text-white font-semibold">{receipt.fulfillment.recipient_identifier}</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Date & Time:</span>
                  <span className="text-slate-200">{formatDate(receipt.created_at)}</span>
                </div>

                {receipt.settled_at && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Settled At:</span>
                    <span className="text-slate-200">{formatDate(receipt.settled_at)}</span>
                  </div>
                )}
              </div>

              {/* Service Specific Section */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Fulfillment Details</h4>
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-2.5 text-xs">
                  {receipt.service_category === 'AIRTIME' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Network:</span>
                        <span className="text-white font-semibold">{receipt.fulfillment.service_specific.network}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Phone Number:</span>
                        <span className="font-mono text-white">{receipt.fulfillment.service_specific.phone_number}</span>
                      </div>
                      {receipt.fulfillment.service_specific.operator_reference && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Operator Ref:</span>
                          <span className="font-mono text-slate-300">{receipt.fulfillment.service_specific.operator_reference}</span>
                        </div>
                      )}
                    </>
                  )}

                  {receipt.service_category === 'DATA' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Network:</span>
                        <span className="text-white font-semibold">{receipt.fulfillment.service_specific.network}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Plan:</span>
                        <span className="text-white font-semibold">{receipt.fulfillment.service_specific.bundle_name}</span>
                      </div>
                      {receipt.fulfillment.service_specific.validity_days && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Validity:</span>
                          <span className="text-slate-200">{receipt.fulfillment.service_specific.validity_days} Days</span>
                        </div>
                      )}
                    </>
                  )}

                  {receipt.service_category === 'ELECTRICITY' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">DISCO:</span>
                        <span className="text-white font-semibold">{receipt.fulfillment.service_specific.disco}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Meter Number:</span>
                        <span className="font-mono text-white">{receipt.fulfillment.service_specific.meter_number}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Meter Type:</span>
                        <span className="text-slate-200">{receipt.fulfillment.service_specific.meter_type}</span>
                      </div>
                      {receipt.fulfillment.service_specific.customer_name && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Customer Name:</span>
                          <span className="text-white font-semibold">{receipt.fulfillment.service_specific.customer_name}</span>
                        </div>
                      )}
                      {receipt.fulfillment.service_specific.receipt_number && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">DISCO Receipt #:</span>
                          <span className="font-mono text-slate-300">{receipt.fulfillment.service_specific.receipt_number}</span>
                        </div>
                      )}
                    </>
                  )}

                  {receipt.service_category === 'CABLE_TV' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Operator:</span>
                        <span className="text-white font-semibold">{receipt.fulfillment.service_specific.operator}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Smartcard / IUC:</span>
                        <span className="font-mono text-white">{receipt.fulfillment.service_specific.smartcard_number}</span>
                      </div>
                      {receipt.fulfillment.service_specific.customer_name && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Subscriber:</span>
                          <span className="text-white font-semibold">{receipt.fulfillment.service_specific.customer_name}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-400">Bouquet Package:</span>
                        <span className="text-white font-semibold">{receipt.fulfillment.service_specific.bouquet}</span>
                      </div>
                    </>
                  )}

                  {receipt.transaction_type === 'WALLET_FUNDING' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Gateway:</span>
                        <span className="text-white font-bold">{receipt.fulfillment.service_specific.gateway}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Gateway Reference:</span>
                        <span className="font-mono text-slate-300">{receipt.fulfillment.service_specific.gateway_reference}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Payment Channel:</span>
                        <span className="text-slate-200">{receipt.fulfillment.service_specific.channel}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Financial Breakdown (Customer-safe) */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Payment Breakdown</h4>
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Face Value:</span>
                    <span className="text-slate-200 font-mono">{formatKoboAsNaira(receipt.financial_summary.face_value_kobo)}</span>
                  </div>

                  {receipt.financial_summary.discount_kobo > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>Discount Saved:</span>
                      <span className="font-mono">- {formatKoboAsNaira(receipt.financial_summary.discount_kobo)}</span>
                    </div>
                  )}

                  {receipt.financial_summary.service_fee_kobo > 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>Service Fee:</span>
                      <span className="font-mono">+ {formatKoboAsNaira(receipt.financial_summary.service_fee_kobo)}</span>
                    </div>
                  )}

                  <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-white">
                    <span>Total Charged:</span>
                    <span className="font-mono text-emerald-400">{formatKoboAsNaira(receipt.financial_summary.amount_charged_kobo)}</span>
                  </div>

                  {receipt.financial_summary.refund_amount_kobo !== null && receipt.financial_summary.refund_amount_kobo > 0 && (
                    <div className="border-t border-slate-800/60 pt-2 flex justify-between font-bold text-blue-400">
                      <span>Amount Refunded:</span>
                      <span className="font-mono">{formatKoboAsNaira(receipt.financial_summary.refund_amount_kobo)}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3 print:hidden">
          <p className="text-[10px] text-slate-500 font-mono">
            Immutable Audit Certified • Supreme Digital Network Core
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
