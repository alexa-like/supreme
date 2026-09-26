/**
 * Alexvya Platform — Standard API & Domain Types
 * Stage 1.4 & Stage 2.5.6 Security Foundation
 */

import { UserRole, AccountStatus } from './enums.ts';
import { AdminUserDocument } from './firestore.ts';

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta: {
    correlation_id: string;
    timestamp: string;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
  };
  meta: {
    correlation_id: string;
    timestamp: string;
  };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface AuthenticatedUserContext {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  role: UserRole;
  authTime?: number; // Epoch timestamp (seconds) of authentication
  adminRecord?: AdminUserDocument | null;
  accountStatus?: AccountStatus;
  token?: string;
}
