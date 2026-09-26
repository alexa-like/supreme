/**
 * Alexvya Platform — Customer VAS Purchase Experience & Dashboard
 * Built for Stage 2.9 (Customer VAS Portal)
 */

import React, { useState, useEffect } from 'react';
import { 
  Smartphone, 
  Wifi, 
  Zap, 
  Tv, 
  CreditCard, 
  ArrowRight, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  AlertTriangle,
  Info,
  ShieldAlert,
  Search,
  Sparkles,
  ChevronRight,
  UserCheck,
  Receipt,
  HelpCircle,
  Bell,
  BookOpen,
  User
} from 'lucide-react';
import { useAuth } from '../../lib/auth/AuthContext.tsx';
import { apiFetch } from '../../lib/api/apiClient.ts';
import { CustomerTransactions } from './CustomerTransactions.tsx';
import { CustomerLedgerHistory } from './CustomerLedgerHistory.tsx';
import { CustomerNotificationCenter } from './CustomerNotificationCenter.tsx';
import { TransactionReceiptModal } from './TransactionReceiptModal.tsx';
import { CustomerAccountSettings } from './CustomerAccountSettings.tsx';

// Enums / Consts mimicking server types
type ServiceCategory = 'AIRTIME' | 'DATA' | 'ELECTRICITY' | 'CABLE_TV';

interface WalletState {
  id: string;
  currency: string;
  available_balance_kobo: number;
  ledger_balance_kobo: number;
  locked_balance_kobo: number;
  status: string;
}

interface ServiceProduct {
  id: string;
  category: string;
  sub_category: string;
  name: string;
  description: string;
  face_value_kobo: number;
  selling_price_kobo: number;
  discount_percentage: number;
  service_fee_kobo: number;
  is_active: boolean;
  min_amount_kobo: number;
  max_amount_kobo: number;
}

interface ValidationResult {
  isValid: boolean;
  customerName: string;
  customerAddress?: string;
  disco?: string;
  operator?: string;
}

