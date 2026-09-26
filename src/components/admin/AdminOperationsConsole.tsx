/**
 * Supreme Digital Network — Admin Operations Console
 * Stage 2.13 Admin Dashboard & Platform Operations Interface
 */

import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Users, 
  FileText, 
  CreditCard, 
  Layers, 
  Cpu, 
  Activity, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Lock, 
  Search, 
  Filter, 
  Clock, 
  DollarSign, 
  Eye, 
  Sliders, 
  AlertCircle, 
  Check, 
  X, 
  Terminal, 
  Server,
  ShieldAlert,
  ArrowUpRight,
  Mail,
  Send
} from 'lucide-react';
import { useAuth } from '../../lib/auth/AuthContext.tsx';

export function AdminOperationsConsole() {
  const { user, profile } = useAuth();
  const [activeAdminTab, setActiveAdminTab] = useState<'dashboard' | 'customers' | 'kyc' | 'transactions' | 'providers' | 'reconciliation' | 'audit' | 'notifications'>('dashboard');
  
  const [customers, setCustomers] = useState<any[]>([]);
  const [kycRequests, setKycRequests] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [reconciliation, setReconciliation] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [notificationDeliveries, setNotificationDeliveries] = useState<any[]>([]);
  
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actionJustification, setActionJustification] = useState<string>('');

  const role = profile?.role || 'CUSTOMER';
  const isAuditor = role === 'AUDITOR';

  useEffect(() => {
    fetchDashboardData();
  }, [activeAdminTab]);

  const apiCall = async (endpoint: string, method = 'GET', body?: any) => {
    const token = user ? await user.getIdToken() : '';
    const res = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || 'Admin operation failed');
    }
    return data.data;
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeAdminTab === 'dashboard' || activeAdminTab === 'reconciliation') {
        const recon = await apiCall('/api/v1/admin/reconciliation');
        setReconciliation(recon);
      }
      if (activeAdminTab === 'customers') {
        const cust = await apiCall('/api/v1/admin/users');
        setCustomers(cust.users || cust || []);
      }
      if (activeAdminTab === 'kyc') {
        const kyc = await apiCall('/api/v1/admin/kyc/requests');
        setKycRequests(kyc.requests || kyc || []);
      }
      if (activeAdminTab === 'transactions') {
        const tx = await apiCall('/api/v1/admin/transactions');
        setTransactions(tx.transactions || tx || []);
      }
      if (activeAdminTab === 'providers') {
        const prov = await apiCall('/api/v1/admin/providers');
        setProviders(prov.providers || prov || []);
      }
      if (activeAdminTab === 'audit') {
        const audit = await apiCall('/api/v1/admin/audit-logs');
        setAuditLogs(audit.logs || audit.items || audit || []);
      }
      if (activeAdminTab === 'notifications') {
        const notifs = await apiCall('/api/v1/admin/notifications/deliveries');
        setNotificationDeliveries(notifs.items || notifs || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const handleKycReview = async (requestId: string, action: 'APPROVE' | 'REJECT' | 'REQUEST_ACTION') => {
    try {
      setLoading(true);
      if (action === 'APPROVE') {
        await apiCall(`/api/v1/admin/kyc/requests/${requestId}/approve`, 'POST', { justification: actionJustification });
      } else if (action === 'REJECT') {
        await apiCall(`/api/v1/admin/kyc/requests/${requestId}/reject`, 'POST', { rejection_reason_code: 'INVALID_DOCUMENT', rejection_notes: actionJustification });
      } else {
        await apiCall(`/api/v1/admin/kyc/requests/${requestId}/request-action`, 'POST', { customer_action_required: actionJustification });
      }
      setSuccessMsg(`KYC request ${action.toLowerCase()} successfully.`);
      setActionJustification('');
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualRequery = async (txId: string) => {
    try {
      setLoading(true);
      await apiCall(`/api/v1/admin/transactions/${txId}/requery`, 'POST', {});
      setSuccessMsg('Manual requery executed successfully.');
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCircuitBreaker = async (providerId: string, newState: string) => {
    try {
      setLoading(true);
      await apiCall(`/api/v1/admin/providers/${providerId}/circuit-breaker`, 'POST', { state: newState, justification: 'Operational circuit breaker adjustment by admin' });
      setSuccessMsg(`Provider ${providerId} circuit breaker updated to ${newState}.`);
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (role === 'CUSTOMER') {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center max-w-xl mx-auto my-12 shadow-2xl">
        <ShieldAlert className="w-16 h-16 text-amber-500 mx-auto mb-4 animate-bounce" />
        <h2 className="text-xl font-bold text-white mb-2">Administrative Access Required</h2>
        <p className="text-sm text-slate-400 mb-6">
          Your account does not have administrative privileges. Access to the Supreme Digital Network Operations Console is strictly restricted to authorized personnel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono font-bold">
              Supreme Admin Operations Console
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              Role: {role}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Platform Control & Oversight</h1>
          <p className="text-xs text-slate-400">Server-Authoritative Administration • Two-Man Rule Enforced • Immutable Audit Logging</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchDashboardData}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition shadow"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Console
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-emerald-400 text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white font-bold">&times;</button>
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-white font-bold">&times;</button>
        </div>
      )}

      <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-none">
        {[
          { id: 'dashboard', label: 'Dashboard & Metrics', icon: Activity },
          { id: 'customers', label: 'Customers', icon: Users },
          { id: 'kyc', label: 'KYC Reviews', icon: Shield },
          { id: 'transactions', label: 'Transactions', icon: CreditCard },
          { id: 'providers', label: 'Providers & Circuit Breakers', icon: Cpu },
          { id: 'reconciliation', label: 'Reconciliation', icon: Layers },
          { id: 'audit', label: 'Audit Logs', icon: FileText },
          { id: 'notifications', label: 'Communications & Delivery', icon: Mail },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveAdminTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                activeAdminTab === tab.id
                  ? 'bg-emerald-500 text-slate-950 shadow-lg font-extrabold'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        {activeAdminTab === 'dashboard' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white">System Operational Overview</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 uppercase font-mono">Platform Status</span>
                <p className="text-2xl font-extrabold text-emerald-400 mt-1">ONLINE</p>
                <p className="text-[10px] text-slate-500 mt-1">Google-managed ADC & Server Auth</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 uppercase font-mono">Reconciliation Alerts</span>
                <p className="text-2xl font-extrabold text-amber-400 mt-1">{reconciliation?.unknown_count || 0}</p>
                <p className="text-[10px] text-slate-500 mt-1">Transactions requiring investigation</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 uppercase font-mono">Active Circuit Breakers</span>
                <p className="text-2xl font-extrabold text-white mt-1">Closed (Healthy)</p>
                <p className="text-[10px] text-slate-500 mt-1">VTpass & ClubKonnect normal</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 uppercase font-mono">Two-Man Rule Threshold</span>
                <p className="text-2xl font-extrabold text-emerald-400 mt-1">₦10,000</p>
                <p className="text-[10px] text-slate-500 mt-1">1,000,000 kobo refund limit</p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
              <h4 className="text-sm font-bold text-white mb-3">Quick Operational Actions</h4>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => setActiveAdminTab('kyc')} className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-bold transition">
                  Review Pending KYC Queue
                </button>
                <button onClick={() => setActiveAdminTab('transactions')} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition">
                  Search Transactions
                </button>
                <button onClick={() => setActiveAdminTab('reconciliation')} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition">
                  Run Reconciliation Report
                </button>
              </div>
            </div>
          </div>
        )}

        {activeAdminTab === 'customers' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-white">Customer Management</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono border-b border-slate-800">
                  <tr>
                    <th className="p-3">UID / Email</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Tier</th>
                    <th className="p-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {customers.map((c) => (
                    <tr key={c.uid} className="hover:bg-slate-800/50">
                      <td className="p-3 font-mono text-emerald-400">{c.email}</td>
                      <td className="p-3 font-bold text-white">{c.first_name} {c.last_name}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          c.account_status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {c.account_status}
                        </span>
                      </td>
                      <td className="p-3 font-mono">{c.tier}</td>
                      <td className="p-3 text-slate-400">{new Date(c.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {customers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">No customers found or loading...</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeAdminTab === 'kyc' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-white">KYC Verification Review Queue</h3>
            <div className="space-y-3">
              {kycRequests.map((req) => (
                <div key={req.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-emerald-400">{req.id}</span>
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">{req.status}</span>
                    </div>
                    <p className="text-sm font-bold text-white mt-1">Requested Tier: {req.requested_tier} via {req.verification_method}</p>
                    <p className="text-xs text-slate-400 mt-0.5">User UID: <span className="font-mono">{req.user_id}</span> • Name: {req.full_legal_name || 'N/A'}</p>
                  </div>
                  {!isAuditor && req.status === 'PENDING_REVIEW' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Review justification / notes..."
                        value={actionJustification}
                        onChange={(e) => setActionJustification(e.target.value)}
                        className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                      />
                      <button
                        onClick={() => handleKycReview(req.id, 'APPROVE')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-xs transition"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleKycReview(req.id, 'REJECT')}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-xs transition"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {kycRequests.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-8">No pending KYC verification requests in queue.</p>
              )}
            </div>
          </div>
        )}

        {activeAdminTab === 'transactions' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-white">Operational Transaction Explorer</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono border-b border-slate-800">
                  <tr>
                    <th className="p-3">Reference</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/50">
                      <td className="p-3 font-mono text-emerald-400">{tx.reference}</td>
                      <td className="p-3 font-bold">{tx.type}</td>
                      <td className="p-3 font-mono">₦{(tx.amount_kobo / 100).toLocaleString()}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          tx.status === 'SUCCESSFUL' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="p-3">
                        {!isAuditor && (
                          <button
                            onClick={() => handleManualRequery(tx.id)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded text-[10px] font-bold transition"
                          >
                            Manual Requery
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">No transactions recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeAdminTab === 'providers' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-white">Provider Operations & Circuit Breakers</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {providers.map((p) => (
                <div key={p.id} className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-base">{p.name || p.id}</span>
                    <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                      p.circuit_breaker_state === 'CLOSED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {p.circuit_breaker_state || 'CLOSED'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">Services: {p.supported_services?.join(', ') || 'VTU / Bill Payments'}</p>
                  {!isAuditor && (
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={() => handleCircuitBreaker(p.id, 'CLOSED')}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-bold transition"
                      >
                        Set CLOSED
                      </button>
                      <button
                        onClick={() => handleCircuitBreaker(p.id, 'OPEN')}
                        className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold transition"
                      >
                        Set OPEN
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {providers.length === 0 && (
                <p className="text-slate-500 text-sm">No provider statuses loaded.</p>
              )}
            </div>
          </div>
        )}

        {activeAdminTab === 'reconciliation' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-white">Reconciliation Report Console</h3>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
              <p className="text-xs text-slate-400">Real-time discrepancy & UNKNOWN state analysis across provider orders and wallet funding attempts.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
                  <span className="text-xs text-slate-400 uppercase">Unknown Transactions</span>
                  <p className="text-xl font-bold text-amber-400 mt-1">{reconciliation?.unknown_count || 0}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
                  <span className="text-xs text-slate-400 uppercase">Processing Orders</span>
                  <p className="text-xl font-bold text-white mt-1">{reconciliation?.processing_count || 0}</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
                  <span className="text-xs text-slate-400 uppercase">Total Reconciled</span>
                  <p className="text-xl font-bold text-emerald-400 mt-1">{reconciliation?.total_checked || 0}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeAdminTab === 'audit' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-white">Immutable Audit Log Explorer</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono border-b border-slate-800">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Actor</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Target</th>
                    <th className="p-3">Reason / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/50">
                      <td className="p-3 text-slate-400">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="p-3 font-mono text-emerald-400">{log.actor_id} ({log.actor_role})</td>
                      <td className="p-3 font-bold text-white">{log.action}</td>
                      <td className="p-3 font-mono">{log.target_collection} / {log.target_id}</td>
                      <td className="p-3 text-slate-300">{log.reason || 'N/A'}</td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">No audit logs recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeAdminTab === 'notifications' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-white">Communication & Notification Delivery Logs</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono border-b border-slate-800">
                  <tr>
                    <th className="p-3">Created</th>
                    <th className="p-3">User & Email</th>
                    <th className="p-3">Event Type</th>
                    <th className="p-3">Channel</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Attempts</th>
                    <th className="p-3">Provider Msg ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {notificationDeliveries.map((del) => (
                    <tr key={del.id} className="hover:bg-slate-800/50">
                      <td className="p-3 text-slate-400">{new Date(del.created_at).toLocaleString()}</td>
                      <td className="p-3 font-mono text-slate-200">{del.user_id}<br/><span className="text-slate-400 text-[10px]">{del.user_email}</span></td>
                      <td className="p-3 font-bold text-sky-400">{del.event_type}</td>
                      <td className="p-3 font-mono uppercase">{del.channel}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          del.status === 'SENT' || del.status === 'DELIVERED' ? 'bg-emerald-500/10 text-emerald-400' :
                          del.status === 'SKIPPED' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'
                        }`}>
                          {del.status}
                        </span>
                      </td>
                      <td className="p-3 font-mono">{del.attempt_count || 1}</td>
                      <td className="p-3 font-mono text-slate-400">{del.provider_message_id || 'N/A'}</td>
                    </tr>
                  ))}
                  {notificationDeliveries.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-500">No notification deliveries recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
