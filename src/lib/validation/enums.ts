/**
 * Alexvya Platform — Domain Enum Validation Schemas
 * Stage 2.4 Firestore Repositories + Validation
 */

import { z } from 'zod';
import {
  UserRole,
  AccountStatus,
  KycTier,
  WalletStatus,
  LedgerEntryType,
  LedgerDirection,
  LedgerCategory,
  TransactionType,
  TransactionStatus,
  PaymentGateway,
  PaymentAttemptStatus,
  PaymentChannel,
  VerificationSource,
  ServiceCategory,
  ServiceOrderStatus,
  NetworkProvider,
  AirtimeType,
  DataPlanType,
  BillCategory,
  MeterType,
  ProviderId,
  ProviderStatus,
  ProviderNormalizedStatus,
  WebhookProcessingStatus,
  NotificationCategory,
  AdminRole,
  AuditAction,
  IdempotencyStatus,
} from '../../types/enums.ts';

export const userRoleSchema = z.nativeEnum(UserRole);
export const accountStatusSchema = z.nativeEnum(AccountStatus);
export const kycTierSchema = z.nativeEnum(KycTier);

export const walletStatusSchema = z.nativeEnum(WalletStatus);
export const ledgerEntryTypeSchema = z.nativeEnum(LedgerEntryType);
export const ledgerDirectionSchema = z.nativeEnum(LedgerDirection);
export const ledgerCategorySchema = z.nativeEnum(LedgerCategory);

export const transactionTypeSchema = z.nativeEnum(TransactionType);
export const transactionStatusSchema = z.nativeEnum(TransactionStatus);
export const paymentGatewaySchema = z.nativeEnum(PaymentGateway);
export const paymentAttemptStatusSchema = z.nativeEnum(PaymentAttemptStatus);
export const paymentChannelSchema = z.nativeEnum(PaymentChannel);
export const verificationSourceSchema = z.nativeEnum(VerificationSource);

export const serviceCategorySchema = z.nativeEnum(ServiceCategory);
export const serviceOrderStatusSchema = z.nativeEnum(ServiceOrderStatus);
export const networkProviderSchema = z.nativeEnum(NetworkProvider);
export const airtimeTypeSchema = z.nativeEnum(AirtimeType);
export const dataPlanTypeSchema = z.nativeEnum(DataPlanType);
export const billCategorySchema = z.nativeEnum(BillCategory);
export const meterTypeSchema = z.nativeEnum(MeterType);

export const providerIdSchema = z.nativeEnum(ProviderId);
export const providerStatusSchema = z.nativeEnum(ProviderStatus);
export const providerNormalizedStatusSchema = z.nativeEnum(ProviderNormalizedStatus);
export const webhookProcessingStatusSchema = z.nativeEnum(WebhookProcessingStatus);

export const notificationCategorySchema = z.nativeEnum(NotificationCategory);
export const adminRoleSchema = z.nativeEnum(AdminRole);
export const auditActionSchema = z.nativeEnum(AuditAction);
export const idempotencyStatusSchema = z.nativeEnum(IdempotencyStatus);
