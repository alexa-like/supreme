/**
 * Alexvya Platform — Customer Transaction History List
 * Stage 2.10: Customer Transactions, Receipts & Notifications
 * 
 * Mobile-first transaction history viewer with filtering, status presentation,
 * cursor pagination, and receipt inspection.
 */

import React, { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  XCircle,
  Receipt,
  Smartphone,
  Wifi,
  Zap,
  Tv,
  CreditCard,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import { apiFetch } from '../../lib/api/apiClient.ts';
import { TransactionReceiptModal } from './TransactionReceiptModal.tsx';
import { formatKoboAsNaira, formatDate } from './formatters.ts';

interface TransactionSummary {
  id: string;
  reference: string;
  type: string;
  category: string | null;
  amount_kobo: number;
  charged_amount_kobo: number;
  discount_kobo: number;
  service_fee_kobo: number;
  refund_amount_kobo: number | null;
  status: string;
  recipient_identifier: string | null;
  product_name: string | null;
  description: string | null;
  created_at: string;
  settled_at: string | null;
}

interface TransactionsApiResponse {
  items: TransactionSummary[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export function CustomerTransactions() {
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Selected Transaction for Receipt Modal
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  const fetchTransactions = async (cursor?: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append('limit', '15');
      if (cursor) params.append('cursor', cursor);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (typeFilter !== 'ALL') params.append('type', typeFilter);

      const res = await apiFetch<{ data: TransactionsApiResponse }>(`/api/v1/transactions?${params.toString()}`);
      if (res.data) {
        if (append) {
          setTransactions((prev) => [...prev, ...res.data.items]);
        } else {
          setTransactions(res.data.items);
        }
        setNextCursor(res.data.nextCursor);
        setHasMore(res.data.hasMore);
      }
    } catch (err: any) {
      setError(err.message || 'Unable to load transaction history.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [statusFilter, typeFilter]);

  const getServiceIcon = (category: string | null, type: string) => {
    if (type === 'WALLET_FUNDING') {
      return (
        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
          <ArrowDownLeft className="w-4 h-4" />
        </div>
      );
    }
    switch (category) {
      case 'AIRTIME':
        return (
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4" />
          </div>
        );
      case 'DATA':
        return (
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
            <Wifi className="w-4 h-4" />
          </div>
        );
      case 'ELECTRICITY':
        return (
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4" />
          </div>
        );
      case 'CABLE_TV':
        return (
          <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
            <Tv className="w-4 h-4" />
          </div>
        );
      default:
        return (
          <div className="w-9 h-9 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center shrink-0">
            <CreditCard className="w-4 h-4" />
          </div>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SUCCESSFUL':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            SUCCESSFUL
          </span>
        );
      case 'PENDING':
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3 h-3 animate-pulse" />
            {status}
          </span>
        );
      case 'UNKNOWN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            VERIFYING
          </span>
        );
      case 'REFUNDED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <RotateCcw className="w-3 h-3" />
            REFUNDED
          </span>
        );
      case 'REVERSED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <RotateCcw className="w-3 h-3" />
            REVERSED
          </span>
        );
      case 'FAILED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3 h-3" />
            FAILED
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-400" />
            Transaction History
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Authoritative records of your payments, subscriptions, and receipts.
          </p>
        </div>
        <button
          onClick={() => fetchTransactions()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition w-fit"
          aria-label="Refresh transaction list"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Filter className="w-3.5 h-3.5" />
          <span className="font-semibold uppercase tracking-wider text-[10px]">Filter:</span>
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          aria-label="Filter by status"
        >
          <option value="ALL">All Statuses</option>
          <option value="SUCCESSFUL">Successful</option>
          <option value="PENDING">Pending / Processing</option>
          <option value="UNKNOWN">Verifying (Unknown)</option>
          <option value="REFUNDED">Refunded</option>
          <option value="REVERSED">Reversed</option>
          <option value="FAILED">Failed</option>
        </select>

        {/* Type Filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          aria-label="Filter by transaction type"
        >
          <option value="ALL">All Types</option>
          <option value="VAS_PURCHASE">VAS Purchases</option>
          <option value="WALLET_FUNDING">Wallet Funding</option>
        </select>
      </div>

      {/* Transactions Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        {loading && transactions.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
            <p className="text-xs font-mono text-slate-400">Loading your transactions...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3 px-4">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
            <p className="text-sm font-bold text-white">Failed to load transactions</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">{error}</p>
            <button
              onClick={() => fetchTransactions()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
            >
              Try Again
            </button>
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-20 text-center space-y-3 px-4">
            <Receipt className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-white">No transactions yet</h3>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Your purchases and funding activity will appear here with detailed receipts.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                onClick={() => setSelectedTxId(tx.id)}
                className="p-4 sm:px-6 hover:bg-slate-800/40 transition flex items-center justify-between gap-4 cursor-pointer group"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedTxId(tx.id)}
                aria-label={`View receipt for transaction ${tx.reference}`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  {getServiceIcon(tx.category, tx.type)}
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white truncate group-hover:text-emerald-400 transition-colors">
                        {tx.product_name || tx.category || tx.type}
                      </span>
                      {getStatusBadge(tx.status)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <span>{tx.reference}</span>
                      {tx.recipient_identifier && (
                        <>
                          <span>•</span>
                          <span className="truncate">{tx.recipient_identifier}</span>
                        </>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">{formatDate(tx.created_at)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 text-right">
                  <div className="space-y-0.5">
                    <span className="font-mono text-base font-extrabold text-white block">
                      {formatKoboAsNaira(tx.charged_amount_kobo)}
                    </span>
                    {tx.status === 'REFUNDED' && (
                      <span className="text-[10px] font-bold text-blue-400 block">
                        +Refunded
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load More Button */}
        {hasMore && (
          <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 text-center">
            <button
              onClick={() => fetchTransactions(nextCursor || undefined, true)}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Loading More...
                </>
              ) : (
                'Load More Transactions'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Selected Transaction Receipt Modal */}
      {selectedTxId && (
        <TransactionReceiptModal
          transactionId={selectedTxId}
          onClose={() => setSelectedTxId(null)}
        />
      )}
    </div>
  );
}
