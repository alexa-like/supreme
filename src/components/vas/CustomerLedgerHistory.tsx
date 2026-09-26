/**
 * Alexvya Platform — Immutable Customer Wallet Ledger Journal
 * Stage 2.10: Customer Transactions, Receipts & Notifications
 * 
 * Displays the server-authoritative single-account wallet balance journal with
 * running balance snapshots, pagination, and multi-tenant isolation.
 */

import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  Filter,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { apiFetch } from '../../lib/api/apiClient.ts';
import { formatKoboAsNaira, formatDate } from './formatters.ts';

interface LedgerEntry {
  id: string;
  user_id: string;
  wallet_id: string;
  entry_type: string;
  direction: 'INFLOW' | 'OUTFLOW';
  category: string;
  amount_kobo: number;
  balance_before_kobo: number;
  balance_after_kobo: number;
  transaction_reference: string;
  description: string;
  created_at: string;
}

interface LedgerApiResponse {
  items: LedgerEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export function CustomerLedgerHistory() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [entryTypeFilter, setEntryTypeFilter] = useState<string>('ALL');

  const fetchLedger = async (cursor?: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append('limit', '15');
      if (cursor) params.append('cursor', cursor);
      if (entryTypeFilter !== 'ALL') params.append('entry_type', entryTypeFilter);

      const res = await apiFetch<{ data: LedgerApiResponse }>(`/api/v1/wallet/ledger?${params.toString()}`);
      if (res.data) {
        if (append) {
          setEntries((prev) => [...prev, ...res.data.items]);
        } else {
          setEntries(res.data.items);
        }
        setNextCursor(res.data.nextCursor);
        setHasMore(res.data.hasMore);
      }
    } catch (err: any) {
      setError(err.message || 'Unable to load wallet journal.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, [entryTypeFilter]);

  const getEntryBadge = (entry: LedgerEntry) => {
    if (entry.entry_type === 'REFUND') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <RotateCcw className="w-3 h-3" />
          REFUND
        </span>
      );
    }
    if (entry.direction === 'INFLOW') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <ArrowDownLeft className="w-3 h-3" />
          CREDIT
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
        <ArrowUpRight className="w-3 h-3 text-rose-400" />
        DEBIT
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Title & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            Wallet Journal
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Immutable, audit-certified journal entries with historical running balance snapshots.
          </p>
        </div>
        <button
          onClick={() => fetchLedger()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition w-fit"
          aria-label="Refresh wallet ledger"
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

        <select
          value={entryTypeFilter}
          onChange={(e) => setEntryTypeFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          aria-label="Filter by entry type"
        >
          <option value="ALL">All Entries</option>
          <option value="CREDIT">Credits (Inflow)</option>
          <option value="DEBIT">Debits (Outflow)</option>
          <option value="REFUND">Compensating Refunds</option>
        </select>
      </div>

      {/* Ledger Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        {loading && entries.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
            <p className="text-xs font-mono text-slate-400">Loading wallet journal...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3 px-4">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
            <p className="text-sm font-bold text-white">Failed to load wallet activity</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">{error}</p>
            <button
              onClick={() => fetchLedger()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
            >
              Try Again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-20 text-center space-y-3 px-4">
            <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-white">No wallet activity yet</h3>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Credits, debits, and automatic refunds will be recorded here in immutable sequence.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {entries.map((entry) => {
              const isCredit = entry.direction === 'INFLOW' || entry.entry_type === 'REFUND';
              return (
                <div
                  key={entry.id}
                  className="p-4 sm:px-6 hover:bg-slate-800/30 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                        isCredit
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      {entry.entry_type === 'REFUND' ? (
                        <RotateCcw className="w-4 h-4 text-blue-400" />
                      ) : isCredit ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-rose-400" />
                      )}
                    </div>

                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-white">
                          {entry.description || entry.category}
                        </span>
                        {getEntryBadge(entry)}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono flex-wrap">
                        <span>Ref: {entry.transaction_reference}</span>
                        <span>•</span>
                        <span>{formatDate(entry.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Financial Flow & Running Balance Snapshot */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 border-slate-800/60 pt-2 sm:pt-0 shrink-0">
                    <span
                      className={`font-mono text-base font-extrabold ${
                        isCredit ? 'text-emerald-400' : 'text-slate-200'
                      }`}
                    >
                      {isCredit ? '+' : '-'} {formatKoboAsNaira(entry.amount_kobo)}
                    </span>
                    <div className="text-[11px] font-mono text-slate-400">
                      Balance: <strong className="text-white">{formatKoboAsNaira(entry.balance_after_kobo)}</strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load More Button */}
        {hasMore && (
          <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 text-center">
            <button
              onClick={() => fetchLedger(nextCursor || undefined, true)}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Loading More...
                </>
              ) : (
                'Load More Entries'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
