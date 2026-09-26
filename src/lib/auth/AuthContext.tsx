/**
 * Alexvya Platform — React Authentication Context & Provider
 * Stage 2.3 Authentication & User Provisioning
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User } from 'firebase/auth';
import {
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  sendPasswordReset,
  resendVerificationEmail,
  signOutUser,
  getAuthBearerToken,
  subscribeToAuthState,
} from '../firebase/auth.ts';
import { SafeUserProfile } from '../../types/user.ts';

interface AuthContextType {
  user: User | null;
  profile: SafeUserProfile | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isEmailVerified: boolean;
  token: string | null;
  loginWithGoogle: () => Promise<boolean>;
  loginWithEmail: (email: string, pass: string) => Promise<boolean>;
  registerWithEmail: (email: string, pass: string) => Promise<boolean>;
  resetPassword: (email: string) => Promise<boolean>;
  resendVerification: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<SafeUserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfileFromServer = useCallback(async (authToken: string) => {
    try {
      const res = await fetch('/api/v1/user/profile', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setProfile(json.data);
        }
      }
    } catch (err) {
      console.warn('[AuthContext] Failed to sync profile with server:', err);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const idToken = await currentUser.getIdToken();
          setToken(idToken);
          await fetchProfileFromServer(idToken);
        } catch (err) {
          console.warn('[AuthContext] Error acquiring ID token:', err);
        }
      } else {
        setToken(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchProfileFromServer]);

  const loginWithGoogle = async (): Promise<boolean> => {
    setError(null);
    setLoading(true);
    const { user: authedUser, error: authError } = await signInWithGoogle();
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return false;
    }
    if (authedUser) {
      const idToken = await authedUser.getIdToken();
      setToken(idToken);
      await fetchProfileFromServer(idToken);
    }
    setLoading(false);
    return true;
  };

  const loginWithEmail = async (email: string, pass: string): Promise<boolean> => {
    setError(null);
    setLoading(true);
    const { user: authedUser, error: authError } = await signInWithEmail(email, pass);
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return false;
    }
    if (authedUser) {
      const idToken = await authedUser.getIdToken();
      setToken(idToken);
      await fetchProfileFromServer(idToken);
    }
    setLoading(false);
    return true;
  };

  const registerWithEmail = async (email: string, pass: string): Promise<boolean> => {
    setError(null);
    setLoading(true);
    const { user: authedUser, error: authError } = await signUpWithEmail(email, pass);
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return false;
    }
    if (authedUser) {
      const idToken = await authedUser.getIdToken();
      setToken(idToken);
      await fetchProfileFromServer(idToken);
    }
    setLoading(false);
    return true;
  };

  const resetPassword = async (email: string): Promise<boolean> => {
    setError(null);
    const { success, error: authError } = await sendPasswordReset(email);
    if (authError) {
      setError(authError.message);
      return false;
    }
    return success;
  };

  const resendVerification = async (): Promise<boolean> => {
    if (!user) return false;
    setError(null);
    const { success, error: authError } = await resendVerificationEmail(user);
    if (authError) {
      setError(authError.message);
      return false;
    }
    return success;
  };

  const logout = async (): Promise<void> => {
    await signOutUser();
    setUser(null);
    setProfile(null);
    setToken(null);
    setError(null);
  };

  const refreshProfile = async (): Promise<void> => {
    const bearer = token || (await getAuthBearerToken());
    if (bearer) {
      await fetchProfileFromServer(bearer);
    }
  };

  const clearError = () => setError(null);

  const value: AuthContextType = {
    user,
    profile,
    loading,
    error,
    isAuthenticated: Boolean(user),
    isEmailVerified: Boolean(user?.emailVerified),
    token,
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    resetPassword,
    resendVerification,
    logout,
    refreshProfile,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
