/**
 * Alexvya Platform — Customer Account, Profile, Security & KYC Tier Experience
 * Stage 2.12 KYC, Customer Verification & Tier Management Architecture
 * 
 * Features:
 * 1. View & Edit permitted profile fields (First name, Last name, Display name, Phone number).
 * 2. KYC status lifecycle badge & tracking (NOT_STARTED, IN_PROGRESS, PENDING_REVIEW, VERIFIED, REJECTED, REQUIRES_ACTION).
 * 3. Interactive KYC verification & tier upgrade submission.
 * 4. Tier comparison matrix displaying authoritative limits (Tier 1 vs Tier 2 vs Tier 3).
 * 5. Email verification badge & anti-spam resend flow.
 * 6. Safe password reset via Firebase Auth.
 * 7. Non-financial customer preferences (notification toggles).
 * 8. Session & security info (Safe UID copy, timestamps).
 */

import React, { useState, useEffect } from 'react';
import {
  User,
  Mail,
  Phone,
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  CheckCircle2,
  Lock,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  LogOut,
  Sliders,
  Bell,
  CreditCard,
  Send,
  Loader2,
  Calendar,
  Clock,
  Info,
  ExternalLink,
  Award,
  ChevronRight,
  FileCheck,
  Sparkles,
  ArrowUpRight,
  X
} from 'lucide-react';
import { useAuth } from '../../lib/auth/AuthContext.tsx';
import { apiFetch } from '../../lib/api/apiClient.ts';
import { 
  SafeUserProfile, 
  CustomerAccountSummary, 
  SafeCustomerKycStatus,
  KycTier,
  KycStatus,
  KycVerificationMethod
} from '../../types/user.ts';
import { TierEligibilityResult } from '../../server/services/kyc/tierPolicy.ts';

