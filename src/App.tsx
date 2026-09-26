import React, { useState } from 'react';
import { 
  Shield, 
  Layers, 
  Server, 
  Database, 
  Cloud, 
  Lock, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Smartphone, 
  Wifi, 
  Zap, 
  Tv, 
  CreditCard, 
  Cpu,
  UserCheck,
  LogIn,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { useAuth } from './lib/auth/AuthContext.tsx';
import { AuthModal } from './components/auth/AuthModal.tsx';
import { CustomerVasDashboard } from './components/vas/CustomerVasDashboard.tsx';
import { CustomerAccountSettings } from './components/vas/CustomerAccountSettings.tsx';
import { AdminOperationsConsole } from './components/admin/AdminOperationsConsole.tsx';

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'portal' | 'architecture' | 'security' | 'auth' | 'stages' | 'admin'>('overview');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup' | 'reset'>('signin');

  const { user, profile, isAuthenticated, isEmailVerified } = useAuth();

  const openAuth = (mode: 'signin' | 'signup' | 'reset' = 'signin') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      {/* Top Banner: Stage Status */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 text-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Stage 2.13: Admin Dashboard & Platform Operations Console
            </span>
            <span className="text-slate-400 hidden sm:inline">•</span>
            <span className="text-slate-400 font-mono">Server-Authoritative Identity Active</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              Financial Boundaries Locked
            </span>
            <span className="hidden md:inline text-slate-600">|</span>
            <span className="hidden md:inline font-mono">Firebase Auth / Express / Firestore</span>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-emerald-900/30">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-white">Supreme</span>
                <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 bg-slate-800 text-emerald-400 rounded border border-slate-700">Digital Network</span>
              </div>
              <p className="text-xs text-slate-400">Nigerian Digital Services & VTU Infrastructure</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <nav className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  activeTab === 'overview' 
                    ? 'bg-slate-800 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab('portal')}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'portal' 
                    ? 'bg-emerald-500 text-slate-950 shadow-md font-bold' 
                    : 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/20'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Customer Portal
              </button>
              <button
                onClick={() => setActiveTab('auth')}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  activeTab === 'auth' 
                    ? 'bg-slate-800 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Identity & Auth
              </button>
              <button
                onClick={() => setActiveTab('architecture')}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  activeTab === 'architecture' 
                    ? 'bg-slate-800 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Architecture
              </button>
              <button
                onClick={() => setActiveTab('security')}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  activeTab === 'security' 
                    ? 'bg-slate-800 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Security Boundary
              </button>
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'admin' 
                    ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold' 
                    : 'text-amber-400 hover:text-amber-300 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                Admin Console
              </button>
            </nav>

            {/* Auth Action Button */}
            {isAuthenticated && user ? (
              <button
                onClick={() => openAuth('signin')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-white transition shadow-sm"
              >
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px]">
                  {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                </div>
                <span className="hidden sm:inline font-mono">{user.email?.split('@')[0]}</span>
                {isEmailVerified ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                )}
              </button>
            ) : (
              <button
                onClick={() => openAuth('signin')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition duration-150"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Hero Card */}
            <div className="relative rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950 p-6 sm:p-8 overflow-hidden shadow-2xl">
              <div className="absolute -right-16 -top-16 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative z-10 max-w-3xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 text-emerald-400 text-xs font-mono mb-4 border border-slate-700">
                  <Shield className="w-3.5 h-3.5" />
                  Stage 2.3: Authentication & User Provisioning Ready
                </div>
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
                  Enterprise Architecture for Digital Services in Nigeria
                </h1>
                <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-6">
                  Supreme Digital Network (Supreme) is engineered with a strict zero-trust boundary model, decoupling customer client interfaces from authoritative backend financial ledger operations, multi-provider routing (VTpass, ClubKonnect), and Paystack payment verification.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                    <p className="text-xs text-slate-400">Target Platform</p>
                    <p className="text-sm font-semibold text-white mt-0.5">Vite / Express Full-Stack</p>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                    <p className="text-xs text-slate-400">Database Engine</p>
                    <p className="text-sm font-semibold text-white mt-0.5">Cloud Firestore</p>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                    <p className="text-xs text-slate-400">Auth Identity</p>
                    <p className="text-sm font-semibold text-white mt-0.5">Firebase Auth Admin</p>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                    <p className="text-xs text-slate-400">Current Phase</p>
                    <p className="text-sm font-semibold text-emerald-400 mt-0.5">Stage 2.3 Complete</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Core Planned Services */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-emerald-400" />
                  Planned Core Services (Architectural Scope)
                </h2>
                <span className="text-xs text-slate-400 font-mono">Stage 2 Implementation in Progress</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 hover:border-slate-700 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-white text-sm">Airtime Recharge</h3>
                  <p className="text-xs text-slate-400 mt-1">MTN, Airtel, Glo, 9mobile instant VTU with server-side validation.</p>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 hover:border-slate-700 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-3">
                    <Wifi className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-white text-sm">Mobile Data</h3>
                  <p className="text-xs text-slate-400 mt-1">SME, Corporate, and Direct data plans with automated provider failover.</p>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 hover:border-slate-700 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3">
                    <Zap className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-white text-sm">Electricity Bills</h3>
                  <p className="text-xs text-slate-400 mt-1">Prepaid token generation and postpaid settlement for all Nigerian Discos.</p>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 hover:border-slate-700 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
                    <Tv className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-white text-sm">Cable TV</h3>
                  <p className="text-xs text-slate-400 mt-1">DStv, GOtv, and StarTimes instant verification and subscription renewal.</p>
                </div>
                <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 hover:border-slate-700 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-white text-sm">Wallet Funding</h3>
                  <p className="text-xs text-slate-400 mt-1">Server-verified Paystack checkout and single-account journal credit.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'portal' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                <span className="w-2 h-6 bg-emerald-500 rounded"></span>
                Customer VAS Portal
              </h2>
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-400">
                Authorized Session
              </span>
            </div>
            {isAuthenticated ? (
              <CustomerVasDashboard />
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center max-w-lg mx-auto space-y-6 shadow-2xl">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto text-xl font-bold">
                  <Lock className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-white">Portal Access Restricted</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Please sign in or register an account to access virtual service purchases, wallet funding, and the digital ledger statements.
                  </p>
                </div>
                <button
                  onClick={() => openAuth('signin')}
                  className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In / Create Account
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'auth' && (
          <div className="space-y-6">
            {isAuthenticated ? (
              <CustomerAccountSettings />
            ) : (
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <UserCheck className="w-5 h-5 text-emerald-400" />
                      Authentication & Identity State
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Server-authoritative user provisioning with Firebase Authentication and Firestore documents.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openAuth('signin')}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white transition"
                    >
                      Sign In
                    </button>
                    <button
                      onClick={() => openAuth('signup')}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition"
                    >
                      Create Account
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400">Session State</span>
                    <p className="text-sm font-semibold text-white mt-1">Unauthenticated</p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400">Email Verification</span>
                    <p className="text-sm font-semibold text-slate-500 mt-1">N/A</p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400">Account Status</span>
                    <p className="text-sm font-semibold text-slate-500 mt-1">N/A</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'admin' && (
          <div className="space-y-6">
            <AdminOperationsConsole />
          </div>
        )}

        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-2">High-Level System Architecture</h2>
              <p className="text-sm text-slate-400 mb-6">
                All client requests flow through authoritative server-side application logic. Direct browser mutations to the database or external provider APIs are strictly forbidden.
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-5 font-mono text-xs text-slate-300 overflow-x-auto">
                <pre className="text-emerald-400 font-semibold mb-2">// Architectural Data & Control Flow</pre>
                <div className="space-y-3 leading-relaxed">
                  <div className="p-2.5 bg-slate-900/80 rounded border border-slate-800">
                    <span className="text-emerald-400 font-bold">[1] Customer Browser (Untrusted Context)</span>
                    <p className="text-slate-400 mt-0.5">React 19 Components • Firebase Client Auth • Read-Only Views</p>
                  </div>
                  <div className="text-center text-slate-500">↓ HTTPS Bearer Token / API Requests</div>
                  <div className="p-2.5 bg-slate-900/80 rounded border border-slate-800">
                    <span className="text-emerald-400 font-bold">[2] Server Layer (Express /api/v1/*)</span>
                    <p className="text-slate-400 mt-0.5">Firebase Admin Token Verification • Input Validation (Zod) • Request Correlation</p>
                  </div>
                  <div className="text-center text-slate-500">↓ Authorized Invocation</div>
                  <div className="p-2.5 bg-slate-900/80 rounded border border-slate-800">
                    <span className="text-emerald-400 font-bold">[3] Authoritative Business Logic</span>
                    <p className="text-slate-400 mt-0.5">User Provisioning • Pricing Engine • Single-Account Journal Invariants • Order Orchestrator</p>
                  </div>
                  <div className="text-center text-slate-500">↓ Firestore Transactions & Secret HTTP Calls</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-2.5 bg-slate-900/80 rounded border border-slate-800">
                      <span className="text-teal-400 font-bold">[4A] Cloud Firestore</span>
                      <p className="text-slate-400 mt-0.5">users/{'{uid}'} • Immutable Ledger • Orders • Security Profiles</p>
                    </div>
                    <div className="p-2.5 bg-slate-900/80 rounded border border-slate-800">
                      <span className="text-indigo-400 font-bold">[4B] External Providers</span>
                      <p className="text-slate-400 mt-0.5">Paystack • VTpass • ClubKonnect • Resend</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-2">Financial Safety & Security Model</h2>
              <p className="text-sm text-slate-400 mb-6">
                Supreme operates under strict zero-trust financial principles to eliminate duplicate debits, race conditions, and client tampering.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm mb-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Integer Kobo Standard
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    All monetary figures are stored, calculated, and communicated as non-negative integer kobo (1 NGN = 100 kobo). Floating-point currencies are strictly prohibited.
                  </p>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm mb-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Server-Authoritative Pricing
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Clients cannot supply price, discount, or wallet balance values. Every transaction cost is calculated authoritatively by backend services.
                  </p>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm mb-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Immutable Single-Account Journal
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Wallet balance changes must be accompanied by immutable credit/debit journal entries with running balance snapshots. Hard wallet overwrites are strictly disallowed.
                  </p>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm mb-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Idempotency & HMAC Webhooks
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    All mutation requests and incoming webhooks enforce cryptographic signature verification and deduplication keys.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authModalMode}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-6 text-xs text-slate-500 text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© 2026 Supreme Digital Network. All rights reserved.</p>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span>ENV: DEVELOPMENT</span>
            <span>BUILD: STAGE_2.12.1</span>
            <span>AUTH: FIREBASE_ACTIVE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
