/**
 * Alexvya Platform — Customer Notification Inbox & Center
 * Stage 2.10: Customer Transactions, Receipts & Notifications
 * 
 * Notification management: unread count tracking, mark-as-read,
 * transaction cross-linking, and read-state persistence.
 */

import React, { useState, useEffect } from 'react';
import {
  Bell,
  CheckCheck,
  Check,
  RefreshCw,
  AlertTriangle,
  CreditCard,
  Smartphone,
  ShieldAlert,
  Info,
  RotateCcw,
  Receipt,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../../lib/api/apiClient.ts';
import { TransactionReceiptModal } from './TransactionReceiptModal.tsx';
import { formatDate } from './formatters.ts';

interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category: string;
  is_read: boolean;
  related_transaction_reference: string | null;
  created_at: string;
}

interface NotificationsApiResponse {
  items: NotificationItem[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

interface CustomerNotificationCenterProps {
  onUnreadCountChange?: (count: number) => void;
}

export function CustomerNotificationCenter({ onUnreadCountChange }: CustomerNotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Selected Transaction Reference for modal
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  const fetchUnreadCount = async () => {
    try {
      const res = await apiFetch<{ data: { unread_count: number } }>('/api/v1/notifications/unread-count');
      if (res.data) {
        setUnreadCount(res.data.unread_count);
        if (onUnreadCountChange) onUnreadCountChange(res.data.unread_count);
      }
    } catch {
      // non-blocking
    }
  };

  const fetchNotifications = async (cursor?: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append('limit', '15');
      if (cursor) params.append('cursor', cursor);

      const res = await apiFetch<{ data: NotificationsApiResponse }>(`/api/v1/notifications?${params.toString()}`);
      if (res.data) {
        if (append) {
          setNotifications((prev) => [...prev, ...res.data.items]);
        } else {
          setNotifications(res.data.items);
        }
        setNextCursor(res.data.nextCursor);
        setHasMore(res.data.hasMore);
      }
      fetchUnreadCount();
    } catch (err: any) {
      setError(err.message || 'Unable to load notifications.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkAsRead = async (notifId: string) => {
    try {
      await apiFetch(`/api/v1/notifications/${notifId}/read`, { method: 'PATCH' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      if (onUnreadCountChange) onUnreadCountChange(Math.max(0, unreadCount - 1));
    } catch {
      // non-blocking
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await apiFetch('/api/v1/notifications/mark-all-read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      if (onUnreadCountChange) onUnreadCountChange(0);
    } catch (err: any) {
      setError('Unable to mark all notifications as read.');
    } finally {
      setMarkingAll(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'WALLET_FUNDING':
        return <CreditCard className="w-4 h-4 text-emerald-400" />;
      case 'VAS_PURCHASE':
        return <Smartphone className="w-4 h-4 text-cyan-400" />;
      case 'REFUND':
        return <RotateCcw className="w-4 h-4 text-blue-400" />;
      case 'SECURITY':
        return <ShieldAlert className="w-4 h-4 text-rose-400" />;
      default:
        return <Info className="w-4 h-4 text-amber-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-emerald-400" />
            Notification Inbox
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-black bg-emerald-500 text-slate-950">
                {unreadCount} unread
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time updates regarding your wallet funding, fulfillment status, and security alerts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition"
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
              {markingAll ? 'Marking...' : 'Mark all as read'}
            </button>
          )}

          <button
            onClick={() => fetchNotifications()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition"
            aria-label="Refresh notifications"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Notifications List Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        {loading && notifications.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
            <p className="text-xs font-mono text-slate-400">Loading your inbox...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3 px-4">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
            <p className="text-sm font-bold text-white">Failed to load notifications</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">{error}</p>
            <button
              onClick={() => fetchNotifications()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
            >
              Try Again
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-20 text-center space-y-3 px-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white">You're all caught up!</h3>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              No new notifications right now. Activity regarding your account will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                className={`p-4 sm:px-6 transition flex items-start justify-between gap-4 ${
                  notif.is_read ? 'bg-transparent opacity-85' : 'bg-emerald-500/[0.03]'
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    {getCategoryIcon(notif.category)}
                  </div>

                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className={`text-sm font-bold ${notif.is_read ? 'text-slate-300' : 'text-white'}`}>
                        {notif.title}
                      </h4>
                      {!notif.is_read && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Unread" />
                      )}
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{notif.message}</p>
                    <div className="flex items-center gap-3 pt-1 text-[11px] text-slate-500">
                      <span>{formatDate(notif.created_at)}</span>
                      {notif.related_transaction_reference && (
                        <span className="font-mono text-slate-400">
                          Ref: {notif.related_transaction_reference}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Notification Row Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {notif.related_transaction_reference && (
                    <button
                      onClick={() => setSelectedTxId(notif.related_transaction_reference)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 hover:text-white transition"
                      title="View Receipt"
                    >
                      <Receipt className="w-3 h-3 text-emerald-400" />
                      Receipt
                    </button>
                  )}

                  {!notif.is_read && (
                    <button
                      onClick={() => handleMarkAsRead(notif.id)}
                      className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition"
                      title="Mark as read"
                      aria-label="Mark notification as read"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load More Button */}
        {hasMore && (
          <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 text-center">
            <button
              onClick={() => fetchNotifications(nextCursor || undefined, true)}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Loading More...
                </>
              ) : (
                'Load More Notifications'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Selected Transaction Receipt Modal (if clicked from notification) */}
      {selectedTxId && (
        <TransactionReceiptModal
          transactionId={selectedTxId}
          onClose={() => setSelectedTxId(null)}
        />
      )}
    </div>
  );
}
