/**
 * Alexvya Platform — Server Firebase Error Normalizer
 * Stage 2.2 Firebase Architecture
 * 
 * Translates Firebase Admin SDK errors into standardized AlexvyaApiError instances.
 * Prevents internal stack traces and server secrets from leaking to clients.
 */

import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';

export function normalizeFirebaseAdminError(error: unknown, correlationId?: string): AlexvyaApiError {
  if (error instanceof AlexvyaApiError) {
    return error;
  }

  const fbError = error as { code?: string; message?: string };
  const rawCode = fbError?.code || '';

  switch (rawCode) {
    case 'auth/id-token-expired':
      return new AlexvyaApiError(
        ErrorCodes.UNAUTHORIZED,
        'Your authentication session has expired. Please sign in again.',
        401,
        { correlation_id: correlationId }
      );

    case 'auth/id-token-revoked':
      return new AlexvyaApiError(
        ErrorCodes.UNAUTHORIZED,
        'Your authentication session has been revoked. Please sign in again.',
        401,
        { correlation_id: correlationId }
      );

    case 'auth/argument-error':
    case 'auth/invalid-id-token':
      return new AlexvyaApiError(
        ErrorCodes.UNAUTHORIZED,
        'Invalid authentication token provided.',
        401,
        { correlation_id: correlationId }
      );

    case 'auth/user-not-found':
      return new AlexvyaApiError(
        ErrorCodes.UNAUTHORIZED,
        'User record not found or has been disabled.',
        401,
        { correlation_id: correlationId }
      );

    case 'auth/insufficient-permission':
      return new AlexvyaApiError(
        ErrorCodes.FORBIDDEN,
        'You do not have permission to perform this action.',
        403,
        { correlation_id: correlationId }
      );

    default:
      return new AlexvyaApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        'An error occurred while communicating with database services.',
        500,
        { correlation_id: correlationId }
      );
  }
}
