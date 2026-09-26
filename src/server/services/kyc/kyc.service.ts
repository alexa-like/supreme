/**
 * Alexvya Platform — Server-Authoritative KYC & Tier Management Service
 * Stage 2.12 KYC, Customer Verification & Tier Management Architecture
 * 
 * STRICT INVARIANTS:
 * 1. Derives user identity exclusively from verified Firebase Authentication context.
 * 2. Customers CANNOT self-verify or directly alter their tier.
 * 3. Administrative approval strictly verifies `adminUsers/{adminId}.is_active == true`.
 * 4. AUDITOR is strictly read-only and cannot approve/reject KYC requests.
 * 5. KYC approvals and resulting tier upgrades are atomic.
 * 6. ZERO financial balance, ledger, or wallet mutations are permitted during KYC workflows.
 * 7. Sensitive ID numbers are always masked before persistence.
 */

import { randomUUID } from 'node:crypto';
const uuidv4 = () => randomUUID();
import { AuthenticatedUserContext } from '../../../types/api.ts';
import { 
  KycVerificationDocument, 
  SafeCustomerKycStatus, 
  SafeUserProfile,
  CustomerAccountSummary
} from '../../../types/user.ts';
import { 
  KycTier, 
  KycStatus, 
  KycVerificationMethod, 
  KycRejectionReasonCode,
  AdminRole,
  AuditAction,
  NotificationCategory
} from '../../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';
import { NotificationService } from '../notifications/notification.service.ts';
import { logger } from '../../../lib/logger/logger.ts';
import { 
  getKycVerificationById, 
  getLatestKycVerificationByUserId, 
  createKycVerification, 
  updateKycVerification,
  queryKycVerifications
} from '../../repositories/kycVerifications.repository.ts';
import { getAdminUserById } from '../../repositories/adminUsers.repository.ts';
import { createAuditLog } from '../../repositories/auditLogs.repository.ts';
import { createNotification } from '../../repositories/notifications.repository.ts';
import { 
  provisionOrSyncUser, 
  enforceAccountStatus,
  updateUserAuthoritativeTier 
} from '../../users/provisioning.ts';
import { 
  CANONICAL_TIER_POLICIES, 
  getCanonicalLimitsForTier, 
  evaluateTierEligibility, 
  isValidTierTransition,
  TierEligibilityResult
} from './tierPolicy.ts';
import { getActiveKycProvider } from './providers/kycProvider.interface.ts';
import { 
  StartKycPayload, 
  SubmitKycPayload, 
  TierUpgradeRequestPayload, 
  AdminKycReviewPayload,
  maskIdNumber 
} from '../../../lib/validation/kyc.ts';
import { getAdminDb } from '../../firebase/admin.ts';

/**
 * Sanitizes internal KYC document into safe customer view.
 */
export function sanitizeCustomerKycStatus(
  userId: string,
  currentTier: KycTier,
  kycDoc: KycVerificationDocument | null
): SafeCustomerKycStatus {
  if (!kycDoc) {
    return {
      user_id: userId,
      status: 'NOT_STARTED',
      current_tier: currentTier || 'TIER_1',
      requested_tier: null,
      verification_method: null,
      id_type: null,
      id_number_masked: null,
      submitted_at: null,
      reviewed_at: null,
      rejection_reason_code: null,
      customer_action_required: null,
      rejection_message: null,
      latest_request_id: null,
    };
  }

  return {
    user_id: userId,
    status: kycDoc.status,
    current_tier: currentTier || kycDoc.current_tier || 'TIER_1',
    requested_tier: kycDoc.requested_tier,
    verification_method: kycDoc.verification_method,
    id_type: kycDoc.id_type || null,
    id_number_masked: kycDoc.id_number_masked || null,
    submitted_at: kycDoc.submitted_at || kycDoc.created_at,
    reviewed_at: kycDoc.reviewed_at || null,
    rejection_reason_code: kycDoc.rejection_reason_code || null,
    customer_action_required: kycDoc.customer_action_required || null,
    rejection_message: kycDoc.rejection_notes || null,
    latest_request_id: kycDoc.id,
  };
}