export function CustomerVasDashboard() {
  const { profile, isEmailVerified, refreshProfile } = useAuth();
  
  // Navigation tabs: Services, Transactions & Receipts, Wallet Journal, Notifications, Account & Security
  const [mainTab, setMainTab] = useState<'services' | 'transactions' | 'ledger' | 'notifications' | 'account'>('services');
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [unreadNotifCount, setUnreadNotifCount] = useState<number>(0);

  // Tab state
  const [activeCategory, setActiveCategory] = useState<ServiceCategory>('AIRTIME');

  // Wallet state
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  // Fund wallet modal state
  const [fundOpen, setFundOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState('');
  const [fundLoading, setFundLoading] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [fundSuccessUrl, setFundSuccessUrl] = useState<string | null>(null);

  // Catalog cache
  const [dataCatalog, setDataCatalog] = useState<ServiceProduct[]>([]);
  const [electCatalog, setElectCatalog] = useState<ServiceProduct[]>([]);
  const [cableCatalog, setCableCatalog] = useState<ServiceProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // General Form Input States
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState<'MTN' | 'AIRTEL' | 'GLO' | '9MOBILE'>('MTN');
  const [airtimeAmount, setAirtimeAmount] = useState(''); // Naira

  const [selectedDataProduct, setSelectedDataProduct] = useState<ServiceProduct | null>(null);

  const [selectedDisco, setSelectedDisco] = useState<string>('IKEDC');
  const [meterNumber, setMeterNumber] = useState('');
  const [meterType, setMeterType] = useState<'PREPAID' | 'POSTPAID'>('PREPAID');
  const [electricityAmount, setElectricityAmount] = useState(''); // Naira

  const [selectedCableProduct, setSelectedCableProduct] = useState<ServiceProduct | null>(null);
  const [smartcardNumber, setSmartcardNumber] = useState('');

  // Validation States
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Flow / Submission Engine State
  const [currentStep, setCurrentStep] = useState<'input' | 'confirm' | 'submitting' | 'result'>('input');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [purchaseResult, setPurchaseResult] = useState<any>(null);
  const [purchaseError, setPurchaseError] = useState<{ message: string; code?: string } | null>(null);

  // Fetch Wallet state authoritatively
  const fetchWallet = async () => {
    setWalletLoading(true);
    setWalletError(null);
    try {
      const data = await apiFetch<WalletState>('/api/v1/wallet');
      setWallet(data);
    } catch (err: any) {
      setWalletError(err.message || 'Failed to fetch wallet balance');
    } finally {
      setWalletLoading(false);
    }
  };

  // Fetch catalog products dynamically
  const fetchCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const dataProds = await apiFetch<ServiceProduct[]>('/api/v1/catalog/data');
      setDataCatalog(dataProds);
      if (dataProds.length > 0) {
        setSelectedDataProduct(dataProds[0]);
      }

      const electProds = await apiFetch<ServiceProduct[]>('/api/v1/catalog/electricity');
      setElectCatalog(electProds);

      const cableProds = await apiFetch<ServiceProduct[]>('/api/v1/catalog/cable-tv');
      setCableCatalog(cableProds);
      if (cableProds.length > 0) {
        setSelectedCableProduct(cableProds[0]);
      }
    } catch (err: any) {
      setCatalogError(err.message || 'Failed to load catalog information. Showing backup plans.');
    } finally {
      setCatalogLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const res = await apiFetch<{ unread_count: number }>('/api/v1/notifications/unread-count');
      if (res && typeof res.unread_count === 'number') {
        setUnreadNotifCount(res.unread_count);
      }
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    fetchWallet();
    fetchCatalog();
    fetchUnreadCount();
  }, []);

  useEffect(() => {
    fetchUnreadCount();
  }, [mainTab]);

  // Utility to format kobo as NGN String
  const formatKobo = (kobo: number) => {
    return `₦${(kobo / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Fund Wallet initialization
  const handleFundWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    setFundLoading(true);
    setFundError(null);
    setFundSuccessUrl(null);

    const amountNaira = parseFloat(fundAmount);
    if (isNaN(amountNaira) || amountNaira <= 0) {
      setFundError('Please enter a valid amount');
      setFundLoading(false);
      return;
    }

    const amountKobo = Math.round(amountNaira * 100);
    const uniqueIdemKey = `idem_fund_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    try {
      const initRes = await apiFetch<{ authorization_url: string; reference: string }>('/api/v1/wallet/fund/initialize', {
        method: 'POST',
        body: JSON.stringify({
          amount_kobo: amountKobo,
          idempotency_key: uniqueIdemKey,
          callback_url: window.location.origin,
        })
      });
      setFundSuccessUrl(initRes.authorization_url);
    } catch (err: any) {
      setFundError(err.message || 'Failed to initialize wallet funding');
    } finally {
      setFundLoading(false);
    }
  };

  // Perform Meter/Smartcard validations
  const handleValidateMeter = async () => {
    if (!meterNumber) {
      setValidationError('Please enter a meter number');
      return;
    }
    setIsValidating(true);
    setValidationError(null);
    setValidationResult(null);
    try {
      const res = await apiFetch<ValidationResult>('/api/v1/services/electricity/validate-meter', {
        method: 'POST',
        body: JSON.stringify({
          disco: selectedDisco,
          meter_number: meterNumber,
          meter_type: meterType,
        })
      });
      setValidationResult(res);
    } catch (err: any) {
      setValidationError(err.message || 'Meter verification failed. Please check the meter number.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleValidateSmartcard = async () => {
    if (!smartcardNumber) {
      setValidationError('Please enter a smartcard / IUC number');
      return;
    }
    setIsValidating(true);
    setValidationError(null);
    setValidationResult(null);
    try {
      const activeOperator = selectedCableProduct?.sub_category || 'DSTV';
      const res = await apiFetch<ValidationResult>('/api/v1/services/cable-tv/validate-smartcard', {
        method: 'POST',
        body: JSON.stringify({
          operator: activeOperator,
          smartcard_number: smartcardNumber,
        })
      });
      setValidationResult(res);
    } catch (err: any) {
      setValidationError(err.message || 'Smartcard verification failed. Please check the smartcard number.');
    } finally {
      setIsValidating(false);
    }
  };

  // Prepare Confirmation Screen
  const handleProceedToConfirm = () => {
    // Validate fields before proceeding
    if (activeCategory === 'AIRTIME') {
      const amt = parseFloat(airtimeAmount);
      if (!phoneNumber) return alert('Enter phone number');
      if (isNaN(amt) || amt < 50 || amt > 100000) return alert('Enter amount between ₦50 and ₦100,000');
    } else if (activeCategory === 'DATA') {
      if (!phoneNumber) return alert('Enter phone number');
      if (!selectedDataProduct) return alert('Select data plan');
    } else if (activeCategory === 'ELECTRICITY') {
      const amt = parseFloat(electricityAmount);
      if (!meterNumber) return alert('Enter meter number');
      if (isNaN(amt) || amt < 50 || amt > 100000) return alert('Enter amount between ₦50 and ₦100,000');
      if (!validationResult) return alert('Please validate meter first');
    } else if (activeCategory === 'CABLE_TV') {
      if (!smartcardNumber) return alert('Enter smartcard number');
      if (!selectedCableProduct) return alert('Select a cable package');
      if (!validationResult) return alert('Please validate smartcard first');
    }

    // Set idempotency key for this sequence attempt
    const newIdemKey = `idem_purchase_${activeCategory.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    setIdempotencyKey(newIdemKey);
    setCurrentStep('confirm');
  };

  // Final Server-Side Authoritative Purchase Submission
  const handlePurchaseSubmit = async () => {
    setCurrentStep('submitting');
    setPurchaseError(null);
    setPurchaseResult(null);

    try {
      let endpoint = '';
      let payload: any = {};

      if (activeCategory === 'AIRTIME') {
        endpoint = '/api/v1/services/airtime/purchase';
        payload = {
          network: selectedNetwork,
          phone_number: phoneNumber,
          amount_kobo: Math.round(parseFloat(airtimeAmount) * 100),
        };
      } else if (activeCategory === 'DATA') {
        endpoint = '/api/v1/services/data/purchase';
        payload = {
          product_id: selectedDataProduct?.id,
          phone_number: phoneNumber,
        };
      } else if (activeCategory === 'ELECTRICITY') {
        endpoint = '/api/v1/services/electricity/purchase';
        payload = {
          disco: selectedDisco,
          meter_number: meterNumber,
          meter_type: meterType,
          amount_kobo: Math.round(parseFloat(electricityAmount) * 100),
          customer_name: validationResult?.customerName,
          customer_address: validationResult?.customerAddress,
        };
      } else if (activeCategory === 'CABLE_TV') {
        endpoint = '/api/v1/services/cable-tv/purchase';
        payload = {
          product_id: selectedCableProduct?.id,
          smartcard_number: smartcardNumber,
          customer_name: validationResult?.customerName,
        };
      }

      // Execute request leveraging our secure apiFetch with the pre-determined idempotencyKey
      const res = await apiFetch<any>(endpoint, {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify(payload),
      });

      setPurchaseResult(res);
      setCurrentStep('result');
      
      // Refresh balance and profile data post-successful transaction
      await fetchWallet();
      await refreshProfile();
    } catch (err: any) {
      setPurchaseError({ message: err.message || 'An error occurred during purchase', code: err.code });
      setCurrentStep('result');
      // Always refresh balance on any finish state (success/failure)
      await fetchWallet();
    }
  };

  const handleResetFlow = () => {
    // Clear inputs and return to dashboard
    setPhoneNumber('');
    setAirtimeAmount('');
    setElectricityAmount('');
    setMeterNumber('');
    setSmartcardNumber('');
    setValidationResult(null);
    setValidationError(null);
    setPurchaseResult(null);
    setPurchaseError(null);
    setCurrentStep('input');
  };

  // Render Account Boundary Restrictions
  if (profile?.account_status && profile.account_status !== 'ACTIVE') {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-xl mx-auto text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center mx-auto text-2xl font-bold">
          <ShieldAlert className="w-8 h-8 animate-bounce" />
        </div>
        <h2 className="text-xl font-bold text-white uppercase tracking-wider">Account Restrained</h2>
        <p className="text-sm text-slate-300">
          Your Supreme account status is currently <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-mono font-bold text-xs">{profile.account_status}</span>.
        </p>
        <p className="text-xs text-slate-400">
          In accordance with regulatory zero-trust guidelines, service purchases are strictly frozen for suspended, frozen, or closed accounts. Please contact customer relations for reconciliation.
        </p>
      </div>
    );
  }

  if (!isEmailVerified) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-xl mx-auto text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 animate-pulse" />
        </div>
        <h2 className="text-xl font-bold text-white">Email Verification Required</h2>
        <p className="text-sm text-slate-300 leading-relaxed">
          Unverified customers are restricted from purchasing virtual services (VAS) or carrying out ledger transactions.
        </p>
        <p className="text-xs text-slate-400">
          Please click on the verification link sent to your registered email or verify your profile within the authentication portal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Info / Balances Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Authoritative Wallet Balance card */}
        <div className="bg-gradient-to-tr from-slate-900 via-slate-900 to-emerald-950/20 border border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-xl">
          <div className="absolute right-0 bottom-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-mono tracking-wider text-slate-400 uppercase">Available Cash Balance</span>
              <div className="flex items-center gap-2">
                {walletLoading ? (
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                ) : (
                  <h3 className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                    {wallet ? formatKobo(wallet.available_balance_kobo) : '₦0.00'}
                  </h3>
                )}
              </div>
            </div>
            <button 
              onClick={fetchWallet} 
              className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition"
              title="Refresh Authoritative Balance"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${walletLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button 
              onClick={() => setFundOpen(true)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition shadow-lg shadow-emerald-500/10"
            >
              <CreditCard className="w-3.5 h-3.5" />
              Fund Wallet
            </button>
          </div>
        </div>

        {/* User Identity snap */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
          <div className="space-y-2">
            <span className="text-xs font-mono tracking-wider text-slate-400 uppercase">Registered Customer State</span>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold text-xs">
                {(profile?.display_name || profile?.first_name || 'U').charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">
                  {profile?.display_name || (profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}` : 'Customer')}
                </h4>
                <p className="text-xs text-slate-400 font-mono">{profile?.email}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-800/60 pt-3 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Tier: <span className="text-teal-400 font-bold">TIER_{profile?.kyc_tier || 1}</span></span>
            <span>Status: <span className="text-emerald-400 font-bold">ACTIVE</span></span>
          </div>
        </div>

        {/* Protection assurance */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
          <div className="space-y-1.5">
            <span className="text-xs font-mono tracking-wider text-slate-400 uppercase">Security Assurance</span>
            <div className="flex items-start gap-2.5 text-xs text-slate-400 leading-relaxed">
              <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p>
                All purchases are backed by double-click prevention, immutable correlation logging, and transaction idempotency protection. We resolve prices in integer-kobo to avoid float exploits.
              </p>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-slate-500 font-mono flex items-center gap-1">
            <UserCheck className="w-3 h-3 text-emerald-500" />
            Compliance Guard: Activated
          </div>
        </div>
      </div>

      {/* Primary Customer Navigation Bar */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto">
        <button
          onClick={() => setMainTab('services')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 ${
            mainTab === 'services'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Smartphone className="w-4 h-4" />
          Virtual Services
        </button>

        <button
          onClick={() => setMainTab('transactions')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 ${
            mainTab === 'transactions'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Receipt className="w-4 h-4" />
          Transaction History
        </button>

        <button
          onClick={() => setMainTab('ledger')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 ${
            mainTab === 'ledger'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Wallet Journal
        </button>

        <button
          onClick={() => setMainTab('notifications')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 relative ${
            mainTab === 'notifications'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Bell className="w-4 h-4" />
          Notifications
          {unreadNotifCount > 0 && (
            <span className={`px-1.5 py-0.5 rounded-full font-bold text-[10px] ${
              mainTab === 'notifications' ? 'bg-slate-950 text-emerald-400' : 'bg-emerald-500 text-slate-950'
            }`}>
              {unreadNotifCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setMainTab('account')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 ${
            mainTab === 'account'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <User className="w-4 h-4" />
          Account & Security
        </button>
      </div>

      {/* Main Flow Portal (Services) */}
      {mainTab === 'services' && currentStep === 'input' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          {/* Service selectors */}
          <div className="flex border-b border-slate-800 bg-slate-950/40 overflow-x-auto">
            <button
              onClick={() => { setActiveCategory('AIRTIME'); handleResetFlow(); }}
              className={`flex-1 min-w-[120px] px-6 py-4 text-xs font-bold uppercase tracking-wider border-b-2 flex items-center justify-center gap-2 transition ${
                activeCategory === 'AIRTIME'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              Airtime
            </button>
            <button
              onClick={() => { setActiveCategory('DATA'); handleResetFlow(); }}
              className={`flex-1 min-w-[120px] px-6 py-4 text-xs font-bold uppercase tracking-wider border-b-2 flex items-center justify-center gap-2 transition ${
                activeCategory === 'DATA'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wifi className="w-4 h-4" />
              Mobile Data
            </button>
            <button
              onClick={() => { setActiveCategory('ELECTRICITY'); handleResetFlow(); }}
              className={`flex-1 min-w-[120px] px-6 py-4 text-xs font-bold uppercase tracking-wider border-b-2 flex items-center justify-center gap-2 transition ${
                activeCategory === 'ELECTRICITY'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-4 h-4" />
              Electricity
            </button>
            <button
              onClick={() => { setActiveCategory('CABLE_TV'); handleResetFlow(); }}
              className={`flex-1 min-w-[120px] px-6 py-4 text-xs font-bold uppercase tracking-wider border-b-2 flex items-center justify-center gap-2 transition ${
                activeCategory === 'CABLE_TV'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tv className="w-4 h-4" />
              Cable TV
            </button>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {catalogError && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-3 rounded-xl text-xs flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <p>{catalogError}</p>
              </div>
            )}

            {/* FORM RENDER ENGINE */}
            {activeCategory === 'AIRTIME' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Network Operator</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['MTN', 'AIRTEL', 'GLO', '9MOBILE'] as const).map((net) => (
                        <button
                          key={net}
                          onClick={() => setSelectedNetwork(net)}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center ${
                            selectedNetwork === net
                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-sm'
                              : 'border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-400'
                          }`}
                        >
                          {net}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Destination Phone Number</label>
                    <input
                      type="tel"
                      placeholder="e.g. 08031234567"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Nigeria MSISDN format. Will be normalized dynamically on submission.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Recharge Amount (NGN)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-3.5 text-slate-400 text-sm font-mono">₦</span>
                      <input
                        type="number"
                        placeholder="Min 50, Max 100,000"
                        value={airtimeAmount}
                        onChange={(e) => setAirtimeAmount(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950 rounded-2xl p-6 border border-slate-800/60 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      Dynamic Airtime Incentives
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Enjoy instant discount allowances computed authoritatively by the engine:
                    </p>
                    <ul className="text-xs text-slate-400 space-y-2 font-mono">
                      <li className="flex justify-between border-b border-slate-900 pb-1.5">
                        <span>MTN:</span>
                        <span className="text-emerald-400 font-bold">2.0% Discount</span>
                      </li>
                      <li className="flex justify-between border-b border-slate-900 pb-1.5">
                        <span>Airtel:</span>
                        <span className="text-emerald-400 font-bold">2.0% Discount</span>
                      </li>
                      <li className="flex justify-between border-b border-slate-900 pb-1.5">
                        <span>Glo:</span>
                        <span className="text-emerald-400 font-bold">3.0% Discount</span>
                      </li>
                      <li className="flex justify-between pb-1.5">
                        <span>9mobile:</span>
                        <span className="text-emerald-400 font-bold">3.0% Discount</span>
                      </li>
                    </ul>
                  </div>
                  <button
                    onClick={handleProceedToConfirm}
                    disabled={!phoneNumber || !airtimeAmount}
                    className="w-full mt-6 inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm Order
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeCategory === 'DATA' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Destination Phone Number</label>
                    <input
                      type="tel"
                      placeholder="e.g. 08031234567"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Available Data Bundles</label>
                    {catalogLoading ? (
                      <div className="py-8 flex justify-center">
                        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                        {dataCatalog.map((plan) => (
                          <button
                            key={plan.id}
                            onClick={() => setSelectedDataProduct(plan)}
                            className={`w-full p-3.5 rounded-xl border text-left flex justify-between items-center transition ${
                              selectedDataProduct?.id === plan.id
                                ? 'border-emerald-500 bg-emerald-500/10'
                                : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                            }`}
                          >
                            <div>
                              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-mono text-[9px]">{plan.sub_category}</span>
                                {plan.name}
                              </div>
                              <p className="text-[10px] text-slate-500 mt-0.5">{plan.description}</p>
                            </div>
                            <span className="text-sm font-mono font-bold text-emerald-400">
                              {formatKobo(plan.selling_price_kobo)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-slate-950 rounded-2xl p-6 border border-slate-800/60 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-emerald-400" />
                      Plan Specification Summary
                    </h4>
                    {selectedDataProduct && (
                      <div className="space-y-2.5 text-xs text-slate-400 font-mono bg-slate-900/40 p-4 rounded-xl border border-slate-800/40">
                        <div className="flex justify-between">
                          <span>Product Name:</span>
                          <span className="text-white font-bold">{selectedDataProduct.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Valid Duration:</span>
                          <span className="text-teal-400">30 Days</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Resolved Price:</span>
                          <span className="text-emerald-400 font-bold">{formatKobo(selectedDataProduct.selling_price_kobo)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleProceedToConfirm}
                    disabled={!phoneNumber || !selectedDataProduct}
                    className="w-full mt-6 inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm Order
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeCategory === 'ELECTRICITY' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Distribution Disco</label>
                      <select
                        value={selectedDisco}
                        onChange={(e) => { setSelectedDisco(e.target.value); setValidationResult(null); }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500"
                      >
                        <option value="IKEDC">Ikeja Electric (IKEDC)</option>
                        <option value="EKEDC">Eko Electric (EKEDC)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Meter Type</label>
                      <select
                        value={meterType}
                        onChange={(e) => { setMeterType(e.target.value as any); setValidationResult(null); }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500"
                      >
                        <option value="PREPAID">Prepaid</option>
                        <option value="POSTPAID">Postpaid</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Meter Number</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter meter number"
                        value={meterNumber}
                        onChange={(e) => { setMeterNumber(e.target.value); setValidationResult(null); }}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                      />
                      <button
                        onClick={handleValidateMeter}
                        disabled={isValidating || !meterNumber}
                        className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white rounded-xl transition flex items-center gap-1.5 disabled:opacity-40"
                      >
                        {isValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Verify
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Funding Amount (NGN)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-3.5 text-slate-400 text-sm font-mono">₦</span>
                      <input
                        type="number"
                        placeholder="Min 50, Max 100,000"
                        value={electricityAmount}
                        onChange={(e) => setElectricityAmount(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950 rounded-2xl p-6 border border-slate-800/60 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-emerald-400" />
                      Validated Meter Details
                    </h4>
                    
                    {validationError && (
                      <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs">
                        {validationError}
                      </div>
                    )}

                    {validationResult ? (
                      <div className="space-y-2.5 text-xs text-slate-400 font-mono bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/10">
                        <div className="flex justify-between border-b border-slate-900 pb-1.5">
                          <span>Owner Name:</span>
                          <span className="text-emerald-400 font-bold">{validationResult.customerName}</span>
                        </div>
                        {validationResult.customerAddress && (
                          <div className="flex justify-between border-b border-slate-900 pb-1.5">
                            <span>Address:</span>
                            <span className="text-white text-right max-w-[150px] truncate">{validationResult.customerAddress}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>Convenience Fee:</span>
                          <span className="text-amber-400">₦100.00</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 leading-relaxed font-mono">
                        No meter is currently verified. Please enter your meter credentials and tap "Verify" to validate with your operator before purchase.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleProceedToConfirm}
                    disabled={!meterNumber || !electricityAmount || !validationResult}
                    className="w-full mt-6 inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm Order
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeCategory === 'CABLE_TV' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Subscription Packages</label>
                    {catalogLoading ? (
                      <div className="py-8 flex justify-center">
                        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                        {cableCatalog.map((plan) => (
                          <button
                            key={plan.id}
                            onClick={() => { setSelectedCableProduct(plan); setValidationResult(null); }}
                            className={`w-full p-3.5 rounded-xl border text-left flex justify-between items-center transition ${
                              selectedCableProduct?.id === plan.id
                                ? 'border-emerald-500 bg-emerald-500/10'
                                : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                            }`}
                          >
                            <div>
                              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-mono text-[9px]">{plan.sub_category}</span>
                                {plan.name}
                              </div>
                              <p className="text-[10px] text-slate-500 mt-0.5">{plan.description}</p>
                            </div>
                            <span className="text-sm font-mono font-bold text-emerald-400">
                              {formatKobo(plan.selling_price_kobo)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Smartcard / IUC Number</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter smartcard number"
                        value={smartcardNumber}
                        onChange={(e) => { setSmartcardNumber(e.target.value); setValidationResult(null); }}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                      />
                      <button
                        onClick={handleValidateSmartcard}
                        disabled={isValidating || !smartcardNumber}
                        className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white rounded-xl transition flex items-center gap-1.5 disabled:opacity-40"
                      >
                        {isValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Verify
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950 rounded-2xl p-6 border border-slate-800/60 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-emerald-400" />
                      Validated Customer Details
                    </h4>

                    {validationError && (
                      <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs">
                        {validationError}
                      </div>
                    )}

                    {validationResult ? (
                      <div className="space-y-2.5 text-xs text-slate-400 font-mono bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/10">
                        <div className="flex justify-between border-b border-slate-900 pb-1.5">
                          <span>Owner Name:</span>
                          <span className="text-emerald-400 font-bold">{validationResult.customerName}</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-900 pb-1.5">
                          <span>Package price:</span>
                          <span className="text-white font-bold">{selectedCableProduct ? formatKobo(selectedCableProduct.selling_price_kobo) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Convenience Fee:</span>
                          <span className="text-amber-400">₦100.00</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 leading-relaxed font-mono">
                        No subscription is verified. Verify your smartcard number and subscription choices prior to continuing.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleProceedToConfirm}
                    disabled={!smartcardNumber || !selectedCableProduct || !validationResult}
                    className="w-full mt-6 inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm Order
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONFIRMATION STEP */}
      {currentStep === 'confirm' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 max-w-xl mx-auto space-y-6 shadow-2xl">
          <div className="text-center space-y-1.5">
            <h3 className="text-lg font-bold text-white">Review & Confirm Purchase</h3>
            <p className="text-xs text-slate-400">Verify your purchase details prior to committing transaction.</p>
          </div>

          <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-5 space-y-3 font-mono text-xs">
            <div className="flex justify-between border-b border-slate-900 pb-2">
              <span className="text-slate-400">Service Category:</span>
              <span className="text-white font-bold">{activeCategory}</span>
            </div>

            {activeCategory === 'AIRTIME' && (
              <>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Operator Network:</span>
                  <span className="text-teal-400 font-bold">{selectedNetwork}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Destination:</span>
                  <span className="text-white font-bold">{phoneNumber}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Amount:</span>
                  <span className="text-white">₦{parseFloat(airtimeAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-emerald-400">Total Charged (Est):</span>
                  <span className="text-emerald-400 font-bold">
                    ₦{(parseFloat(airtimeAmount) * (selectedNetwork === 'MTN' || selectedNetwork === 'AIRTEL' ? 0.98 : 0.97)).toFixed(2)}
                  </span>
                </div>
              </>
            )}

            {activeCategory === 'DATA' && selectedDataProduct && (
              <>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Selected Plan:</span>
                  <span className="text-white font-bold">{selectedDataProduct.name}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Destination:</span>
                  <span className="text-white">{phoneNumber}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-emerald-400">Total Charged:</span>
                  <span className="text-emerald-400 font-bold">{formatKobo(selectedDataProduct.selling_price_kobo)}</span>
                </div>
              </>
            )}

            {activeCategory === 'ELECTRICITY' && (
              <>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Distribution Disco:</span>
                  <span className="text-white font-bold">{selectedDisco} ({meterType})</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Meter Number:</span>
                  <span className="text-white">{meterNumber}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Owner Name:</span>
                  <span className="text-teal-400 font-bold">{validationResult?.customerName}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Token Cost:</span>
                  <span className="text-white">₦{parseFloat(electricityAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Convenience Fee:</span>
                  <span className="text-white">₦100.00</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-emerald-400">Total Charged:</span>
                  <span className="text-emerald-400 font-bold">₦{(parseFloat(electricityAmount) + 100).toFixed(2)}</span>
                </div>
              </>
            )}

            {activeCategory === 'CABLE_TV' && selectedCableProduct && (
              <>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Cable Operator:</span>
                  <span className="text-white font-bold">{selectedCableProduct.sub_category}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Package Bouquet:</span>
                  <span className="text-white font-bold">{selectedCableProduct.name}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Smartcard ID:</span>
                  <span className="text-white">{smartcardNumber}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Owner Name:</span>
                  <span className="text-teal-400 font-bold">{validationResult?.customerName}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Convenience Fee:</span>
                  <span className="text-white">₦100.00</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-emerald-400">Total Charged:</span>
                  <span className="text-emerald-400 font-bold">{formatKobo(selectedCableProduct.selling_price_kobo + 10000)}</span>
                </div>
              </>
            )}
          </div>

          <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-4 text-[11px] text-slate-400 flex gap-2">
            <Info className="w-4 h-4 text-emerald-400 shrink-0" />
            <p>
              Your transaction key <span className="font-mono text-emerald-400 break-all">{idempotencyKey}</span> is strictly locked to this request. Any temporary connection loss will replay safe results, preventing duplicate operator debits.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setCurrentStep('input')}
              className="flex-1 py-3 border border-slate-800 hover:border-slate-700 bg-slate-950 rounded-xl text-xs font-bold text-slate-300 transition"
            >
              Cancel
            </button>
            <button
              onClick={handlePurchaseSubmit}
              className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10"
            >
              Verify & Complete
            </button>
          </div>
        </div>
      )}

      {/* SUBMITTING STATE */}
      {currentStep === 'submitting' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md mx-auto text-center space-y-6 shadow-2xl">
          <div className="relative w-16 h-16 mx-auto">
            <div className="w-16 h-16 rounded-full border-4 border-emerald-500/10 border-t-emerald-500 animate-spin" />
            <Sparkles className="w-5 h-5 text-emerald-400 animate-pulse absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-white">Communicating with Operator</h3>
            <p className="text-xs text-slate-400 font-mono">Deduplication Lease Secured...</p>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
            Your wallet balance is atomically debited. Committing order to virtual terminal. Please wait, do NOT click back or close this screen.
          </p>
        </div>
      )}

      {/* RESULTS STEP */}
      {currentStep === 'result' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 max-w-xl mx-auto space-y-6 shadow-2xl">
          {/* SUCCESS CASE */}
          {purchaseResult && purchaseResult.status === 'SUCCESSFUL' && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">Purchase Successful!</h3>
                <p className="text-xs text-emerald-400 font-mono">Service Successfully Delivered</p>
              </div>

              {/* Specific tokens or receipt numbers returned by backend */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-5 space-y-3 font-mono text-xs text-left">
                {purchaseResult.token && (
                  <div className="p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10 text-center space-y-1 mb-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">STS Token Code</span>
                    <p className="text-lg font-black text-emerald-400 tracking-widest">{purchaseResult.token}</p>
                    {purchaseResult.units && <span className="text-[10px] text-slate-400">Units Generated: {purchaseResult.units} kWh</span>}
                  </div>
                )}
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Order ID:</span>
                  <span className="text-white font-mono select-all text-[10px]">{purchaseResult.order_id}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Reference:</span>
                  <span className="text-white select-all text-[10px]">{purchaseResult.reference}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Recipient:</span>
                  <span className="text-teal-400 font-bold">{purchaseResult.recipient_identifier}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Face Value:</span>
                  <span className="text-white">{formatKobo(purchaseResult.face_value_kobo)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Charged:</span>
                  <span className="text-white font-bold">{formatKobo(purchaseResult.total_charged_kobo)}</span>
                </div>
              </div>
            </div>
          )}

          {/* UNKNOWN / PROCESSING STATE */}
          {purchaseResult && (purchaseResult.status === 'PENDING' || purchaseResult.status === 'PROCESSING' || purchaseResult.status === 'UNKNOWN') && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mx-auto">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-white">Transaction Processing</h3>
                <p className="text-xs text-amber-400 font-mono">Unresolved Operator Callback</p>
              </div>

              <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 text-xs text-amber-400 leading-relaxed text-left">
                <p>
                  Your transaction is still being processed. We are checking with the service provider. Your funds are protected in our escrow and will be automatically refunded if delivery fails.
                </p>
                <p className="mt-2 font-bold text-[11px]">
                  Do NOT submit another purchase request to prevent double charges.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-5 space-y-3 font-mono text-xs text-left">
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Order ID:</span>
                  <span className="text-white text-[10px] select-all">{purchaseResult.order_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Reference:</span>
                  <span className="text-white text-[10px] select-all">{purchaseResult.reference}</span>
                </div>
              </div>
            </div>
          )}

          {/* REFUNDED CASE */}
          {purchaseResult && purchaseResult.status === 'REFUNDED' && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">Delivery Failed & Refunded</h3>
                <p className="text-xs text-indigo-400 font-mono">Wallet Credit Restored</p>
              </div>

              <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-4 text-xs text-indigo-400 leading-relaxed text-left">
                <p>
                  The operator was unable to fulfill your virtual service delivery. Your cash wallet balance has been instantly restored with the original payment of <span className="font-bold">{formatKobo(purchaseResult.total_charged_kobo)}</span>.
                </p>
              </div>
            </div>
          )}

          {/* ERROR / EXPLICIT EXCEPTION CASE */}
          {purchaseError && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center mx-auto">
                <XCircle className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">Purchase Refused</h3>
                <p className="text-xs text-red-400 font-mono">Error Code: {purchaseError.code || 'TRANSACTION_REJECTED'}</p>
              </div>

              <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 text-xs text-red-400 leading-relaxed">
                <p className="font-medium text-red-400">{purchaseError.message}</p>
                {purchaseError.code === 'INSUFFICIENT_BALANCE' && (
                  <p className="mt-2 text-slate-400 text-[11px]">
                    Please fund your available cash wallet balance to complete this purchase.
                  </p>
                )}
              </div>
            </div>
          )}

          {purchaseResult && (
            <button
              onClick={() => setSelectedReceiptId(purchaseResult.transaction_id || purchaseResult.id || purchaseResult.order_id || purchaseResult.reference)}
              className="w-full py-3 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2"
            >
              <Receipt className="w-4 h-4" />
              View Official Receipt & Breakdown
            </button>
          )}

          <button
            onClick={handleResetFlow}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white rounded-xl transition"
          >
            Return to Dashboard
          </button>
        </div>
      )}

      {mainTab === 'transactions' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
          <CustomerTransactions />
        </div>
      )}

      {mainTab === 'ledger' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
          <CustomerLedgerHistory />
        </div>
      )}

      {mainTab === 'notifications' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
          <CustomerNotificationCenter onUnreadCountChange={setUnreadNotifCount} />
        </div>
      )}

      {mainTab === 'account' && (
        <CustomerAccountSettings />
      )}

      {/* Authoritative Receipt Modal */}
      {selectedReceiptId && (
        <TransactionReceiptModal
          transactionId={selectedReceiptId}
          onClose={() => setSelectedReceiptId(null)}
        />
      )}

      {/* FUND WALLET DIALOG */}
      {fundOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md relative shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Initialize Wallet Funding</h3>
            <p className="text-xs text-slate-400 mb-4">Complete your secure checkout via our verified Paystack integration.</p>
            
            <form onSubmit={handleFundWallet} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Funding Amount (NGN)</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-slate-400 text-sm font-mono">₦</span>
                  <input
                    type="number"
                    placeholder="Enter amount to credit"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              {fundError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs">
                  {fundError}
                </div>
              )}

              {fundSuccessUrl ? (
                <div className="space-y-3">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-xs">
                    Checkout initialization complete! Tap below to open Paystack portal.
                  </div>
                  <a
                    href={fundSuccessUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-center font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/15"
                  >
                    Open Payment Portal
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setFundOpen(false); setFundAmount(''); setFundError(null); setFundSuccessUrl(null); }}
                    className="flex-1 py-3 border border-slate-800 hover:border-slate-700 rounded-xl text-xs text-slate-400 font-mono transition"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={fundLoading || !fundAmount}
                    className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 disabled:opacity-40"
                  >
                    {fundLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Proceed
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
