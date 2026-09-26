/**
 * Alexvya Platform — Canonical Customer Tier Policy & Limits Engine
 * Stage 2.12 KYC, Customer Verification & Tier Management Architecture
 * 
 * STRICT INVARIANT:
 * This module is the SINGLE AUTHORITATIVE SOURCE of customer tier policies and limits.
 * Frontend components, customer summary endpoints, funding services, and VAS purchase
 * validations MUST derive dynamic limits directly from this module.
 */

import { KycTier } from '../../../types/enums.ts';
import { CustomerFinancialLimits, SafeUserProfile } from '../../../types/user.ts';

export interface TierPolicyDefinition {
  tier: KycTier;
  kyc_level: number;
  display_name: string;
  description: string;
  requirements: string[];
  limits: CustomerFinancialLimits;
  features: string[];
}

export interface TierEligibilityResult {
  current_tier: KycTier;
  next_tier: KycTier | null;
  is_eligible_for_upgrade: boolean;
  missing_requirements: string[];
  allowed_target_tiers: KycTier[];
}

export const CANONICAL_TIER_POLICIES: Record<KycTier, TierPolicyDefinition> = {
  TIER_1: {
    tier: 'TIER_1',
    kyc_level: 1,
    display_name: 'Tier 1 — Basic Customer',
    description: 'Entry-level access for newly registered customer accounts.',
    requirements: [
      'Verified Email Address',
      'Valid Customer Phone Number',
      'Basic Profile Registration'
    ],
    limits: {
      tier: 'TIER_1',
      kyc_tier: 1,
      min_funding_kobo: 5000,          // ₦50.00
      max_funding_kobo: 5000000,       // ₦50,000.00 single transaction
      daily_funding_limit_kobo: 5000000, // ₦50,000.00 daily
      max_wallet_balance_kobo: 1000000000, // ₦10,000,000.00
      min_vas_purchase_kobo: 5000,     // ₦50.00
      max_vas_purchase_kobo: 10000000, // ₦100,000.00
      currency: 'NGN'
    },
    features: [
      'Instant Airtime & Mobile Data Recharge',
      'Prepaid & Postpaid Electricity Settlement',
      'Paystack Verified Wallet Funding (up to ₦50k/day)',
      'Digital Transaction Receipts & Ledger Journal'
    ]
  },
  TIER_2: {
    tier: 'TIER_2',
    kyc_level: 2,
    display_name: 'Tier 2 — Verified Customer',
    description: 'Enhanced tier for verified individuals with validated government identity.',
    requirements: [
      'Tier 1 Compliance (Verified Email & Phone)',
      'Bank Verification Number (BVN) or National Identity Number (NIN)',
      'Full Legal Name Matching Identity Record',
      'Date of Birth Verification'
    ],
    limits: {
      tier: 'TIER_2',
      kyc_tier: 2,
      min_funding_kobo: 5000,          // ₦50.00
      max_funding_kobo: 20000000,      // ₦200,000.00 single transaction
      daily_funding_limit_kobo: 50000000, // ₦500,000.00 daily
      max_wallet_balance_kobo: 5000000000, // ₦50,000,000.00
      min_vas_purchase_kobo: 5000,     // ₦50.00
      max_vas_purchase_kobo: 50000000, // ₦500,000.00
      currency: 'NGN'
    },
    features: [
      'All Tier 1 Virtual Services',
      'Expanded Wallet Funding (up to ₦500k/day)',
      'Higher Single VAS Purchase Limit (₦500,000)',
      'Priority Provider Order Routing & Support'
    ]
  },
  TIER_3: {
    tier: 'TIER_3',
    kyc_level: 3,
    display_name: 'Tier 3 — Enterprise / VIP',
    description: 'Maximum operational limit tier for high-volume traders and corporate accounts.',
    requirements: [
      'Tier 2 Compliance & Identity Verification',
      'Government Issued Photo ID (Passport / Driver’s License / Voter’s Card)',
      'Verified Residential Address & Utility Bill',
      'Administrative Compliance Approval'
    ],
    limits: {
      tier: 'TIER_3',
      kyc_tier: 3,
      min_funding_kobo: 5000,           // ₦50.00
      max_funding_kobo: 100000000,      // ₦1,000,000.00 single transaction
      daily_funding_limit_kobo: 500000000, // ₦5,000,000.00 daily
      max_wallet_balance_kobo: 50000000000, // ₦500,000,000.00
      min_vas_purchase_kobo: 5000,      // ₦50.00
      max_vas_purchase_kobo: 200000000, // ₦2,000,000.00
      currency: 'NGN'
    },
    features: [
      'Unlimited High-Volume VTU & Bulk Settlements',
      'Max Single Funding up to ₦1,000,000',
      'Daily Operational Limit up to ₦5,000,000',
      'Dedicated Account Management & SLA'
    ]
  }
};

/**
 * Returns canonical financial limits for a given customer tier.
 */
export function getCanonicalLimitsForTier(tier: KycTier = 'TIER_1'): CustomerFinancialLimits {
  const policy = CANONICAL_TIER_POLICIES[tier] || CANONICAL_TIER_POLICIES.TIER_1;
  return { ...policy.limits };
}

/**
 * Evaluates upgrade eligibility for a customer based on profile state and current tier.
 */
export function evaluateTierEligibility(profile: SafeUserProfile): TierEligibilityResult {
  const currentTier: KycTier = profile.tier || 'TIER_1';
  const missingRequirements: string[] = [];

  if (currentTier === 'TIER_1') {
    if (!profile.email_verified) {
      missingRequirements.push('Email address must be verified before requesting Tier 2.');
    }
    if (!profile.phone_number) {
      missingRequirements.push('Nigerian phone number must be added to your profile.');
    }

    return {
      current_tier: 'TIER_1',
      next_tier: 'TIER_2',
      is_eligible_for_upgrade: missingRequirements.length === 0,
      missing_requirements: missingRequirements,
      allowed_target_tiers: ['TIER_2']
    };
  }

  if (currentTier === 'TIER_2') {
    if (!profile.email_verified) {
      missingRequirements.push('Email address must be verified.');
    }

    return {
      current_tier: 'TIER_2',
      next_tier: 'TIER_3',
      is_eligible_for_upgrade: missingRequirements.length === 0,
      missing_requirements: missingRequirements,
      allowed_target_tiers: ['TIER_3']
    };
  }

  // TIER_3 is maximum tier
  return {
    current_tier: 'TIER_3',
    next_tier: null,
    is_eligible_for_upgrade: false,
    missing_requirements: ['Account is already at maximum tier (Tier 3).'],
    allowed_target_tiers: []
  };
}

/**
 * Validates whether a requested tier transition is legally permitted.
 */
export function isValidTierTransition(currentTier: KycTier, targetTier: KycTier): boolean {
  if (currentTier === targetTier) return false;
  if (currentTier === 'TIER_1' && targetTier === 'TIER_2') return true;
  if (currentTier === 'TIER_2' && targetTier === 'TIER_3') return true;
  // Super admin manual bypass could allow 1 -> 3, but standard customer progression is linear
  return false;
}