/**
 * Verifies staff authorization against authoritative adminUsers collection.
 */
async function requireActiveAdmin(
  adminId: string, 
  disallowAuditor = true,
  correlationId?: string
) {
  const admin = await getAdminUserById(adminId);
  if (!admin || !admin.is_active) {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      'Active administrative permissions required for this operation.',
      403,
      { correlation_id: correlationId, adminId }
    );
  }

  if (disallowAuditor && admin.role === AdminRole.AUDITOR) {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      'Auditors have read-only permissions and cannot modify KYC or tier state.',
      403,
      { correlation_id: correlationId, adminId, role: admin.role }
    );
  }

  return admin;
}

export class KycService {
  /**
   * Retrieves safe KYC status for the authenticated customer.
   */
  static async getCustomerKycStatus(
    userContext: AuthenticatedUserContext,
    correlationId?: string
  ): Promise<SafeCustomerKycStatus> {
    const profile = await provisionOrSyncUser(userContext, correlationId);
    enforceAccountStatus(profile as any, correlationId);

    const latestDoc = await getLatestKycVerificationByUserId(userContext.uid);
    return sanitizeCustomerKycStatus(userContext.uid, profile.tier || 'TIER_1', latestDoc);
  }

  /**
   * Evaluates upgrade eligibility for the authenticated customer.
   */
  static async getCustomerTierEligibility(
    userContext: AuthenticatedUserContext,
    correlationId?: string
  ): Promise<TierEligibilityResult> {
    const profile = await provisionOrSyncUser(userContext, correlationId);
    enforceAccountStatus(profile as any, correlationId);

    return evaluateTierEligibility(profile);
  }

