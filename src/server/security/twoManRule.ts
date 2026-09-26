/**
 * Alexvya Platform — Two-Man Rule Enforcement Engine
 * Stage 2.5.6 Financial Security Hardening
 * 
 * Strict Invariants:
 * 1. Configurable threshold: Default ₦10,000.00 (1,000,000 kobo).
 * 2. High-risk actions above threshold REQUIRE two distinct active staff members (initiator + approver).
 * 3. Self-approval is strictly forbidden (initiator !== approver).
 * 4. Justification is mandatory.
 */

import { verifyIsActiveAdmin } from '../repositories/adminUsers.repository.ts';
import { IntegerKobo } from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

export const TWO_MAN_RULE_CONFIG = {
  DEFAULT_THRESHOLD_KOBO: 1000000, // ₦10,000.00
  MIN_JUSTIFICATION_LENGTH: 10,
} as const;

export interface TwoManApprovalParams {
  initiatorAdminId: string;
  approverAdminId?: string;
  amountKobo: IntegerKobo;
  thresholdKobo?: IntegerKobo;
  justification: string;
  actionName: string;
  correlationId?: string;
}

/**
 * Validates whether an administrative financial operation satisfies the Two-Man Rule.
 */
export async function validateTwoManApproval(params: TwoManApprovalParams): Promise<{ requiresTwoMan: boolean; approved: boolean }> {
  const {
    initiatorAdminId,
    approverAdminId,
    amountKobo,
    thresholdKobo = TWO_MAN_RULE_CONFIG.DEFAULT_THRESHOLD_KOBO,
    justification,
    actionName,
    correlationId,
  } = params;

  if (!justification || justification.trim().length < TWO_MAN_RULE_CONFIG.MIN_JUSTIFICATION_LENGTH) {
    throw new AlexvyaApiError(
      ErrorCodes.INVALID_INPUT,
      `Administrative action '${actionName}' requires a valid justification of at least ${TWO_MAN_RULE_CONFIG.MIN_JUSTIFICATION_LENGTH} characters.`,
      400,
      { justification, correlation_id: correlationId }
    );
  }

  const isInitiatorActive = await verifyIsActiveAdmin(initiatorAdminId);
  if (!isInitiatorActive) {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      `Initiator '${initiatorAdminId}' is not an active administrative staff member.`,
      403,
      { initiator_admin_id: initiatorAdminId, correlation_id: correlationId }
    );
  }

  const requiresTwoMan = amountKobo >= thresholdKobo;

  if (requiresTwoMan) {
    if (!approverAdminId) {
      throw new AlexvyaApiError(
        ErrorCodes.TWO_MAN_RULE_REQUIRED,
        `Action '${actionName}' for ${amountKobo} kobo (₦${amountKobo / 100}) meets or exceeds the two-man threshold (${thresholdKobo} kobo / ₦${thresholdKobo / 100}). A secondary active admin approval is required.`,
        403,
        {
          amount_kobo: amountKobo,
          threshold_kobo: thresholdKobo,
          action_name: actionName,
          correlation_id: correlationId,
        }
      );
    }

    if (initiatorAdminId === approverAdminId) {
      throw new AlexvyaApiError(
        ErrorCodes.FORBIDDEN,
        `Two-man rule violation: Self-approval is strictly forbidden. The approver must be a distinct administrative staff member.`,
        403,
        {
          initiator_admin_id: initiatorAdminId,
          approver_admin_id: approverAdminId,
          correlation_id: correlationId,
        }
      );
    }

    const isApproverActive = await verifyIsActiveAdmin(approverAdminId);
    if (!isApproverActive) {
      throw new AlexvyaApiError(
        ErrorCodes.FORBIDDEN,
        `Secondary approver '${approverAdminId}' is not an active administrative staff member.`,
        403,
        { approver_admin_id: approverAdminId, correlation_id: correlationId }
      );
    }

    logger.info(
      `[TwoManRule] Approved '${actionName}' (${amountKobo} kobo) by initiator ${initiatorAdminId} and secondary approver ${approverAdminId}`,
      { justification },
      correlationId
    );
  }

  return {
    requiresTwoMan,
    approved: true,
  };
}
