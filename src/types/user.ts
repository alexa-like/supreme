import { 
  UserRole, 
  AccountStatus, 
  KycTier, 
  KycStatus, 
  KycVerificationMethod, 
  KycRejectionReasonCode, 
  normalizeUserRole 
} from './enums.ts';
import { IntegerKobo } from './money.ts';

export { 
  UserRole, 
  AccountStatus, 
  KycTier, 
  KycStatus, 
  KycVerificationMethod, 
  KycRejectionReasonCode, 
  normalizeUserRole 
};
export type UserTier = KycTier;

export interface NotificationPreferences {
  email_on_wallet_credit: boolean;
  email_on_purchase: boolean;
}

export interface UserDocument {
  uid: string;
  id?: string; // Schema synonym
  email: string;
  phone_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  photo_url?: string | null;
  account_status: AccountStatus;
  role: UserRole;
  tier: UserTier;
  kyc_tier?: number;
  daily_funding_limit_kobo?: IntegerKobo;
  notification_preferences?: NotificationPreferences;
  email_verified: boolean;
  phone_verified?: boolean;
  two_factor_enabled?: boolean;
  auth_provider?: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
  metadata?: Record<string, unknown>;
}

export type SafeUserProfile = Omit<UserDocument, 'metadata'>;

export interface UpdateProfileInput {
  first_name?: string;
  last_name?: string;
  display_name?: string;
  phone_number?: string | null;
  notification_preferences?: Partial<NotificationPreferences>;
}

export interface CustomerFinancialLimits {
  tier: UserTier;
  kyc_tier: number;
  min_funding_kobo: number;
  max_funding_kobo: number;
  daily_funding_limit_kobo: number;
  max_wallet_balance_kobo: number;
  min_vas_purchase_kobo: number;
  max_vas_purchase_kobo: number;
  currency: string;
}

export interface CustomerAccountStatusInfo {
  status: AccountStatus;
  message: string;
  is_restricted: boolean;
}

export interface CustomerAccountSummary {
  profile: SafeUserProfile;
  email_verified: boolean;
  auth_provider: string;
  auth_provider_label: string;
  has_password_auth: boolean;
  limits: CustomerFinancialLimits;
  account_status_info: CustomerAccountStatusInfo;
}

export interface KycVerificationDocument {
  id: string; // Unique KYC Request ID
  user_id: string;
  status: KycStatus;
  current_tier: KycTier;
  requested_tier: KycTier;
  verification_method: KycVerificationMethod;
  id_type?: string | null;
  id_number_masked?: string | null;
  full_legal_name?: string | null;
  date_of_birth?: string | null;
  address?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null; // Admin UID
  rejection_reason_code?: KycRejectionReasonCode | null;
  rejection_notes?: string | null;
  customer_action_required?: string | null;
  provider_name?: string | null;
  provider_reference?: string | null;
  verification_version: number;
  created_at: string;
  updated_at: string;
}

export interface SafeCustomerKycStatus {
  user_id: string;
  status: KycStatus;
  current_tier: KycTier;
  requested_tier?: KycTier | null;
  verification_method?: KycVerificationMethod | null;
  id_type?: string | null;
  id_number_masked?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  rejection_reason_code?: KycRejectionReasonCode | null;
  customer_action_required?: string | null;
  rejection_message?: string | null;
  latest_request_id?: string | null;
}


