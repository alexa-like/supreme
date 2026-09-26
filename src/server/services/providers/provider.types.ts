/**
 * Alexvya Platform — Provider Types & Interface Definitions
 * Stage 2.7 V1 VAS Service Purchase Engine
 */

import {
  ServiceCategory,
  ProviderId,
  ProviderNormalizedStatus,
  NetworkProvider,
  MeterType,
} from '../../../types/enums.ts';
import { IntegerKobo } from '../../../types/money.ts';

export interface ProviderFulfillmentRequest {
  orderId: string;
  transactionReference: string;
  serviceCategory: ServiceCategory;
  recipientIdentifier: string; // phone number, meter number, or smartcard number
  amountKobo: IntegerKobo;
  providerPlanCode: string;
  network?: NetworkProvider;
  customerName?: string;
  customerAddress?: string;
  meterType?: MeterType;
  cablePackageName?: string;
  correlationId?: string;
}

export interface ProviderFulfillmentResult {
  normalizedStatus: ProviderNormalizedStatus;
  providerId: ProviderId;
  providerReference: string;
  responseCode: number;
  rawResponse: Record<string, unknown>;
  operatorReference?: string;
  token?: string; // Electricity STS token
  units?: string; // Electricity kWh units
  receiptNumber?: string;
  errorMessage?: string;
  latencyMs: number;
}

export interface MeterValidationParams {
  disco: string;
  meterNumber: string;
  meterType: MeterType;
  correlationId?: string;
}

export interface MeterValidationResult {
  isValid: boolean;
  customerName: string;
  customerAddress?: string;
  meterNumber: string;
  meterType: MeterType;
  disco: string;
  rawResponse: Record<string, unknown>;
}

export interface SmartcardValidationParams {
  operator: string;
  smartcardNumber: string;
  correlationId?: string;
}

export interface SmartcardValidationResult {
  isValid: boolean;
  customerName: string;
  smartcardNumber: string;
  operator: string;
  currentBouquet?: string;
  dueDate?: string;
  rawResponse: Record<string, unknown>;
}

export interface IVASProviderAdapter {
  readonly providerId: ProviderId;
  executeFulfillment(request: ProviderFulfillmentRequest): Promise<ProviderFulfillmentResult>;
  requeryStatus(orderId: string, providerReference?: string): Promise<ProviderFulfillmentResult>;
  validateMeter(params: MeterValidationParams): Promise<MeterValidationResult>;
  validateSmartcard(params: SmartcardValidationParams): Promise<SmartcardValidationResult>;
}
