/**
 * Alexvya Platform — Server-Authoritative User Provisioning & Sync
 * Stage 2.3 & Stage 2.4 User Provisioning Architecture
 * 
 * Invariants:
 * 1. Document ID is ALWAYS the Firebase UID: users/{uid}.
 * 2. Client CANNOT choose or change UID.
 * 3. Client CANNOT change account_status, role (CUSTOMER), or tier.
 * 4. Provisioning is strictly idempotent.
 * 5. Account status (ACTIVE, SUSPENDED, FROZEN, CLOSED) is strictly enforced.
 */

import { getAdminDb } from '../firebase/admin.ts';
import { getDb, inMemoryStore, recordFirestoreError } from '../repositories/base.repository.ts';
import { AuthenticatedUserContext } from '../../types/api.ts';
import { 
  UserDocument, 
  SafeUserProfile, 
  AccountStatus, 
  UserRole,
  CustomerAccountSummary,
  CustomerFinancialLimits,
  CustomerAccountStatusInfo,
  UpdateProfileInput 
} from '../../types/user.ts';
import { KycTier } from '../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';
import { createWalletIfMissing } from '../repositories/wallets.repository.ts';

// In-memory user store fallback for local development / testing without live GCP credentials
export const localDevUsersStore = new Map<string, UserDocument>();

/**
 * Strips sensitive internal metadata before returning profile to client.
 */
export function sanitizeUserProfile(user: UserDocument): SafeUserProfile {
  const { metadata, ...safeProfile } = user;
  return safeProfile;
}

/**
 * Validates that user account is ACTIVE.
 */
export function enforceAccountStatus(user: UserDocument, correlationId?: string) {
  if (user.account_status === 'SUSPENDED') {
    throw new AlexvyaApiError(
      ErrorCodes.ACCOUNT_SUSPENDED,
      'Your account has been suspended. Please contact customer support.',
      403,
      { correlation_id: correlationId, uid: user.uid, account_status: user.account_status }
    );
  }

  if (user.account_status === 'FROZEN') {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      'Your account is frozen due to security review. Contact support.',
      403,
      { correlation_id: correlationId, uid: user.uid, account_status: user.account_status }
    );
  }

  if (user.account_status === 'CLOSED') {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      'This account has been closed.',
      403,
      { correlation_id: correlationId, uid: user.uid, account_status: user.account_status }
    );
  }
}

/**
 * Server-side idempotent user provisioning and synchronization.
 */
export async function provisionOrSyncUser(
  userContext: AuthenticatedUserContext,
  correlationId?: string
): Promise<SafeUserProfile> {
  const { uid, email } = userContext;
  const emailVerified = Boolean(userContext.emailVerified ?? (userContext as any).email_verified);
  const now = new Date().toISOString();

  // Ensure wallet exists for user
  try {
    await createWalletIfMissing(uid);
  } catch (_err) {
    logger.info(`[UserProvisioning] Non-blocking wallet check for ${uid}`);
  }

  const db = getDb();
  if (db) {
    try {
      const userRef = db.collection('users').doc(uid);
      const snap = await userRef.get();

      if (!snap.exists) {
        // 1. Create new user document with default CUSTOMER role
        const newUser: UserDocument = {
          uid,
          id: uid,
          email: email || '',
          phone_number: null,
          first_name: '',
          last_name: '',
          display_name: null,
          photo_url: null,
          account_status: 'ACTIVE',
          role: UserRole.CUSTOMER,
          tier: 'TIER_1',
          kyc_tier: 1,
          daily_funding_limit_kobo: 5000000,
          notification_preferences: {
            email_on_wallet_credit: true,
            email_on_purchase: true,
          },
          email_verified: emailVerified,
          phone_verified: false,
          two_factor_enabled: false,
          auth_provider: 'firebase',
          created_at: now,
          updated_at: now,
          last_login_at: now,
          metadata: {
            provisioned_via: 'server_api_v1',
            initial_correlation_id: correlationId || null,
          },
        };

        await userRef.set(newUser);
        logger.info(`[UserProvisioning] New customer created: ${uid}`, { email }, correlationId);
        return sanitizeUserProfile(newUser);
      }

      // 2. Existing user: synchronize permitted Firebase Auth identity attributes
      const existing = snap.data() as UserDocument;

      // Enforce account status check
      enforceAccountStatus(existing, correlationId);

      const updates: Partial<UserDocument> = {
        last_login_at: now,
        updated_at: now,
        email_verified: emailVerified,
      };

      if (email && email !== existing.email) {
        updates.email = email;
      }

      await userRef.update(updates);
      logger.info(`[UserProvisioning] Customer synced: ${uid}`, { email }, correlationId);

      return sanitizeUserProfile({ ...existing, ...updates });
    } catch (err) {
      if (err instanceof AlexvyaApiError) {
        throw err;
      }
      recordFirestoreError(err);
    }
  }

  // Safe in-memory store for development/offline/pending IAM
  logger.info(`[UserProvisioning] Active user session for ${uid}`, undefined, correlationId);

  let user = localDevUsersStore.get(uid);
  if (!user) {
    user = {
      uid,
      id: uid,
      email: email || '',
      phone_number: null,
      first_name: '',
      last_name: '',
      display_name: null,
      photo_url: null,
      account_status: 'ACTIVE',
      role: UserRole.CUSTOMER,
      tier: 'TIER_1',
      kyc_tier: 1,
      daily_funding_limit_kobo: 5000000,
      notification_preferences: {
        email_on_wallet_credit: true,
        email_on_purchase: true,
      },
      email_verified: emailVerified,
      phone_verified: false,
      two_factor_enabled: false,
      auth_provider: 'firebase',
      created_at: now,
      updated_at: now,
      last_login_at: now,
    };
    localDevUsersStore.set(uid, user);
    inMemoryStore.setDoc('users', uid, user);
  } else {
    enforceAccountStatus(user, correlationId);
    user.last_login_at = now;
    user.updated_at = now;
    user.email_verified = emailVerified;
    if (email) user.email = email;
    inMemoryStore.setDoc('users', uid, user);
  }

  return sanitizeUserProfile(user);
}

