/**
 * Supreme Digital Network — Client Firebase Error Normalizer
 * Stage 2.2 Firebase Architecture
 * 
 * Maps raw Firebase client error codes to sanitized, user-friendly messages.
 * Prevents exposing internal SDK details to end users.
 */

export interface NormalizedClientError {
  code: string;
  message: string;
  technicalCode: string;
}

export function normalizeFirebaseAuthError(error: unknown): NormalizedClientError {
  if (!error || typeof error !== 'object') {
    return {
      code: 'UNKNOWN_ERROR',
      message: 'An unexpected authentication error occurred. Please try again.',
      technicalCode: 'unknown',
    };
  }

  const fbError = error as { code?: string; message?: string };
  const rawCode = fbError.code || '';

  switch (rawCode) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email address or password. Please check your credentials.',
        technicalCode: rawCode,
      };

    case 'auth/email-already-in-use':
      return {
        code: 'EMAIL_ALREADY_IN_USE',
        message: 'An account with this email address already exists. Please sign in.',
        technicalCode: rawCode,
      };

    case 'auth/weak-password':
      return {
        code: 'WEAK_PASSWORD',
        message: 'Password is too weak. Please use at least 8 characters with numbers and symbols.',
        technicalCode: rawCode,
      };

    case 'auth/invalid-email':
      return {
        code: 'INVALID_EMAIL',
        message: 'The email address provided is not valid.',
        technicalCode: rawCode,
      };

    case 'auth/user-disabled':
      return {
        code: 'ACCOUNT_DISABLED',
        message: 'This account has been disabled. Please contact customer support.',
        technicalCode: rawCode,
      };

    case 'auth/too-many-requests':
      return {
        code: 'RATE_LIMITED',
        message: 'Too many unsuccessful attempts. Please wait a few minutes before trying again.',
        technicalCode: rawCode,
      };

    case 'auth/popup-closed-by-user':
      return {
        code: 'POPUP_CLOSED',
        message: 'Sign-in popup was closed before completing authentication.',
        technicalCode: rawCode,
      };

    case 'auth/popup-blocked':
      return {
        code: 'POPUP_BLOCKED',
        message: 'Sign-in popup was blocked by your browser. Please allow popups for this site.',
        technicalCode: rawCode,
      };

    case 'auth/network-request-failed':
      return {
        code: 'NETWORK_ERROR',
        message: 'Network connection issue. Please check your internet connection.',
        technicalCode: rawCode,
      };

    case 'auth/unauthorized-domain':
      return {
        code: 'UNAUTHORIZED_DOMAIN',
        message: 'This domain is not authorized for authentication. Please contact the administrator.',
        technicalCode: rawCode,
      };

    case 'auth/operation-not-allowed':
      return {
        code: 'OPERATION_NOT_ALLOWED',
        message: 'Authentication method is not enabled. Please contact support.',
        technicalCode: rawCode,
      };

    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
      return {
        code: 'INVALID_API_KEY',
        message: 'Authentication service configuration error. Please try again later.',
        technicalCode: rawCode,
      };

    case 'auth/account-exists-with-different-credential':
      return {
        code: 'ACCOUNT_EXISTS_DIFFERENT_CREDENTIAL',
        message: 'An account already exists with the same email address but different sign-in credentials.',
        technicalCode: rawCode,
      };

    default:
      return {
        code: 'AUTH_FAILED',
        message: 'Authentication failed. Please verify your details and try again.',
        technicalCode: rawCode || 'generic_auth_failure',
      };
  }
}
