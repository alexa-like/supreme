/**
 * Alexvya Platform — Server-Side Auth & Session Verification
 * Stage 2.5.6 Financial Security Hardening & Abuse Protection
 * 
 * Verifies Authorization: Bearer <Firebase_ID_Token> using Firebase Admin SDK.
 * Authoritative Principles:
 * 1. The verified Firebase token claims (UID, email, auth_time) are the sole proof of identity.
 * 2. Client-supplied UIDs in request bodies/headers are strictly ignored.
 * 3. Reauthentication window (5 minutes / 300s auth_time) is enforced on high-risk operations.
 * 4. Admin operations require BOTH a valid Firebase token and an active record in adminUsers/{uid}.
 * 5. Roles are normalized to canonical UserRole (CUSTOMER, ADMIN, SUPER_ADMIN, AUDITOR, SYSTEM).
 */

import { getAdminAuth } from '../firebase/admin.ts';
import { getAdminUserById } from '../repositories/adminUsers.repository.ts';
import { getUserById } from '../repositories/users.repository.ts';
import { AuthenticatedUserContext } from '../../types/api.ts';
import { UserRole, AccountStatus, normalizeUserRole } from '../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { normalizeFirebaseAdminError } from '../firebase/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

export interface AuthenticateRequestOptions {
  requireEmailVerified?: boolean;
  requiredRole?: UserRole | UserRole[];
  requireAdminRecord?: boolean;
  maxAuthAgeSeconds?: number; // E.g., 300 (5 minutes) for high-risk financial/administrative operations
  correlationId?: string;
}

let testTokenVerifier: ((token: string) => Promise<any>) | null = null;

export function __setTestTokenVerifier(verifier: ((token: string) => Promise<any>) | null): void {
  testTokenVerifier = verifier;
}

/**
 * Standard reauthentication threshold for high-risk financial & administrative operations: 5 minutes (300s).
 */
export const REAUTH_MAX_AGE_SECONDS = 300;

/**
 * Extracts, verifies, and returns the normalized authenticated user context from the Authorization header.
 */
export async function authenticateRequest(
  authHeader: string | null | undefined,
  options: AuthenticateRequestOptions = {}
): Promise<AuthenticatedUserContext> {
  const {
    requireEmailVerified = false,
    requiredRole,
    requireAdminRecord = false,
    maxAuthAgeSeconds,
    correlationId,
  } = options;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AlexvyaApiError(
      ErrorCodes.UNAUTHORIZED,
      'Missing or malformed Authorization header. Expected Bearer <Firebase_ID_Token>.',
      401,
      { correlation_id: correlationId }
    );
  }

  const idToken = authHeader.substring(7).trim();
  if (!idToken) {
    throw new AlexvyaApiError(
      ErrorCodes.UNAUTHORIZED,
      'Empty bearer token provided.',
      401,
      { correlation_id: correlationId }
    );
  }

  try {
    const authAdmin = getAdminAuth();
    // Verify ID token and check for revocation
    // Verify ID token offline using Google Public Keys (checkRevoked = false avoids Identity Toolkit API calls)
    const decodedToken = testTokenVerifier
      ? await testTokenVerifier(idToken)
      : await authAdmin.verifyIdToken(idToken, false);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const authTime = decodedToken.auth_time;

    // 1. Enforce Reauthentication Window on High-Risk Operations (5-Minute Window)
    if (maxAuthAgeSeconds && authTime) {
      const tokenAgeSeconds = nowSeconds - authTime;
      if (tokenAgeSeconds > maxAuthAgeSeconds) {
        throw new AlexvyaApiError(
          ErrorCodes.UNAUTHORIZED,
          `Fresh authentication required. Your session is older than ${maxAuthAgeSeconds / 60} minutes. Please re-authenticate.`,
          401,
          {
            token_age_seconds: tokenAgeSeconds,
            max_allowed_age_seconds: maxAuthAgeSeconds,
            correlation_id: correlationId,
          }
        );
      }
    }

    // 2. Fetch User Profile Status from Database if exists
    let accountStatus: AccountStatus = AccountStatus.ACTIVE;
    const userDoc = await getUserById(decodedToken.uid);
    if (userDoc) {
      accountStatus = (userDoc.account_status || (userDoc as any).status || AccountStatus.ACTIVE) as AccountStatus;
      if (
        accountStatus === AccountStatus.SUSPENDED ||
        accountStatus === AccountStatus.FROZEN ||
        accountStatus === AccountStatus.CLOSED
      ) {
        throw new AlexvyaApiError(
          ErrorCodes.ACCOUNT_SUSPENDED,
          `Account is ${accountStatus}. Financial and authenticated operations are restricted.`,
          403,
          { account_status: accountStatus, correlation_id: correlationId }
        );
      }
    }

    // 3. Resolve Authoritative User Role (Database-Gated for Staff, Token for Fallback)
    let resolvedRole: UserRole = normalizeUserRole((decodedToken.role as string) || UserRole.CUSTOMER);
    let adminRecord = null;

    if (
      requireAdminRecord ||
      resolvedRole === UserRole.ADMIN ||
      resolvedRole === UserRole.SUPER_ADMIN ||
      resolvedRole === UserRole.AUDITOR
    ) {
      adminRecord = await getAdminUserById(decodedToken.uid);

      if (requireAdminRecord) {
        if (!adminRecord || !adminRecord.is_active) {
          throw new AlexvyaApiError(
            ErrorCodes.FORBIDDEN,
            'Administrative access denied. No active administrative record found for this account.',
            403,
            { correlation_id: correlationId, uid: decodedToken.uid }
          );
        }
        resolvedRole = normalizeUserRole(adminRecord.role);
      } else if (adminRecord && adminRecord.is_active) {
        resolvedRole = normalizeUserRole(adminRecord.role);
      } else {
        // If claimed role is admin but has no active admin document, downgrade to CUSTOMER
        resolvedRole = UserRole.CUSTOMER;
      }
    }

    const userContext: AuthenticatedUserContext = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      emailVerified: decodedToken.email_verified || false,
      role: resolvedRole,
      authTime,
      adminRecord,
      accountStatus,
      token: idToken,
    };

    // 4. Require Email Verification if flagged
    if (requireEmailVerified && !userContext.emailVerified) {
      throw new AlexvyaApiError(
        ErrorCodes.EMAIL_NOT_VERIFIED,
        'Email verification is required to perform this action. Please verify your email address.',
        403,
        { correlation_id: correlationId, uid: userContext.uid }
      );
    }

    // 5. Enforce Required Role
    if (requiredRole) {
      const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      const hasRole = allowedRoles.includes(userContext.role) || userContext.role === UserRole.SUPER_ADMIN;
      if (!hasRole) {
        throw new AlexvyaApiError(
          ErrorCodes.FORBIDDEN,
          `Access denied. Requires one of [${allowedRoles.join(', ')}] role (current role: '${userContext.role}').`,
          403,
          {
            correlation_id: correlationId,
            required_roles: allowedRoles,
            current_role: userContext.role,
          }
        );
      }
    }

    return userContext;
  } catch (err) {
    if (err instanceof AlexvyaApiError) {
      throw err;
    }

    logger.warn('Token verification failed on server', { error: String(err) }, correlationId);
    throw normalizeFirebaseAdminError(err, correlationId);
  }
}