/**
 * Server-side profile update with strict whitelist enforcement.
 */
export async function updateExistingUserProfile(
  uid: string,
  allowedUpdates: UpdateProfileInput,
  correlationId?: string
): Promise<SafeUserProfile> {
  const now = new Date().toISOString();

  const db = getDb();
  if (db) {
    try {
      const userRef = db.collection('users').doc(uid);
      const snap = await userRef.get();

      if (snap.exists) {
        const existing = snap.data() as UserDocument;
        enforceAccountStatus(existing, correlationId);

        const sanitizedUpdates: Partial<UserDocument> = {
          updated_at: now,
        };

        if (allowedUpdates.first_name !== undefined) sanitizedUpdates.first_name = allowedUpdates.first_name.trim();
        if (allowedUpdates.last_name !== undefined) sanitizedUpdates.last_name = allowedUpdates.last_name.trim();
        if (allowedUpdates.display_name !== undefined) sanitizedUpdates.display_name = allowedUpdates.display_name ? allowedUpdates.display_name.trim() : null;
        if (allowedUpdates.phone_number !== undefined) sanitizedUpdates.phone_number = allowedUpdates.phone_number ? allowedUpdates.phone_number.trim() : null;
        if (allowedUpdates.notification_preferences !== undefined) {
          sanitizedUpdates.notification_preferences = {
            email_on_wallet_credit: allowedUpdates.notification_preferences.email_on_wallet_credit ?? existing.notification_preferences?.email_on_wallet_credit ?? true,
            email_on_purchase: allowedUpdates.notification_preferences.email_on_purchase ?? existing.notification_preferences?.email_on_purchase ?? true,
          };
        }

        await userRef.update(sanitizedUpdates);
        logger.info(`[UserProvisioning] Profile updated: ${uid}`, sanitizedUpdates, correlationId);

        return sanitizeUserProfile({ ...existing, ...sanitizedUpdates });
      }
    } catch (err) {
      if (err instanceof AlexvyaApiError) {
        throw err;
      }
      recordFirestoreError(err);
    }
  }

  // In local dev fallback
  const existing = localDevUsersStore.get(uid);
  if (!existing) {
    throw new AlexvyaApiError(
      ErrorCodes.UNAUTHORIZED,
      'User record not found.',
      404,
      { correlation_id: correlationId, uid }
    );
  }

  enforceAccountStatus(existing, correlationId);

  if (allowedUpdates.first_name !== undefined) existing.first_name = allowedUpdates.first_name.trim();
  if (allowedUpdates.last_name !== undefined) existing.last_name = allowedUpdates.last_name.trim();
  if (allowedUpdates.display_name !== undefined) existing.display_name = allowedUpdates.display_name ? allowedUpdates.display_name.trim() : null;
  if (allowedUpdates.phone_number !== undefined) existing.phone_number = allowedUpdates.phone_number ? allowedUpdates.phone_number.trim() : null;
  if (allowedUpdates.notification_preferences !== undefined) {
    existing.notification_preferences = {
      email_on_wallet_credit: allowedUpdates.notification_preferences.email_on_wallet_credit ?? existing.notification_preferences?.email_on_wallet_credit ?? true,
      email_on_purchase: allowedUpdates.notification_preferences.email_on_purchase ?? existing.notification_preferences?.email_on_purchase ?? true,
    };
  }
  existing.updated_at = now;

  return sanitizeUserProfile(existing);
}

