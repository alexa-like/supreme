/**
 * Alexvya Platform — Client Firebase Authentication Service
 * Stage 2.2 Firebase Architecture
 * 
 * Reusable client-side authentication methods.
 * All errors are normalized to prevent internal SDK leakage.
 */

import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  User,
  NextOrObserver,
} from 'firebase/auth';
import { auth } from './client.ts';
import { normalizeFirebaseAuthError, NormalizedClientError } from './errors.ts';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Sign in with Google Popup.
 */
export async function signInWithGoogle(): Promise<{ user: User | null; error: NormalizedClientError | null }> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return { user: result.user, error: null };
  } catch (err) {
    return { user: null, error: normalizeFirebaseAuthError(err) };
  }
}

/**
 * Sign in with Email and Password.
 */
export async function signInWithEmail(
  email: string,
  pass: string
): Promise<{ user: User | null; error: NormalizedClientError | null }> {
  try {
    const result = await signInWithEmailAndPassword(auth, email.trim(), pass);
    return { user: result.user, error: null };
  } catch (err) {
    return { user: null, error: normalizeFirebaseAuthError(err) };
  }
}

/**
 * Create new account with Email and Password.
 */
export async function signUpWithEmail(
  email: string,
  pass: string
): Promise<{ user: User | null; error: NormalizedClientError | null }> {
  try {
    const result = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    if (result.user) {
      // Trigger email verification immediately upon registration
      await sendEmailVerification(result.user);
    }
    return { user: result.user, error: null };
  } catch (err) {
    return { user: null, error: normalizeFirebaseAuthError(err) };
  }
}

/**
 * Send email verification to current user.
 */
export async function resendVerificationEmail(
  user: User
): Promise<{ success: boolean; error: NormalizedClientError | null }> {
  try {
    await sendEmailVerification(user);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: normalizeFirebaseAuthError(err) };
  }
}

/**
 * Send password reset email.
 */
export async function sendPasswordReset(
  email: string
): Promise<{ success: boolean; error: NormalizedClientError | null }> {
  try {
    await sendPasswordResetEmail(auth, email.trim());
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: normalizeFirebaseAuthError(err) };
  }
}

/**
 * Sign out current authenticated user.
 */
export async function signOutUser(): Promise<{ success: boolean; error: NormalizedClientError | null }> {
  try {
    await signOut(auth);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: normalizeFirebaseAuthError(err) };
  }
}

/**
 * Retrieves current Firebase ID token for authenticated API requests.
 */
export async function getAuthBearerToken(forceRefresh = false): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  return currentUser.getIdToken(forceRefresh);
}

/**
 * Subscribe to Firebase Auth state changes.
 */
export function subscribeToAuthState(observer: NextOrObserver<User>) {
  return onAuthStateChanged(auth, observer);
}