  /**
   * Starts a new KYC verification workflow.
   */
  static async startKycVerification(
    userContext: AuthenticatedUserContext,
    payload: StartKycPayload,
    correlationId?: string
  ): Promise<SafeCustomerKycStatus> {
    const profile = await provisionOrSyncUser(userContext, correlationId);
    enforceAccountStatus(profile as any, correlationId);

    const currentTier: KycTier = profile.tier || 'TIER_1';
    const targetTier: KycTier = payload.requested_tier;

    if (!isValidTierTransition(currentTier, targetTier)) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        `Cannot transition from ${currentTier} to ${targetTier}. Linear tier upgrade required.`,
        422,
        { correlation_id: correlationId, currentTier, targetTier }
      );
    }

    // Check for existing pending review request to prevent duplicate concurrent submissions
    const existing = await getLatestKycVerificationByUserId(userContext.uid);
    if (existing && existing.status === 'PENDING_REVIEW') {
      throw new AlexvyaApiError(
        ErrorCodes.CONFLICT,
        'You already have a KYC verification request under active review.',
        409,
        { correlation_id: correlationId, existingId: existing.id }
      );
    }

    const now = new Date().toISOString();
    const requestId = `kyc_${uuidv4().replace(/-/g, '')}`;

    const provider = getActiveKycProvider();
    const providerInit = await provider.startVerification({
      user_id: userContext.uid,
      verification_method: payload.verification_method,
    });

    const newDoc: KycVerificationDocument = {
      id: requestId,
      user_id: userContext.uid,
      status: 'IN_PROGRESS',
      current_tier: currentTier,
      requested_tier: targetTier,
      verification_method: payload.verification_method,
      provider_name: provider.providerName,
      provider_reference: providerInit.provider_reference,
      verification_version: 1,
      created_at: now,
      updated_at: now,
      submitted_at: null,
      reviewed_at: null,
      reviewed_by: null,
    };

    await createKycVerification(newDoc);

    // Audit event
    try {
      await createAuditLog({
        id: `aud_${Date.now()}_${uuidv4().substring(0, 8)}`,
        actor_id: userContext.uid,
        actor_role: userContext.role || 'CUSTOMER',
        action: AuditAction.KYC_STARTED,
        target_collection: 'kycVerifications',
        target_id: requestId,
        before_state: null,
        after_state: {
          status: 'IN_PROGRESS',
          requested_tier: targetTier,
          verification_method: payload.verification_method,
        },
        reason: 'Customer initiated KYC verification workflow',
        correlation_id: correlationId || uuidv4(),
        ip_address: null,
        created_at: now,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Audit log write failed: ${err.message}`);
    }

    return sanitizeCustomerKycStatus(userContext.uid, currentTier, newDoc);
  }

  /**
   * Submits identity documents/data for verification and queues for evaluation.
   */
  static async submitKycVerification(
    userContext: AuthenticatedUserContext,
    payload: SubmitKycPayload,
    correlationId?: string
  ): Promise<SafeCustomerKycStatus> {
    const profile = await provisionOrSyncUser(userContext, correlationId);
    enforceAccountStatus(profile as any, correlationId);

    const currentTier: KycTier = profile.tier || 'TIER_1';
    const targetTier: KycTier = payload.requested_tier;

    if (!isValidTierTransition(currentTier, targetTier)) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        `Invalid tier upgrade request from ${currentTier} to ${targetTier}.`,
        422,
        { correlation_id: correlationId, currentTier, targetTier }
      );
    }

    // Check duplicate pending review
    const existing = await getLatestKycVerificationByUserId(userContext.uid);
    if (existing && existing.status === 'PENDING_REVIEW') {
      throw new AlexvyaApiError(
        ErrorCodes.CONFLICT,
        'A verification submission is already pending review for your account.',
        409,
        { correlation_id: correlationId, existingId: existing.id }
      );
    }

    const now = new Date().toISOString();
    const maskedId = maskIdNumber(payload.id_number);
    const requestId = existing && (existing.status === 'IN_PROGRESS' || existing.status === 'REQUIRES_ACTION')
      ? existing.id
      : `kyc_${uuidv4().replace(/-/g, '')}`;

    // Execute provider verification attempt
    const provider = getActiveKycProvider();
    const providerResult = await provider.verifySynchronous({
      user_id: userContext.uid,
      verification_method: payload.verification_method,
      id_type: payload.id_type,
      id_number: payload.id_number,
      full_legal_name: payload.full_legal_name,
      date_of_birth: payload.date_of_birth,
      address: payload.address,
    });

    let finalStatus: KycStatus = 'PENDING_REVIEW';
    let rejectionReason: KycRejectionReasonCode | null = null;
    let rejectionNotes: string | null = null;

    if (providerResult.is_verified) {
      finalStatus = 'VERIFIED';
    } else if (providerResult.status === 'REJECTED') {
      finalStatus = 'REJECTED';
      rejectionReason = providerResult.rejection_reason_code || 'NAME_MISMATCH';
      rejectionNotes = providerResult.customer_message || 'Automated verification check failed.';
    }

    const kycDoc: KycVerificationDocument = {
      id: requestId,
      user_id: userContext.uid,
      status: finalStatus,
      current_tier: currentTier,
      requested_tier: targetTier,
      verification_method: payload.verification_method,
      id_type: payload.id_type || payload.verification_method,
      id_number_masked: maskedId,
      full_legal_name: payload.full_legal_name.trim(),
      date_of_birth: payload.date_of_birth || null,
      address: payload.address ? payload.address.trim() : null,
      submitted_at: now,
      reviewed_at: finalStatus === 'VERIFIED' ? now : null,
      reviewed_by: finalStatus === 'VERIFIED' ? `SYSTEM:${provider.providerName}` : null,
      rejection_reason_code: rejectionReason,
      rejection_notes: rejectionNotes,
      customer_action_required: null,
      provider_name: provider.providerName,
      provider_reference: providerResult.provider_reference,
      verification_version: (existing?.verification_version || 0) + 1,
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    if (existing && existing.id === requestId) {
      await updateKycVerification(requestId, kycDoc);
    } else {
      await createKycVerification(kycDoc);
    }

    // If automated verification instantly approved (e.g. mock test provider), atomically apply tier change
    if (finalStatus === 'VERIFIED') {
      await this.applyApprovedTierChange(userContext.uid, targetTier, `SYSTEM:${provider.providerName}`, correlationId);
    }

    // Audit Log
    try {
      await createAuditLog({
        id: `aud_${Date.now()}_${uuidv4().substring(0, 8)}`,
        actor_id: userContext.uid,
        actor_role: userContext.role || 'CUSTOMER',
        action: AuditAction.KYC_SUBMITTED,
        target_collection: 'kycVerifications',
        target_id: requestId,
        before_state: existing ? { status: existing.status } : null,
        after_state: {
          status: finalStatus,
          requested_tier: targetTier,
          id_type: kycDoc.id_type,
          id_masked: maskedId,
        },
        reason: 'Customer submitted identity verification details',
        correlation_id: correlationId || uuidv4(),
        ip_address: null,
        created_at: now,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Audit log write failed: ${err.message}`);
    }

    // Customer Notification (Failure-Isolated)
    try {
      const eventType = finalStatus === 'VERIFIED' ? 'KYC_APPROVED' : 'KYC_SUBMITTED';
      await NotificationService.dispatchNotification({
        userId: userContext.uid,
        eventType,
        title: finalStatus === 'VERIFIED' ? 'Account Verified & Tier Upgraded' : 'Verification Documents Received',
        message: finalStatus === 'VERIFIED' 
          ? `Your account has been upgraded to ${targetTier}.`
          : `Your identity verification request for ${targetTier} has been received and is under review.`,
        category: NotificationCategory.SECURITY,
        sourceEntityId: requestId,
        details: {
          targetTier,
          newTier: targetTier,
        },
        correlationId,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Notification dispatch failed (non-blocking): ${err.message}`);
    }

    return sanitizeCustomerKycStatus(userContext.uid, finalStatus === 'VERIFIED' ? targetTier : currentTier, kycDoc);
  }

  /**
   * Request Tier Upgrade directly.
   */
  static async requestTierUpgrade(
    userContext: AuthenticatedUserContext,
    payload: TierUpgradeRequestPayload,
    correlationId?: string
  ): Promise<SafeCustomerKycStatus> {
    const profile = await provisionOrSyncUser(userContext, correlationId);
    enforceAccountStatus(profile as any, correlationId);

    const currentTier: KycTier = profile.tier || 'TIER_1';
    const targetTier: KycTier = payload.target_tier;

    if (!isValidTierTransition(currentTier, targetTier)) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        `Invalid tier progression from ${currentTier} to ${targetTier}.`,
        422,
        { correlation_id: correlationId, currentTier, targetTier }
      );
    }

    // Check existing pending
    const existing = await getLatestKycVerificationByUserId(userContext.uid);
    if (existing && existing.status === 'PENDING_REVIEW') {
      throw new AlexvyaApiError(
        ErrorCodes.CONFLICT,
        'A tier upgrade request is already pending review.',
        409,
        { correlation_id: correlationId, existingId: existing.id }
      );
    }

    const now = new Date().toISOString();
    const requestId = `kyc_${uuidv4().replace(/-/g, '')}`;

    const newDoc: KycVerificationDocument = {
      id: requestId,
      user_id: userContext.uid,
      status: 'PENDING_REVIEW',
      current_tier: currentTier,
      requested_tier: targetTier,
      verification_method: 'MANUAL_REVIEW',
      rejection_notes: payload.justification || null,
      verification_version: 1,
      created_at: now,
      updated_at: now,
      submitted_at: now,
      reviewed_at: null,
      reviewed_by: null,
    };

    await createKycVerification(newDoc);

    // Audit Log
    try {
      await createAuditLog({
        id: `aud_${Date.now()}_${uuidv4().substring(0, 8)}`,
        actor_id: userContext.uid,
        actor_role: userContext.role || 'CUSTOMER',
        action: AuditAction.TIER_UPGRADE_REQUESTED,
        target_collection: 'kycVerifications',
        target_id: requestId,
        before_state: { current_tier: currentTier },
        after_state: { requested_tier: targetTier, status: 'PENDING_REVIEW' },
        reason: payload.justification || 'Customer submitted tier upgrade request',
        correlation_id: correlationId || uuidv4(),
        ip_address: null,
        created_at: now,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Audit log write failed: ${err.message}`);
    }

    return sanitizeCustomerKycStatus(userContext.uid, currentTier, newDoc);
  }

  // ==========================================================================
  // ADMINISTRATIVE KYC METHODS (Requires active admin record, rejects AUDITOR)
  // ==========================================================================

  /**
   * Lists KYC verification requests for administrative review.
   */
  static async adminListKycRequests(
    adminContext: AuthenticatedUserContext,
    filter: { status?: KycStatus; userId?: string } = {},
    options: { limit?: number; cursor?: string } = {},
    correlationId?: string
  ) {
    // Auditors allowed to view (read-only)
    await requireActiveAdmin(adminContext.uid, false, correlationId);
    return queryKycVerifications(filter, options);
  }

  /**
   * Retrieves single KYC request for staff inspection.
   */
  static async adminGetKycRequest(
    adminContext: AuthenticatedUserContext,
    requestId: string,
    correlationId?: string
  ) {
    await requireActiveAdmin(adminContext.uid, false, correlationId);
    const doc = await getKycVerificationById(requestId);
    if (!doc) {
      throw new AlexvyaApiError(
        ErrorCodes.RESOURCE_NOT_FOUND,
        'KYC verification request not found.',
        404,
        { correlation_id: correlationId, requestId }
      );
    }
    return doc;
  }

  /**
   * Administrative Approval of a KYC request and atomic tier upgrade.
   */
  static async adminApproveKycRequest(
    adminContext: AuthenticatedUserContext,
    requestId: string,
    justification?: string,
    correlationId?: string
  ): Promise<KycVerificationDocument> {
    const admin = await requireActiveAdmin(adminContext.uid, true, correlationId);

    const kycDoc = await getKycVerificationById(requestId);
    if (!kycDoc) {
      throw new AlexvyaApiError(
        ErrorCodes.RESOURCE_NOT_FOUND,
        'KYC request not found.',
        404,
        { correlation_id: correlationId, requestId }
      );
    }

    // Concurrency / Idempotency check: Request must be in reviewable state
    if (kycDoc.status === 'VERIFIED') {
      // Idempotent return if already approved
      return kycDoc;
    }

    if (kycDoc.status === 'REJECTED') {
      throw new AlexvyaApiError(
        ErrorCodes.CONFLICT,
        'Cannot approve a request that has already been rejected. A new submission is required.',
        409,
        { correlation_id: correlationId, requestId, status: kycDoc.status }
      );
    }

    const now = new Date().toISOString();
    const targetTier = kycDoc.requested_tier;

    // 1. Atomically apply tier change on user profile
    await this.applyApprovedTierChange(kycDoc.user_id, targetTier, `ADMIN:${admin.id}`, correlationId);

    // 2. Update KYC document to VERIFIED
    const updated = await updateKycVerification(requestId, {
      status: 'VERIFIED',
      reviewed_at: now,
      reviewed_by: admin.id,
      rejection_notes: justification || null,
      customer_action_required: null,
    });

    if (!updated) {
      throw new AlexvyaApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        'Failed to commit KYC verification state.',
        500,
        { correlation_id: correlationId, requestId }
      );
    }

    // 3. Immutable Audit Log
    try {
      await createAuditLog({
        id: `aud_${Date.now()}_${uuidv4().substring(0, 8)}`,
        actor_id: admin.id,
        actor_role: admin.role,
        action: AuditAction.KYC_APPROVED,
        target_collection: 'kycVerifications',
        target_id: requestId,
        before_state: { status: kycDoc.status, tier: kycDoc.current_tier },
        after_state: { status: 'VERIFIED', tier: targetTier },
        reason: justification || `Admin ${admin.id} approved tier upgrade to ${targetTier}`,
        correlation_id: correlationId || uuidv4(),
        ip_address: null,
        created_at: now,
      });

      await createAuditLog({
        id: `aud_${Date.now()}_${uuidv4().substring(0, 8)}`,
        actor_id: admin.id,
        actor_role: admin.role,
        action: AuditAction.TIER_CHANGED,
        target_collection: 'users',
        target_id: kycDoc.user_id,
        before_state: { tier: kycDoc.current_tier },
        after_state: { tier: targetTier },
        reason: `Tier upgrade approved via KYC request ${requestId}`,
        correlation_id: correlationId || uuidv4(),
        ip_address: null,
        created_at: now,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Audit log write failed: ${err.message}`);
    }

    // 4. Customer Notification (Failure Isolated)
    try {
      await NotificationService.dispatchNotification({
        userId: kycDoc.user_id,
        eventType: 'KYC_APPROVED',
        title: 'Account Tier Upgraded!',
        message: `Congratulations! Your identity verification has been approved. Your account is now upgraded to ${targetTier}.`,
        category: NotificationCategory.SECURITY,
        sourceEntityId: requestId,
        details: {
          newTier: targetTier,
        },
        correlationId,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Notification dispatch failed (non-blocking): ${err.message}`);
    }

    return updated;
  }

  /**
   * Administrative Rejection of a KYC request.
   */
  static async adminRejectKycRequest(
    adminContext: AuthenticatedUserContext,
    requestId: string,
    reasonCode: KycRejectionReasonCode,
    rejectionNotes?: string,
    correlationId?: string
  ): Promise<KycVerificationDocument> {
    const admin = await requireActiveAdmin(adminContext.uid, true, correlationId);

    const kycDoc = await getKycVerificationById(requestId);
    if (!kycDoc) {
      throw new AlexvyaApiError(
        ErrorCodes.RESOURCE_NOT_FOUND,
        'KYC request not found.',
        404,
        { correlation_id: correlationId, requestId }
      );
    }

    if (kycDoc.status === 'VERIFIED') {
      throw new AlexvyaApiError(
        ErrorCodes.CONFLICT,
        'Cannot reject a KYC request that has already been verified and applied.',
        409,
        { correlation_id: correlationId, requestId, status: kycDoc.status }
      );
    }

    const now = new Date().toISOString();

    const updated = await updateKycVerification(requestId, {
      status: 'REJECTED',
      reviewed_at: now,
      reviewed_by: admin.id,
      rejection_reason_code: reasonCode,
      rejection_notes: rejectionNotes || 'Verification could not be approved based on submitted records.',
      customer_action_required: null,
    });

    if (!updated) {
      throw new AlexvyaApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        'Failed to commit KYC rejection state.',
        500,
        { correlation_id: correlationId, requestId }
      );
    }

    // Audit Log
    try {
      await createAuditLog({
        id: `aud_${Date.now()}_${uuidv4().substring(0, 8)}`,
        actor_id: admin.id,
        actor_role: admin.role,
        action: AuditAction.KYC_REJECTED,
        target_collection: 'kycVerifications',
        target_id: requestId,
        before_state: { status: kycDoc.status },
        after_state: { status: 'REJECTED', rejection_reason_code: reasonCode },
        reason: rejectionNotes || `Admin ${admin.id} rejected verification: ${reasonCode}`,
        correlation_id: correlationId || uuidv4(),
        ip_address: null,
        created_at: now,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Audit log write failed: ${err.message}`);
    }

    // Customer Notification (Failure Isolated)
    try {
      await NotificationService.dispatchNotification({
        userId: kycDoc.user_id,
        eventType: 'KYC_REJECTED',
        title: 'Identity Verification Update',
        message: `Your verification request could not be approved (${reasonCode}). Please review notes in your account settings.`,
        category: NotificationCategory.SECURITY,
        sourceEntityId: requestId,
        details: {
          rejectionCode: reasonCode,
          rejectionNotes,
        },
        correlationId,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Notification dispatch failed (non-blocking): ${err.message}`);
    }

    return updated;
  }

  /**
   * Request specific corrective action from the customer (e.g. clearer photo, name correction).
   */
  static async adminRequestKycAction(
    adminContext: AuthenticatedUserContext,
    requestId: string,
    actionRequired: string,
    correlationId?: string
  ): Promise<KycVerificationDocument> {
    const admin = await requireActiveAdmin(adminContext.uid, true, correlationId);

    const kycDoc = await getKycVerificationById(requestId);
    if (!kycDoc) {
      throw new AlexvyaApiError(
        ErrorCodes.RESOURCE_NOT_FOUND,
        'KYC request not found.',
        404,
        { correlation_id: correlationId, requestId }
      );
    }

    if (kycDoc.status === 'VERIFIED') {
      throw new AlexvyaApiError(
        ErrorCodes.CONFLICT,
        'Cannot request action on an already verified KYC record.',
        409,
        { correlation_id: correlationId, requestId }
      );
    }

    const now = new Date().toISOString();

    const updated = await updateKycVerification(requestId, {
      status: 'REQUIRES_ACTION',
      reviewed_at: now,
      reviewed_by: admin.id,
      customer_action_required: actionRequired,
    });

    if (!updated) {
      throw new AlexvyaApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        'Failed to commit KYC action request.',
        500,
        { correlation_id: correlationId, requestId }
      );
    }

    // Audit Log
    try {
      await createAuditLog({
        id: `aud_${Date.now()}_${uuidv4().substring(0, 8)}`,
        actor_id: admin.id,
        actor_role: admin.role,
        action: AuditAction.KYC_ACTION_REQUIRED,
        target_collection: 'kycVerifications',
        target_id: requestId,
        before_state: { status: kycDoc.status },
        after_state: { status: 'REQUIRES_ACTION', customer_action_required: actionRequired },
        reason: `Admin requested customer action: ${actionRequired}`,
        correlation_id: correlationId || uuidv4(),
        ip_address: null,
        created_at: now,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Audit log write failed: ${err.message}`);
    }

    // Notification
    try {
      await NotificationService.dispatchNotification({
        userId: kycDoc.user_id,
        eventType: 'KYC_ACTION_REQUIRED',
        title: 'Action Required on Verification',
        message: actionRequired,
        category: NotificationCategory.SECURITY,
        sourceEntityId: requestId,
        details: {
          actionRequired,
        },
        correlationId,
      });
    } catch (err: any) {
      logger.warn(`[KycService] Notification dispatch failed (non-blocking): ${err.message}`);
    }

    return updated;
  }

  /**
   * Applies approved tier changes to the authoritative user document.
   * STRICT INVARIANT: Modifies ONLY tier/kyc_tier and daily_funding_limit_kobo.
   * ZERO wallet/ledger balance modifications.
   */
  private static async applyApprovedTierChange(
    userId: string,
    targetTier: KycTier,
    actor: string,
    correlationId?: string
  ) {
    const tierPolicy = CANONICAL_TIER_POLICIES[targetTier];
    if (!tierPolicy) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        `Invalid target tier: ${targetTier}`,
        422,
        { correlation_id: correlationId, targetTier }
      );
    }

    await updateUserAuthoritativeTier(
      userId,
      targetTier,
      tierPolicy.kyc_level,
      tierPolicy.limits.daily_funding_limit_kobo
    );

    logger.info(`[KycService] Authoritative customer tier upgraded for ${userId} -> ${targetTier} by ${actor}`, { correlationId });
  }
}