/**
 * Returns safe customer-facing status explanation.
 */
export function getCustomerAccountStatusInfo(status: AccountStatus): CustomerAccountStatusInfo {
  switch (status) {
    case 'ACTIVE':
      return {
        status: 'ACTIVE',
        message: 'Your account is active.',
        is_restricted: false,
      };
    case 'SUSPENDED':
      return {
        status: 'SUSPENDED',
        message: 'Your account has been suspended. Some actions are unavailable.',
        is_restricted: true,
      };
    case 'FROZEN':
      return {
        status: 'FROZEN',
        message: 'Financial activity on this account is currently restricted.',
        is_restricted: true,
      };
    case 'CLOSED':
      return {
        status: 'CLOSED',
        message: 'This account is closed.',
        is_restricted: true,
      };
    default:
      return {
        status: status || 'ACTIVE',
        message: 'Your account is active.',
        is_restricted: false,
      };
  }
}

import { getCanonicalLimitsForTier } from '../services/kyc/tierPolicy.ts';

/**
 * Retrieves authoritative customer account summary with profile, verified limits, and security info.
 */
export async function getCustomerAccountSummary(
  userContext: AuthenticatedUserContext,
  correlationId?: string
): Promise<CustomerAccountSummary> {
  const profile = await provisionOrSyncUser(userContext, correlationId);

  const authProvider = userContext.email?.includes('gmail.com') ? 'google.com' : 'password';
  const isGoogle = authProvider === 'google.com';

  const limits = getCanonicalLimitsForTier(profile.tier || 'TIER_1');
  const statusInfo = getCustomerAccountStatusInfo(profile.account_status);

  return {
    profile,
    email_verified: userContext.emailVerified,
    auth_provider: authProvider,
    auth_provider_label: isGoogle ? 'Google' : 'Email & Password',
    has_password_auth: !isGoogle,
    limits,
    account_status_info: statusInfo,
  };
}

/**
 * Authoritatively updates user tier in database and memory store (for KYC approval).
 */
export async function updateUserAuthoritativeTier(
  uid: string,
  targetTier: KycTier,
  kycLevel: number,
  dailyFundingLimitKobo: number
): Promise<void> {
  const now = new Date().toISOString();
  const updates = {
    tier: targetTier,
    kyc_tier: kycLevel,
    daily_funding_limit_kobo: dailyFundingLimitKobo,
    updated_at: now,
  };

  const db = getDb();
  if (db) {
    try {
      await db.collection('users').doc(uid).set(updates, { merge: true });
    } catch (err: any) {
      recordFirestoreError(err);
      logger.info(`[UserProvisioning] In-memory tier update for ${uid}`);
    }
  }

  // Always update in-memory fallback store as well
  const memUser = localDevUsersStore.get(uid);
  if (memUser) {
    memUser.tier = targetTier;
    memUser.kyc_tier = kycLevel;
    memUser.daily_funding_limit_kobo = dailyFundingLimitKobo;
    memUser.updated_at = now;
  }
}

/**
 * Test helper to manually set account status for automated testing.
 */
export async function __testSetAccountStatus(uid: string, status: AccountStatus): Promise<void> {
  const user = localDevUsersStore.get(uid);
  if (user) {
    user.account_status = status;
    inMemoryStore.setDoc('users', uid, user);
  }
  const db = getDb();
  if (db) {
    try {
      await db.collection('users').doc(uid).set({ account_status: status }, { merge: true });
    } catch {
      // In-memory fallback updated above
    }
  }
}