export function CustomerAccountSettings() {
  const { 
    user, 
    profile, 
    isEmailVerified, 
    refreshProfile, 
    resendVerification, 
    resetPassword, 
    logout 
  } = useAuth();

  // Summary and server limits state
  const [summary, setSummary] = useState<CustomerAccountSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // KYC and Tier State
  const [kycStatus, setKycStatus] = useState<SafeCustomerKycStatus | null>(null);
  const [tierEligibility, setTierEligibility] = useState<TierEligibilityResult | null>(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);

  // KYC Verification Modal / Submission State
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [targetTier, setTargetTier] = useState<KycTier>('TIER_2');
  const [verificationMethod, setVerificationMethod] = useState<KycVerificationMethod>('BVN');
  const [idType, setIdType] = useState('BVN');
  const [idNumber, setIdNumber] = useState('');
  const [legalName, setLegalName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const [kycSubmitSuccess, setKycSubmitSuccess] = useState<string | null>(null);
  const [kycSubmitError, setKycSubmitError] = useState<string | null>(null);

  // Profile Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  // Preference toggles state
  const [emailOnCredit, setEmailOnCredit] = useState(true);
  const [emailOnPurchase, setEmailOnPurchase] = useState(true);
  const [prefLoading, setPrefLoading] = useState(false);
  const [prefSuccess, setPrefSuccess] = useState<string | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);

  // Email verification resend cooldown
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  // Password reset action state
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordResetSuccess, setPasswordResetSuccess] = useState<string | null>(null);
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null);

  // Copy UID state
  const [copiedUid, setCopiedUid] = useState(false);

  // Active view tab in account settings: 'overview' | 'kyc' | 'limits'
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'kyc' | 'limits'>('overview');

  // Synchronize local form with profile
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setDisplayName(profile.display_name || '');
      setPhoneNumber(profile.phone_number || '');
      setLegalName(
        profile.display_name || 
        (profile.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : '')
      );
      if (profile.notification_preferences) {
        setEmailOnCredit(profile.notification_preferences.email_on_wallet_credit ?? true);
        setEmailOnPurchase(profile.notification_preferences.email_on_purchase ?? true);
      }
    }
  }, [profile]);

  // Fetch authoritative account summary & KYC status
  const fetchSummaryAndKyc = async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    setKycLoading(true);
    try {
      const [sumRes, kycRes, eligRes] = await Promise.all([
        apiFetch<CustomerAccountSummary>('/api/v1/user/account-summary'),
        apiFetch<SafeCustomerKycStatus>('/api/v1/user/kyc'),
        apiFetch<TierEligibilityResult>('/api/v1/user/tier-eligibility')
      ]);

      if (sumRes) setSummary(sumRes);
      if (kycRes) setKycStatus(kycRes);
      if (eligRes) {
        setTierEligibility(eligRes);
        if (eligRes.next_tier) {
          setTargetTier(eligRes.next_tier);
          setVerificationMethod(eligRes.next_tier === 'TIER_3' ? 'GOVERNMENT_ID' : 'BVN');
          setIdType(eligRes.next_tier === 'TIER_3' ? 'PASSPORT' : 'BVN');
        }
      }
    } catch (err: any) {
      setSummaryError(err.message || 'Failed to load account data.');
    } finally {
      setSummaryLoading(false);
      setKycLoading(false);
    }
  };

  useEffect(() => {
    fetchSummaryAndKyc();
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Handle Profile Update
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    setEditSuccess(null);

    if (phoneNumber && phoneNumber.trim()) {
      const phoneRegex = /^(?:\+234|0)[789][01]\d{8}$/;
      if (!phoneRegex.test(phoneNumber.trim())) {
        setEditError('Invalid Nigerian phone format. Use +2348012345678 or 08012345678.');
        return;
      }
    }

    setEditLoading(true);
    try {
      const payload = {
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        display_name: displayName.trim() || null,
        phone_number: phoneNumber.trim() || null,
      };

      const updated = await apiFetch<SafeUserProfile>('/api/v1/user/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      if (updated) {
        setEditSuccess('Your profile has been successfully updated.');
        setIsEditing(false);
        await refreshProfile();
        await fetchSummaryAndKyc();
        setTimeout(() => setEditSuccess(null), 5000);
      }
    } catch (err: any) {
      setEditError(err.message || 'Failed to update profile.');
    } finally {
      setEditLoading(false);
    }
  };

  // Handle KYC Submission
  const handleSubmitKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    setKycSubmitError(null);
    setKycSubmitSuccess(null);

    if (!idNumber || idNumber.trim().length < 4) {
      setKycSubmitError('Please provide a valid ID or verification number.');
      return;
    }

    if (!legalName || legalName.trim().length < 2) {
      setKycSubmitError('Full legal name is required for compliance validation.');
      return;
    }

    setKycSubmitting(true);
    try {
      const payload = {
        requested_tier: targetTier,
        verification_method: verificationMethod,
        id_type: idType,
        id_number: idNumber.trim(),
        full_legal_name: legalName.trim(),
        date_of_birth: dateOfBirth ? dateOfBirth.trim() : undefined,
        address: residentialAddress ? residentialAddress.trim() : undefined,
      };

      const result = await apiFetch<SafeCustomerKycStatus>('/api/v1/user/kyc/submit', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (result) {
        setKycStatus(result);
        setKycSubmitSuccess(
          result.status === 'VERIFIED'
            ? `Verification approved! Your account is now upgraded to ${targetTier}.`
            : 'Identity verification submitted successfully! Your submission is now under review.'
        );
        setIdNumber('');
        await refreshProfile();
        await fetchSummaryAndKyc();
        setTimeout(() => {
          setKycModalOpen(false);
          setKycSubmitSuccess(null);
        }, 3000);
      }
    } catch (err: any) {
      setKycSubmitError(err.message || 'Failed to submit verification request.');
    } finally {
      setKycSubmitting(false);
    }
  };

  // Handle Preferences Save
  const handleSavePreferences = async (newCreditPref: boolean, newPurchasePref: boolean) => {
    setPrefLoading(true);
    setPrefError(null);
    setPrefSuccess(null);
    try {
      const payload = {
        notification_preferences: {
          email_on_wallet_credit: newCreditPref,
          email_on_purchase: newPurchasePref,
        },
      };

      await apiFetch<SafeUserProfile>('/api/v1/user/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setEmailOnCredit(newCreditPref);
      setEmailOnPurchase(newPurchasePref);
      setPrefSuccess('Notification preferences saved.');
      await refreshProfile();
      setTimeout(() => setPrefSuccess(null), 4000);
    } catch (err: any) {
      setPrefError(err.message || 'Failed to save preferences.');
    } finally {
      setPrefLoading(false);
    }
  };

  // Handle Resend Verification Email
  const handleResendEmail = async () => {
    if (resendCooldown > 0 || resendingEmail) return;
    setResendError(null);
    setResendSuccess(null);
    setResendingEmail(true);

    try {
      const success = await resendVerification();
      if (success) {
        setResendSuccess('Verification email sent! Please check your inbox.');
        setResendCooldown(60);
      } else {
        setResendError('Unable to send verification email. Please try again.');
      }
    } catch (err: any) {
      setResendError(err.message || 'Failed to send verification email.');
    } finally {
      setResendingEmail(false);
    }
  };

  // Handle Password Reset Flow
  const handlePasswordReset = async () => {
    if (!user?.email || resettingPassword) return;
    setPasswordResetError(null);
    setPasswordResetSuccess(null);
    setResettingPassword(true);

    try {
      const success = await resetPassword(user.email);
      if (success) {
        setPasswordResetSuccess(`Password reset instructions sent to ${user.email}.`);
      } else {
        setPasswordResetError('Could not send password reset email.');
      }
    } catch (err: any) {
      setPasswordResetError(err.message || 'Password reset failed.');
    } finally {
      setResettingPassword(false);
    }
  };

  // Handle Copy UID
  const handleCopyUid = () => {
    if (!user?.uid) return;
    navigator.clipboard.writeText(user.uid);
    setCopiedUid(true);
    setTimeout(() => setCopiedUid(false), 2000);
  };

  const isGoogleAccount = user?.providerData?.some((p) => p.providerId === 'google.com');
  const authProviderLabel = isGoogleAccount ? 'Google Sign-In' : 'Email & Password';

  const formatKoboToNaira = (kobo?: number) => {
    if (kobo === undefined || kobo === null) return '₦0.00';
    return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const accountStatus = profile?.account_status || summary?.account_status_info?.status || 'ACTIVE';
  const currentTier: KycTier = profile?.tier || summary?.limits?.tier || 'TIER_1';
  const currentKycStatus: KycStatus = kycStatus?.status || 'NOT_STARTED';

  return (
    <div className="space-y-6 animate-fade-in text-slate-100">
      {/* Top Header Card */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-60 h-60 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-slate-950 text-2xl shadow-lg shadow-emerald-900/40">
              {profile?.first_name ? profile.first_name.charAt(0).toUpperCase() : user?.email ? user.email.charAt(0).toUpperCase() : 'U'}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight">
                  {profile?.display_name || (profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : user?.email?.split('@')[0]) || 'Supreme Customer'}
                </h2>
                
                {/* Account Status Badge */}
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  accountStatus === 'ACTIVE' 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                    : accountStatus === 'SUSPENDED' 
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    accountStatus === 'ACTIVE' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                  }`} />
                  {accountStatus}
                </span>

                {/* Tier Badge */}
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono bg-teal-500/10 text-teal-300 border border-teal-500/20 font-bold">
                  <Award className="w-3 h-3" />
                  {currentTier}
                </span>

                {/* KYC Verification Status Badge */}
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  currentKycStatus === 'VERIFIED'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : currentKycStatus === 'PENDING_REVIEW'
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                    : currentKycStatus === 'REQUIRES_ACTION'
                    ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                    : currentKycStatus === 'REJECTED'
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  <FileCheck className="w-3 h-3" />
                  KYC: {currentKycStatus.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-400 font-mono">
                <span className="flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  {user?.email || 'No email registered'}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-slate-500" />
                  {authProviderLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { refreshProfile(); fetchSummaryAndKyc(); }}
              disabled={summaryLoading || kycLoading}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition flex items-center gap-1.5 shadow-sm"
              title="Synchronize profile state"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${summaryLoading || kycLoading ? 'animate-spin text-emerald-400' : ''}`} />
              Sync State
            </button>
            <button
              onClick={logout}
              className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-medium transition flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>

        {/* Sub Navigation Bar inside Account */}
        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-slate-800/80">
          <button
            onClick={() => setActiveSubTab('overview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              activeSubTab === 'overview'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Profile & Security
          </button>
          <button
            onClick={() => setActiveSubTab('kyc')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 relative ${
              activeSubTab === 'kyc'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            Identity Verification (KYC)
            {currentKycStatus === 'REQUIRES_ACTION' && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('limits')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              activeSubTab === 'limits'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            Tier Limits & Capacity
          </button>
        </div>
      </div>

      {/* KYC / TIER MANAGEMENT TAB VIEW */}
      {activeSubTab === 'kyc' && (
        <div className="space-y-6">
          {/* KYC Status & Progression Banner */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">Identity Verification & KYC Tier Management</h3>
                  <span className="text-xs font-mono px-2 py-0.5 bg-slate-800 text-teal-300 rounded border border-slate-700">
                    Current: {currentTier}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Upgrade your KYC verification level to unlock higher funding and transaction limits.
                </p>
              </div>

              {currentTier !== 'TIER_3' && (
                <button
                  onClick={() => setKycModalOpen(true)}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-emerald-500/10 shrink-0"
                >
                  <Sparkles className="w-4 h-4" />
                  {currentKycStatus === 'NOT_STARTED' || currentKycStatus === 'REJECTED' ? 'Verify Identity' : 'Upgrade KYC Tier'}
                </button>
              )}
            </div>

            {/* Status Explanations */}
            {currentKycStatus === 'PENDING_REVIEW' && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-3">
                <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <div className="space-y-1">
                  <span className="font-bold">Verification Under Review</span>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Your verification submission for {kycStatus?.requested_tier || 'next tier'} has been received by our compliance team. Reviews typically complete within 1-2 hours.
                  </p>
                </div>
              </div>
            )}

            {currentKycStatus === 'REQUIRES_ACTION' && (
              <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-purple-400" />
                <div className="space-y-1">
                  <span className="font-bold">Action Required by Customer</span>
                  <p className="text-slate-200 text-[11px] leading-relaxed">
                    {kycStatus?.customer_action_required || 'Please review and resubmit your identification documents.'}
                  </p>
                  <button
                    onClick={() => setKycModalOpen(true)}
                    className="mt-2 px-3 py-1 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-xs font-bold transition"
                  >
                    Update Verification Details
                  </button>
                </div>
              </div>
            )}

            {currentKycStatus === 'REJECTED' && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-3">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <div className="space-y-1">
                  <span className="font-bold">Verification Request Declined</span>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Reason: {kycStatus?.rejection_reason_code?.replace(/_/g, ' ') || 'Record Mismatch'}. {kycStatus?.rejection_message}
                  </p>
                  <button
                    onClick={() => setKycModalOpen(true)}
                    className="mt-2 px-3 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-bold transition"
                  >
                    Submit New Verification
                  </button>
                </div>
              </div>
            )}

            {currentKycStatus === 'VERIFIED' && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                <div className="space-y-1">
                  <span className="font-bold">Verified Account</span>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Your identity is fully verified for {currentTier}. You enjoy enhanced daily transaction allowances and prioritized provider routing.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Tier Comparison Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* TIER 1 */}
            <div className={`rounded-2xl border p-5 space-y-4 ${
              currentTier === 'TIER_1' 
                ? 'bg-slate-900 border-emerald-500/40 shadow-lg shadow-emerald-500/5' 
                : 'bg-slate-900/60 border-slate-800'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Level 1</span>
                  <h4 className="text-base font-bold text-white">Tier 1 — Basic</h4>
                </div>
                {currentTier === 'TIER_1' && (
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[10px] font-bold">
                    Current
                  </span>
                )}
              </div>

              <div className="space-y-2 text-xs font-mono bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                <div className="flex justify-between">
                  <span className="text-slate-400">Daily Funding:</span>
                  <span className="text-white font-bold">₦50,000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Max Wallet:</span>
                  <span className="text-white font-bold">₦10,000,000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Single VAS Max:</span>
                  <span className="text-teal-300 font-bold">₦100,000</span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Requirements:</p>
                <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Verified Email Address
                </div>
                <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Customer Phone Number
                </div>
              </div>
            </div>

            {/* TIER 2 */}
            <div className={`rounded-2xl border p-5 space-y-4 ${
              currentTier === 'TIER_2' 
                ? 'bg-slate-900 border-emerald-500/40 shadow-lg shadow-emerald-500/5' 
                : 'bg-slate-900/60 border-slate-800'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Level 2</span>
                  <h4 className="text-base font-bold text-white">Tier 2 — Verified</h4>
                </div>
                {currentTier === 'TIER_2' ? (
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[10px] font-bold">
                    Current
                  </span>
                ) : currentTier === 'TIER_1' ? (
                  <button
                    onClick={() => { setTargetTier('TIER_2'); setKycModalOpen(true); }}
                    className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5"
                  >
                    Upgrade <ArrowUpRight className="w-3 h-3" />
                  </button>
                ) : null}
              </div>

              <div className="space-y-2 text-xs font-mono bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                <div className="flex justify-between">
                  <span className="text-slate-400">Daily Funding:</span>
                  <span className="text-white font-bold">₦500,000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Max Wallet:</span>
                  <span className="text-white font-bold">₦50,000,000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Single VAS Max:</span>
                  <span className="text-teal-300 font-bold">₦500,000</span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Requirements:</p>
                <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                  <Check className="w-3.5 h-3.5 text-teal-400" />
                  BVN or NIN Identity Verification
                </div>
                <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                  <Check className="w-3.5 h-3.5 text-teal-400" />
                  Matching Full Legal Name & DOB
                </div>
              </div>
            </div>

            {/* TIER 3 */}
            <div className={`rounded-2xl border p-5 space-y-4 ${
              currentTier === 'TIER_3' 
                ? 'bg-slate-900 border-emerald-500/40 shadow-lg shadow-emerald-500/5' 
                : 'bg-slate-900/60 border-slate-800'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Level 3</span>
                  <h4 className="text-base font-bold text-white">Tier 3 — VIP Enterprise</h4>
                </div>
                {currentTier === 'TIER_3' ? (
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[10px] font-bold">
                    Current
                  </span>
                ) : currentTier === 'TIER_2' ? (
                  <button
                    onClick={() => { setTargetTier('TIER_3'); setKycModalOpen(true); }}
                    className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5"
                  >
                    Upgrade <ArrowUpRight className="w-3 h-3" />
                  </button>
                ) : null}
              </div>

              <div className="space-y-2 text-xs font-mono bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
                <div className="flex justify-between">
                  <span className="text-slate-400">Daily Funding:</span>
                  <span className="text-white font-bold">₦5,000,000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Max Wallet:</span>
                  <span className="text-white font-bold">₦500,000,000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Single VAS Max:</span>
                  <span className="text-teal-300 font-bold">₦2,000,000</span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Requirements:</p>
                <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                  <Check className="w-3.5 h-3.5 text-teal-400" />
                  Government Photo ID (Passport/License)
                </div>
                <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                  <Check className="w-3.5 h-3.5 text-teal-400" />
                  Proof of Address / Utility Bill
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OVERVIEW / PROFILE TAB VIEW */}
      {activeSubTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (2 Cols): Profile Information & Preferences */}
          <div className="lg:col-span-2 space-y-6">

            {/* Card 1: Personal Profile Information */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Personal Profile</h3>
                    <p className="text-xs text-slate-400">Manage your verified customer details</p>
                  </div>
                </div>

                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition shadow-sm"
                  >
                    Edit Profile
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setEditError(null);
                      if (profile) {
                        setFirstName(profile.first_name || '');
                        setLastName(profile.last_name || '');
                        setDisplayName(profile.display_name || '');
                        setPhoneNumber(profile.phone_number || '');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {editSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{editSuccess}</span>
                </div>
              )}
              {editError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              {!isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                    <span className="text-slate-500 block text-[11px] mb-1 uppercase tracking-wider">First Name</span>
                    <span className="text-slate-200 font-semibold text-sm">
                      {profile?.first_name || <span className="text-slate-600 font-normal italic">Not specified</span>}
                    </span>
                  </div>

                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                    <span className="text-slate-500 block text-[11px] mb-1 uppercase tracking-wider">Last Name</span>
                    <span className="text-slate-200 font-semibold text-sm">
                      {profile?.last_name || <span className="text-slate-600 font-normal italic">Not specified</span>}
                    </span>
                  </div>

                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                    <span className="text-slate-500 block text-[11px] mb-1 uppercase tracking-wider">Display Name</span>
                    <span className="text-slate-200 font-semibold text-sm">
                      {profile?.display_name || <span className="text-slate-600 font-normal italic">Not specified</span>}
                    </span>
                  </div>

                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                    <span className="text-slate-500 block text-[11px] mb-1 uppercase tracking-wider">Phone Number</span>
                    <span className="text-slate-200 font-semibold text-sm">
                      {profile?.phone_number || <span className="text-slate-600 font-normal italic">Not registered</span>}
                    </span>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">First Name</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="e.g. Babajide"
                        maxLength={50}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Last Name</label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="e.g. Sanwo"
                        maxLength={50}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Display Name</label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Babajide S."
                        maxLength={100}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Phone Number (Nigeria)</label>
                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+2348012345678"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono transition"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">Format: +2348012345678 or 08012345678</p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editLoading}
                      className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {editLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Save Changes
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Card 2: Email Verification & Email Authority */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Email & Identity Authority</h3>
                    <p className="text-xs text-slate-400">Authoritative Firebase Authentication credentials</p>
                  </div>
                </div>

                {isEmailVerified ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Unverified
                  </span>
                )}
              </div>

              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-slate-400 text-xs block">Registered Authentication Email</span>
                  <span className="text-white font-mono text-sm font-bold">{user?.email || 'N/A'}</span>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {isGoogleAccount 
                      ? 'Synchronized with your Google Account. Managed securely by Google.'
                      : 'Authoritative identity email.'}
                  </p>
                </div>

                {!isEmailVerified && (
                  <div className="shrink-0">
                    <button
                      onClick={handleResendEmail}
                      disabled={resendingEmail || resendCooldown > 0}
                      className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {resendingEmail ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Verification'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Card 3: Customer Notifications & Preferences */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Notification & Activity Preferences</h3>
                  <p className="text-xs text-slate-400">Customize how transaction receipts and notices are delivered</p>
                </div>
              </div>

              {prefSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{prefSuccess}</span>
                </div>
              )}

              <div className="space-y-3">
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-white">Email Receipt on Wallet Credit</p>
                    <p className="text-[11px] text-slate-400">Receive an official email receipt whenever your wallet is funded.</p>
                  </div>
                  <button
                    onClick={() => handleSavePreferences(!emailOnCredit, emailOnPurchase)}
                    disabled={prefLoading}
                    className={`w-12 h-6 rounded-full transition-colors p-1 flex items-center ${
                      emailOnCredit ? 'bg-emerald-500 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-slate-950 shadow-sm" />
                  </button>
                </div>

                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-white">Email Receipt on Service Purchase</p>
                    <p className="text-[11px] text-slate-400">Receive tokens, PINs, and receipt details via email upon order settlement.</p>
                  </div>
                  <button
                    onClick={() => handleSavePreferences(emailOnCredit, !emailOnPurchase)}
                    disabled={prefLoading}
                    className={`w-12 h-6 rounded-full transition-colors p-1 flex items-center ${
                      emailOnPurchase ? 'bg-emerald-500 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-slate-950 shadow-sm" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (1 Col): Password & Session Metadata */}
          <div className="space-y-6">
            {/* Password & Security Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Password & Security</h3>
                  <p className="text-xs text-slate-400">Credential management</p>
                </div>
              </div>

              {passwordResetSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{passwordResetSuccess}</span>
                </div>
              )}

              {!isGoogleAccount ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Reset your password securely via Firebase recovery.
                  </p>
                  <button
                    onClick={handlePasswordReset}
                    disabled={resettingPassword}
                    className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-xs font-bold text-white transition flex items-center justify-center gap-2 shadow-sm"
                  >
                    {resettingPassword ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 text-amber-400" />}
                    Send Password Reset Email
                  </button>
                </div>
              ) : (
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                    <ShieldCheck className="w-4 h-4" />
                    Google Managed Account
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Authenticated via Google Single Sign-On.
                  </p>
                </div>
              )}
            </div>

            {/* Session Info */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-3.5 text-xs font-mono">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-sans">
                Session & Account Info
              </h4>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Customer UID</span>
                  <button
                    onClick={handleCopyUid}
                    className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
                  >
                    {copiedUid ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedUid ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-slate-300 text-[11px] truncate">{user?.uid || 'Unknown'}</p>
              </div>

              <div className="space-y-1.5 text-[11px] text-slate-400">
                <div className="flex justify-between">
                  <span>Account Created</span>
                  <span className="text-slate-300 font-bold">
                    {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Last Session Sync</span>
                  <span className="text-slate-300 font-bold">
                    {profile?.last_login_at ? new Date(profile.last_login_at).toLocaleTimeString() : 'Active'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LIMITS TAB VIEW */}
      {activeSubTab === 'limits' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-white">Authoritative Tier Financial Limits</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Server-enforced operational limits for your current verification level ({currentTier}).
                </p>
              </div>

              <span className="text-xs font-mono px-3 py-1 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-bold">
                {currentTier} Active
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <span className="text-slate-400 text-[11px] block mb-1">Minimum Single Funding</span>
                <span className="text-white font-bold text-sm">{formatKoboToNaira(summary?.limits?.min_funding_kobo || 5000)}</span>
                <span className="text-slate-500 text-[10px] block mt-1">Per Paystack session</span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <span className="text-slate-400 text-[11px] block mb-1">Maximum Single Funding</span>
                <span className="text-white font-bold text-sm">{formatKoboToNaira(summary?.limits?.max_funding_kobo || 5000000)}</span>
                <span className="text-slate-500 text-[10px] block mt-1">Single transaction limit</span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <span className="text-slate-400 text-[11px] block mb-1">Daily Cumulative Funding Limit</span>
                <span className="text-emerald-400 font-bold text-sm">{formatKoboToNaira(summary?.limits?.daily_funding_limit_kobo || 5000000)}</span>
                <span className="text-slate-500 text-[10px] block mt-1">24-hour rolling limit</span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <span className="text-slate-400 text-[11px] block mb-1">Maximum Wallet Capacity</span>
                <span className="text-white font-bold text-sm">{formatKoboToNaira(summary?.limits?.max_wallet_balance_kobo || 1000000000)}</span>
                <span className="text-slate-500 text-[10px] block mt-1">Maximum stored balance</span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 sm:col-span-2">
                <span className="text-slate-400 text-[11px] block mb-1">Single VAS Purchase Range</span>
                <span className="text-teal-300 font-bold text-sm">
                  {formatKoboToNaira(summary?.limits?.min_vas_purchase_kobo || 5000)} – {formatKoboToNaira(summary?.limits?.max_vas_purchase_kobo || 10000000)}
                </span>
                <span className="text-slate-500 text-[10px] block mt-1">Airtime, Data, Electricity, Cable TV</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                These limits are authoritative and cannot be modified by the client. To unlock higher transaction bounds, please complete identity verification under the <strong>Identity Verification</strong> tab.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* KYC VERIFICATION MODAL */}
      {kycModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-lg relative shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => { setKycModalOpen(false); setKycSubmitError(null); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Award className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Identity Verification Request</h3>
                <p className="text-xs text-slate-400">Upgrade to {targetTier}</p>
              </div>
            </div>

            {kycSubmitSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{kycSubmitSuccess}</span>
              </div>
            )}

            {kycSubmitError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{kycSubmitError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitKyc} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Target Tier</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setTargetTier('TIER_2'); setVerificationMethod('BVN'); }}
                    className={`p-2.5 rounded-xl border text-center font-bold transition ${
                      targetTier === 'TIER_2'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Tier 2 (BVN/NIN)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTargetTier('TIER_3'); setVerificationMethod('GOVERNMENT_ID'); }}
                    className={`p-2.5 rounded-xl border text-center font-bold transition ${
                      targetTier === 'TIER_3'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Tier 3 (Govt ID & Address)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Verification Method / ID Type</label>
                <select
                  value={verificationMethod}
                  onChange={(e) => {
                    const method = e.target.value as KycVerificationMethod;
                    setVerificationMethod(method);
                    setIdType(method === 'BVN' ? 'BVN' : method === 'NIN' ? 'NIN' : 'PASSPORT');
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                >
                  {targetTier === 'TIER_2' ? (
                    <>
                      <option value="BVN">Bank Verification Number (BVN)</option>
                      <option value="NIN">National Identity Number (NIN)</option>
                    </>
                  ) : (
                    <>
                      <option value="GOVERNMENT_ID">International Passport / Driver's License</option>
                      <option value="UTILITY_BILL">Proof of Address / Utility Bill</option>
                      <option value="MANUAL_REVIEW">Direct Compliance Review</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Full Legal Name (as on Identity Record)</label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="e.g. Babajide Olusola Sanwo"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  {verificationMethod === 'BVN' ? '11-Digit BVN' : verificationMethod === 'NIN' ? '11-Digit NIN' : 'Document / ID Number'}
                </label>
                <input
                  type="text"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  placeholder={verificationMethod === 'BVN' || verificationMethod === 'NIN' ? 'e.g. 22233344455' : 'e.g. A01234567'}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                {targetTier === 'TIER_3' && (
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Residential Address</label>
                    <input
                      type="text"
                      value={residentialAddress}
                      onChange={(e) => setResidentialAddress(e.target.value)}
                      placeholder="e.g. 12 Marina Road, Lagos"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-slate-500 leading-relaxed">
                <ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-emerald-400" />
                Identity numbers are masked upon receipt. Your data is encrypted and handled according to NDPR standards.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setKycModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={kycSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {kycSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Submit Verification
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
