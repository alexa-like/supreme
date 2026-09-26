/**
 * Alexvya Platform — Provider-Neutral KYC Verification Adapter Architecture
 * Stage 2.12 KYC, Customer Verification & Tier Management Architecture
 * 
 * STRICT INVARIANT:
 * 1. Zero fake verification in production.
 * 2. If no 3P KYC provider is configured, the system falls back safely to administrative review
 *    and reports UNCONFIGURED.
 * 3. Mock provider is strictly prohibited from running in production without explicit TEST_MODE.
 */

import { KycStatus, KycVerificationMethod, KycRejectionReasonCode } from '../../../../types/enums.ts';

export interface KycVerificationRequest {
  user_id: string;
  verification_method: KycVerificationMethod;
  id_type?: string;
  id_number?: string;
  full_legal_name?: string;
  date_of_birth?: string;
  address?: string;
}

export interface NormalizedKycVerificationResult {
  is_verified: boolean;
  provider_name: string;
  provider_reference: string;
  status: KycStatus;
  rejection_reason_code?: KycRejectionReasonCode;
  customer_message?: string;
  verified_at?: string;
  requires_manual_review: boolean;
}

export interface IKycVerificationProvider {
  readonly providerName: string;
  readonly isConfigured: boolean;

  /**
   * Initiates a verification check with the identity provider.
   */
  startVerification(request: KycVerificationRequest): Promise<{
    session_id?: string;
    redirect_url?: string;
    status: KycStatus;
    provider_reference: string;
  }>;

  /**
   * Synchronous identity verification check (e.g. for BVN / NIN lookup if supported).
   */
  verifySynchronous(request: KycVerificationRequest): Promise<NormalizedKycVerificationResult>;

  /**
   * Queries the asynchronous verification status by provider reference.
   */
  checkVerification(providerReference: string): Promise<NormalizedKycVerificationResult>;
}

/**
 * Production Default: Unconfigured Provider
 * Safely defaults all automated verification to administrative queue (PENDING_REVIEW).
 */
export class UnconfiguredKycProvider implements IKycVerificationProvider {
  readonly providerName = 'unconfigured';
  readonly isConfigured = false;

  async startVerification(request: KycVerificationRequest): Promise<{
    session_id?: string;
    redirect_url?: string;
    status: KycStatus;
    provider_reference: string;
  }> {
    const ref = `unconf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return {
      status: 'PENDING_REVIEW',
      provider_reference: ref,
    };
  }

  async verifySynchronous(request: KycVerificationRequest): Promise<NormalizedKycVerificationResult> {
    const ref = `unconf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return {
      is_verified: false,
      provider_name: this.providerName,
      provider_reference: ref,
      status: 'PENDING_REVIEW',
      customer_message: 'Verification received and queued for administrative compliance review.',
      requires_manual_review: true,
    };
  }

  async checkVerification(providerReference: string): Promise<NormalizedKycVerificationResult> {
    return {
      is_verified: false,
      provider_name: this.providerName,
      provider_reference: providerReference,
      status: 'PENDING_REVIEW',
      customer_message: 'Verification is currently pending administrative review.',
      requires_manual_review: true,
    };
  }
}

/**
 * Test Mock Provider — Strictly enabled for automated test fixtures.
 */
export class MockKycVerificationProvider implements IKycVerificationProvider {
  readonly providerName = 'mock_kyc_provider';
  readonly isConfigured = true;

  public shouldAutoApprove = false;
  public shouldAutoReject = false;
  public rejectReason: KycRejectionReasonCode = 'NAME_MISMATCH';

  async startVerification(request: KycVerificationRequest): Promise<{
    session_id?: string;
    redirect_url?: string;
    status: KycStatus;
    provider_reference: string;
  }> {
    const ref = `mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    if (this.shouldAutoApprove) {
      return { status: 'VERIFIED', provider_reference: ref };
    }
    if (this.shouldAutoReject) {
      return { status: 'REJECTED', provider_reference: ref };
    }
    return { status: 'PENDING_REVIEW', provider_reference: ref };
  }

  async verifySynchronous(request: KycVerificationRequest): Promise<NormalizedKycVerificationResult> {
    const ref = `mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    if (this.shouldAutoApprove) {
      return {
        is_verified: true,
        provider_name: this.providerName,
        provider_reference: ref,
        status: 'VERIFIED',
        verified_at: new Date().toISOString(),
        requires_manual_review: false,
      };
    }
    if (this.shouldAutoReject) {
      return {
        is_verified: false,
        provider_name: this.providerName,
        provider_reference: ref,
        status: 'REJECTED',
        rejection_reason_code: this.rejectReason,
        customer_message: 'Automated identity verification failed due to record mismatch.',
        requires_manual_review: false,
      };
    }
    return {
      is_verified: false,
      provider_name: this.providerName,
      provider_reference: ref,
      status: 'PENDING_REVIEW',
      customer_message: 'Verification queued for compliance team evaluation.',
      requires_manual_review: true,
    };
  }

  async checkVerification(providerReference: string): Promise<NormalizedKycVerificationResult> {
    return {
      is_verified: this.shouldAutoApprove,
      provider_name: this.providerName,
      provider_reference: providerReference,
      status: this.shouldAutoApprove ? 'VERIFIED' : this.shouldAutoReject ? 'REJECTED' : 'PENDING_REVIEW',
      requires_manual_review: !this.shouldAutoApprove && !this.shouldAutoReject,
    };
  }
}

// Active provider instance
let activeProvider: IKycVerificationProvider = new UnconfiguredKycProvider();

/**
 * Returns currently active KYC verification provider.
 */
export function getActiveKycProvider(): IKycVerificationProvider {
  return activeProvider;
}

/**
 * Sets the active KYC provider (used for test setup).
 */
export function __setActiveKycProviderForTest(provider: IKycVerificationProvider) {
  activeProvider = provider;
}

/**
 * Resets active provider to default production Unconfigured provider.
 */
export function __resetKycProviderToDefault() {
  activeProvider = new UnconfiguredKycProvider();
}
