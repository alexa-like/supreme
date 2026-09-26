/**
 * Alexvya Platform — Authoritative Role Matrix & Permissions
 * Stage 2.5.6 Financial Security Hardening & Abuse Protection
 * 
 * Strict Invariants:
 * 1. Authoritative Roles: CUSTOMER, ADMIN, SUPER_ADMIN, AUDITOR, SYSTEM.
 * 2. AUDITOR is strictly read-only: zero financial or state mutation privileges.
 * 3. CUSTOMER is restricted strictly to own account resources (IDOR protection).
 * 4. ADMIN and SUPER_ADMIN require active database record in adminUsers/{uid}.
 * 5. SYSTEM is reserved for internal machine/scheduler tasks and cannot be claimed via client input.
 */

import { UserRole } from '../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';

export const VALID_ROLES = [
  UserRole.CUSTOMER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.AUDITOR,
  UserRole.SYSTEM,
] as const;

export type ValidRole = (typeof VALID_ROLES)[number];

export interface RolePermissions {
  canReadOwnWallet: boolean;
  canReadOwnLedger: boolean;
  canPerformCustomerPurchases: boolean;
  canReadSystemLedgers: boolean;
  canReadAuditLogs: boolean;
  canInitiateRefunds: boolean;
  canApproveTwoManActions: boolean;
  canManageStaffRoles: boolean;
  canPerformFinancialMutations: boolean;
}

export const ROLE_PERMISSIONS_MATRIX: Record<ValidRole, RolePermissions> = {
  [UserRole.CUSTOMER]: {
    canReadOwnWallet: true,
    canReadOwnLedger: true,
    canPerformCustomerPurchases: true,
    canReadSystemLedgers: false,
    canReadAuditLogs: false,
    canInitiateRefunds: false,
    canApproveTwoManActions: false,
    canManageStaffRoles: false,
    canPerformFinancialMutations: true, // only within authorized business purchase/funding context
  },
  [UserRole.AUDITOR]: {
    canReadOwnWallet: false,
    canReadOwnLedger: false,
    canPerformCustomerPurchases: false,
    canReadSystemLedgers: true,
    canReadAuditLogs: true,
    canInitiateRefunds: false,
    canApproveTwoManActions: false,
    canManageStaffRoles: false,
    canPerformFinancialMutations: false, // AUDITOR IS STRICTLY READ-ONLY
  },
  [UserRole.ADMIN]: {
    canReadOwnWallet: false,
    canReadOwnLedger: false,
    canPerformCustomerPurchases: false,
    canReadSystemLedgers: true,
    canReadAuditLogs: true,
    canInitiateRefunds: true,
    canApproveTwoManActions: true,
    canManageStaffRoles: false,
    canPerformFinancialMutations: true, // admin-initiated compensating adjustments / refunds
  },
  [UserRole.SUPER_ADMIN]: {
    canReadOwnWallet: false,
    canReadOwnLedger: false,
    canPerformCustomerPurchases: false,
    canReadSystemLedgers: true,
    canReadAuditLogs: true,
    canInitiateRefunds: true,
    canApproveTwoManActions: true,
    canManageStaffRoles: true,
    canPerformFinancialMutations: true,
  },
  [UserRole.SYSTEM]: {
    canReadOwnWallet: false,
    canReadOwnLedger: false,
    canPerformCustomerPurchases: false,
    canReadSystemLedgers: true,
    canReadAuditLogs: true,
    canInitiateRefunds: true,
    canApproveTwoManActions: false,
    canManageStaffRoles: false,
    canPerformFinancialMutations: true,
  },
};

/**
 * Validates that an asserted role is valid and allowed in the platform.
 */
export function isValidRole(role: unknown): role is ValidRole {
  return typeof role === 'string' && VALID_ROLES.includes(role as ValidRole);
}

/**
 * Asserts that the role is permitted to perform financial mutations.
 * Throws FORBIDDEN if the role is AUDITOR or another unauthorized role.
 */
export function assertFinancialMutationPermission(role: string, correlationId?: string): void {
  if (!isValidRole(role)) {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      `Invalid or unassigned user role: ${role}`,
      403,
      { role, correlation_id: correlationId }
    );
  }

  const permissions = ROLE_PERMISSIONS_MATRIX[role];
  if (!permissions.canPerformFinancialMutations) {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      `Role '${role}' is strictly read-only and is forbidden from executing financial mutations.`,
      403,
      { role, correlation_id: correlationId }
    );
  }
}

/**
 * Asserts that the actor is authorized to perform privileged staff operations.
 */
export function assertAdminRole(role: string, requiredRole: ValidRole = UserRole.ADMIN, correlationId?: string): void {
  if (role === UserRole.SUPER_ADMIN) {
    return; // Super admin possesses all admin privileges
  }

  if (role !== requiredRole) {
    throw new AlexvyaApiError(
      ErrorCodes.FORBIDDEN,
      `Administrative access denied. Requires '${requiredRole}' role (current role: '${role}').`,
      403,
      { required_role: requiredRole, current_role: role, correlation_id: correlationId }
    );
  }
}
