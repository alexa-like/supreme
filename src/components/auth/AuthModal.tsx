/**
 * Alexvya Platform — Authentication & Profile Modal
 * Stage 2.3 User Provisioning Architecture
 */

import React, { useState } from 'react';
import { useAuth } from '../../lib/auth/AuthContext.tsx';
import { 
  Lock, 
  Mail, 
  User, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  LogOut, 
  ShieldCheck, 
  Send,
  RefreshCw,
  KeyRound,
  Eye,
  EyeOff
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup' | 'reset';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'signin',
}) => {
  const {
    user,
    profile,
    isAuthenticated,
    isEmailVerified,
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    resetPassword,
    resendVerification,
    logout,
    refreshProfile,
    error,
    clearError,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  if (!isOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMessage(null);
    setSubmitting(true);
    const success = await loginWithEmail(email, password);
    setSubmitting(false);
    if (success) {
      onClose();
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMessage(null);

    if (password !== confirmPassword) {
      setLocalMessage('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setLocalMessage('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    const success = await registerWithEmail(email, password);
    setSubmitting(false);
    if (success) {
      setLocalMessage('Account created! A verification link has been sent to your email.');
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMessage(null);
    if (!email) {
      setLocalMessage('Please enter your email address.');
      return;
    }
    setSubmitting(true);
    const success = await resetPassword(email);
    setSubmitting(false);
    if (success) {
      setLocalMessage('If an account exists for this email, password reset instructions have been sent.');
    }
  };

  const handleGoogleSignIn = async () => {
    setLocalMessage(null);
    setSubmitting(true);
    const success = await loginWithGoogle();
    setSubmitting(false);
    if (success) {
      onClose();
    }
  };

  const handleResend = async () => {
    setSubmitting(true);
    const success = await resendVerification();
    setSubmitting(false);
    if (success) {
      setLocalMessage('Verification email has been resent.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 sm:p-8">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {isAuthenticated && user ? (
          /* Authenticated User Profile View */
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg">
                {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  {profile?.display_name || user.email || 'Authenticated User'}
                </h3>
                <p className="text-xs text-slate-400 font-mono">{user.uid}</p>
              </div>
            </div>

            {/* Email Verification Status Banner */}
            {!isEmailVerified ? (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 space-y-2">
                <div className="flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4" />
                  Email Not Verified
                </div>
                <p className="text-slate-400 text-[11px]">
                  Please verify your email address to access financial and transaction operations in Stage 2.3+.
                </p>
                <button
                  onClick={handleResend}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium transition text-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? 'Sending...' : 'Resend Verification Email'}
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Email Verified & Account Active
              </div>
            )}

            {/* User Profile Details */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 font-mono text-xs">
              <div className="flex justify-between border-b border-slate-900 pb-2">
                <span className="text-slate-400">Account Status</span>
                <span className="text-emerald-400 font-bold">{profile?.account_status || 'ACTIVE'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-2">
                <span className="text-slate-400">Role</span>
                <span className="text-white">{profile?.role || 'USER'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-2">
                <span className="text-slate-400">Tier</span>
                <span className="text-teal-400">{profile?.tier || 'TIER_1'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Auth Provider</span>
                <span className="text-slate-300">{user.providerData[0]?.providerId || 'password'}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={refreshProfile}
                className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Sync Profile
              </button>
              <button
                onClick={logout}
                className="flex-1 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-medium text-xs flex items-center justify-center gap-1.5 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          /* Authentication Form (Sign In, Sign Up, Reset Password) */
          <div>
            <div className="text-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-slate-950 text-lg shadow-lg shadow-emerald-900/30 mx-auto mb-3">
                S
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {mode === 'signin' && 'Welcome to Supreme'}
                {mode === 'signup' && 'Create your Supreme Account'}
                {mode === 'reset' && 'Reset your Supreme Password'}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {mode === 'signin' && 'Sign in to access your Supreme Digital Network account'}
                {mode === 'signup' && 'Register for instant VTU, data bundles, and utility settlements'}
                {mode === 'reset' && 'Enter your email to receive recovery instructions'}
              </p>
            </div>

            {/* Error & Feedback Messages */}
            {(error || localMessage) && (
              <div
                className={`p-3 rounded-xl mb-4 text-xs flex items-start gap-2 ${
                  error
                    ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                }`}
              >
                {error ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                <span className="leading-relaxed">{error || localMessage}</span>
              </div>
            )}

            {/* Google Quick Sign-In */}
            {mode !== 'reset' && (
              <div className="mb-4">
                <button
                  onClick={handleGoogleSignIn}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-slate-600 text-white font-medium text-xs flex items-center justify-center gap-2 transition shadow-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  Continue with Google
                </button>

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-800" />
                  </div>
                  <div className="relative flex justify-center text-[11px] uppercase tracking-wider font-mono">
                    <span className="bg-slate-900 px-3 text-slate-500">Or with email</span>
                  </div>
                </div>
              </div>
            )}

            {/* Email/Password Forms */}
            <form onSubmit={mode === 'signin' ? handleSignIn : mode === 'signup' ? handleSignUp : handlePasswordReset} className="space-y-3.5">
              <div>
                <label className="block text-xs text-slate-300 font-medium mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      clearError();
                      setEmail(e.target.value);
                    }}
                    placeholder="you@example.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>
              </div>

              {mode !== 'reset' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs text-slate-300 font-medium">Password</label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          clearError();
                          setLocalMessage(null);
                          setMode('reset');
                        }}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 transition"
                      >
                        Forgot Password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => {
                        clearError();
                        setPassword(e.target.value);
                      }}
                      placeholder="••••••••"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-10 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-3 text-slate-500 hover:text-slate-300"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {mode === 'signup' && (
                <div>
                  <label className="block text-xs text-slate-300 font-medium mb-1">Confirm Password</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => {
                        clearError();
                        setConfirmPassword(e.target.value);
                      }}
                      placeholder="••••••••"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-10 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3.5 top-3 text-slate-500 hover:text-slate-300"
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition duration-150 disabled:opacity-50"
              >
                {submitting ? 'Please wait...' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
              </button>
            </form>

            {/* Toggle Modes */}
            <div className="mt-5 text-center text-xs text-slate-400">
              {mode === 'signin' && (
                <p>
                  Don't have an account?{' '}
                  <button
                    onClick={() => {
                      clearError();
                      setLocalMessage(null);
                      setMode('signup');
                    }}
                    className="text-emerald-400 font-semibold hover:underline"
                  >
                    Sign Up
                  </button>
                </p>
              )}
              {mode === 'signup' && (
                <p>
                  Already have an account?{' '}
                  <button
                    onClick={() => {
                      clearError();
                      setLocalMessage(null);
                      setMode('signin');
                    }}
                    className="text-emerald-400 font-semibold hover:underline"
                  >
                    Sign In
                  </button>
                </p>
              )}
              {mode === 'reset' && (
                <p>
                  Remembered your password?{' '}
                  <button
                    onClick={() => {
                      clearError();
                      setLocalMessage(null);
                      setMode('signin');
                    }}
                    className="text-emerald-400 font-semibold hover:underline"
                  >
                    Back to Sign In
                  </button>
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
