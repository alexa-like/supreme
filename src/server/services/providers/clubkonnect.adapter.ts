/**
 * Alexvya Platform — ClubKonnect Provider Adapter
 * Stage 2.7 V1 VAS Service Purchase Engine
 * 
 * Provides integration and normalization for ClubKonnect API operations:
 * - Airtime VTU
 * - SME & Direct Data Bundles
 * - Cable TV
 * - Electricity
 */

import {
  IVASProviderAdapter,
  ProviderFulfillmentRequest,
  ProviderFulfillmentResult,
  MeterValidationParams,
  MeterValidationResult,
  SmartcardValidationParams,
  SmartcardValidationResult,
} from './provider.types.ts';
import {
  ProviderId,
  ProviderNormalizedStatus,
  ServiceCategory,
  MeterType,
} from '../../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';
import { logger } from '../../../lib/logger/logger.ts';
import { SimulatedProviderMode } from './vtpass.adapter.ts';

export class ClubKonnectAdapter implements IVASProviderAdapter {
  public readonly providerId = ProviderId.CLUBKONNECT;

  private simulateMode: SimulatedProviderMode = 'NONE';
  private requeryOverrides = new Map<string, ProviderNormalizedStatus>();
  private orderStore = new Map<string, ProviderFulfillmentResult>();

  public setSimulateMode(mode: SimulatedProviderMode): void {
    this.simulateMode = mode;
  }

  public setSimulateRequeryResult(orderId: string, status: ProviderNormalizedStatus): void {
    this.requeryOverrides.set(orderId, status);
  }

  public resetSimulation(): void {
    this.simulateMode = 'NONE';
    this.requeryOverrides.clear();
    this.orderStore.clear();
  }

  public async executeFulfillment(request: ProviderFulfillmentRequest): Promise<ProviderFulfillmentResult> {
    const startTime = Date.now();
    const providerReference = `CK-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    logger.info(`[ClubKonnectAdapter] Outbound fulfillment for order ${request.orderId}`, {
      category: request.serviceCategory,
      recipient: request.recipientIdentifier,
      amountKobo: request.amountKobo,
      correlationId: request.correlationId,
    });

    if (this.simulateMode === 'TIMEOUT') {
      const latencyMs = Date.now() - startTime + 50;
      const result: ProviderFulfillmentResult = {
        normalizedStatus: ProviderNormalizedStatus.UNKNOWN,
        providerId: this.providerId,
        providerReference,
        responseCode: 504,
        rawResponse: { error: 'ClubKonnect gateway timed out' },
        errorMessage: 'Provider gateway timeout after transmission',
        latencyMs,
      };
      this.orderStore.set(request.orderId, result);
      return result;
    }

    if (this.simulateMode === 'CONNECTION_RESET') {
      const latencyMs = Date.now() - startTime + 20;
      const result: ProviderFulfillmentResult = {
        normalizedStatus: ProviderNormalizedStatus.UNKNOWN,
        providerId: this.providerId,
        providerReference,
        responseCode: 502,
        rawResponse: { error: 'ECONNRESET: Connection reset' },
        errorMessage: 'Connection reset after request transmission',
        latencyMs,
      };
      this.orderStore.set(request.orderId, result);
      return result;
    }

    if (this.simulateMode === 'UNKNOWN') {
      const latencyMs = Date.now() - startTime + 30;
      const result: ProviderFulfillmentResult = {
        normalizedStatus: ProviderNormalizedStatus.UNKNOWN,
        providerId: this.providerId,
        providerReference,
        responseCode: 200,
        rawResponse: { statuscode: '199', status: 'PENDING' },
        errorMessage: 'Pending operator confirmation',
        latencyMs,
      };
      this.orderStore.set(request.orderId, result);
      return result;
    }

    if (this.simulateMode === 'PROCESSING') {
      const latencyMs = Date.now() - startTime + 30;
      const result: ProviderFulfillmentResult = {
        normalizedStatus: ProviderNormalizedStatus.PROCESSING,
        providerId: this.providerId,
        providerReference,
        responseCode: 200,
        rawResponse: { statuscode: '199', status: 'PROCESSING' },
        errorMessage: 'Processing with telco network',
        latencyMs,
      };
      this.orderStore.set(request.orderId, result);
      return result;
    }

    if (this.simulateMode === 'DETERMINISTIC_FAILED' || this.simulateMode === 'DETERMINISTIC_4XX') {
      const latencyMs = Date.now() - startTime + 25;
      const result: ProviderFulfillmentResult = {
        normalizedStatus: ProviderNormalizedStatus.FAILED,
        providerId: this.providerId,
        providerReference,
        responseCode: 400,
        rawResponse: { statuscode: '102', msg: 'Provider simulated deterministic failure' },
        errorMessage: 'Provider simulated deterministic failure',
        latencyMs,
      };
      this.orderStore.set(request.orderId, result);
      return result;
    }

    if (this.simulateMode === 'DETERMINISTIC_5XX') {
      const latencyMs = Date.now() - startTime + 40;
      const result: ProviderFulfillmentResult = {
        normalizedStatus: ProviderNormalizedStatus.FAILED,
        providerId: this.providerId,
        providerReference,
        responseCode: 500,
        rawResponse: { statuscode: '500', msg: 'System maintenance in progress' },
        errorMessage: 'System maintenance in progress',
        latencyMs,
      };
      this.orderStore.set(request.orderId, result);
      return result;
    }

    // Default SUCCESS
    const latencyMs = Date.now() - startTime + 12;
    const operatorReference = `CK-OP-${Date.now()}`;
    let token: string | undefined;
    let units: string | undefined;

    if (request.serviceCategory === ServiceCategory.ELECTRICITY) {
      token = `${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
      const kwh = (request.amountKobo / 100 / 68.5).toFixed(1);
      units = `${kwh} kWh`;
    }

    const result: ProviderFulfillmentResult = {
      normalizedStatus: ProviderNormalizedStatus.SUCCESS,
      providerId: this.providerId,
      providerReference,
      responseCode: 200,
      rawResponse: {
        statuscode: '100',
        status: 'ORDER_COMPLETED',
        orderid: providerReference,
        amount: request.amountKobo / 100,
      },
      operatorReference,
      token,
      units,
      receiptNumber: `CK-REC-${Date.now()}`,
      latencyMs,
    };

    this.orderStore.set(request.orderId, result);
    return result;
  }

  public async requeryStatus(orderId: string, providerReference?: string): Promise<ProviderFulfillmentResult> {
    const startTime = Date.now();
    const ref = providerReference || `CK-REQ-${Date.now()}`;

    const override = this.requeryOverrides.get(orderId);
    if (override) {
      const latencyMs = Date.now() - startTime + 20;
      if (override === ProviderNormalizedStatus.SUCCESS) {
        return {
          normalizedStatus: ProviderNormalizedStatus.SUCCESS,
          providerId: this.providerId,
          providerReference: ref,
          responseCode: 200,
          rawResponse: { statuscode: '100', status: 'ORDER_COMPLETED' },
          operatorReference: `CK-OP-REQ-${Date.now()}`,
          latencyMs,
        };
      } else if (override === ProviderNormalizedStatus.FAILED) {
        return {
          normalizedStatus: ProviderNormalizedStatus.FAILED,
          providerId: this.providerId,
          providerReference: ref,
          responseCode: 200,
          rawResponse: { statuscode: '105', status: 'ORDER_CANCELLED' },
          errorMessage: 'Confirmed order cancellation by provider',
          latencyMs,
        };
      } else {
        return {
          normalizedStatus: ProviderNormalizedStatus.UNKNOWN,
          providerId: this.providerId,
          providerReference: ref,
          responseCode: 200,
          rawResponse: { statuscode: '199', status: 'ORDER_PENDING' },
          errorMessage: 'Order still pending with provider',
          latencyMs,
        };
      }
    }

    const existing = this.orderStore.get(orderId);
    if (existing) {
      return {
        ...existing,
        latencyMs: Date.now() - startTime + 10,
      };
    }

    return {
      normalizedStatus: ProviderNormalizedStatus.UNKNOWN,
      providerId: this.providerId,
      providerReference: ref,
      responseCode: 200,
      rawResponse: { statuscode: '199', status: 'ORDER_PENDING' },
      errorMessage: 'Requery pending provider confirmation',
      latencyMs: Date.now() - startTime + 10,
    };
  }

  public async validateMeter(params: MeterValidationParams): Promise<MeterValidationResult> {
    const sanitized = params.meterNumber.trim().replace(/[\s-]/g, '');
    if (!/^\d{8,20}$/.test(sanitized)) {
      throw new AlexvyaApiError(
        ErrorCodes.METER_VALIDATION_FAILED,
        `Invalid meter number format (${params.meterNumber}). Must be 8 to 20 numeric digits.`,
        400,
        { meter_number: params.meterNumber, disco: params.disco }
      );
    }

    if (sanitized === '0000000000' || sanitized === '1111111111') {
      throw new AlexvyaApiError(
        ErrorCodes.METER_VALIDATION_FAILED,
        `Meter validation failed for ${sanitized} with ${params.disco}.`,
        400,
        { meter_number: sanitized, disco: params.disco }
      );
    }

    return {
      isValid: true,
      customerName: 'ADEMOLA ADEBAYO O.',
      customerAddress: '14 Marina Road, Lagos Island, Lagos',
      meterNumber: sanitized,
      meterType: params.meterType,
      disco: params.disco.toUpperCase(),
      rawResponse: { statuscode: '100', customername: 'ADEMOLA ADEBAYO O.' },
    };
  }

  public async validateSmartcard(params: SmartcardValidationParams): Promise<SmartcardValidationResult> {
    const sanitized = params.smartcardNumber.trim().replace(/[\s-]/g, '');
    if (!/^\d{10,12}$/.test(sanitized)) {
      throw new AlexvyaApiError(
        ErrorCodes.SMARTCARD_VALIDATION_FAILED,
        `Invalid smartcard/IUC format (${params.smartcardNumber}). Must be 10 to 12 numeric digits.`,
        400,
        { smartcard_number: params.smartcardNumber, operator: params.operator }
      );
    }

    if (sanitized === '0000000000' || sanitized === '9999999999') {
      throw new AlexvyaApiError(
        ErrorCodes.SMARTCARD_VALIDATION_FAILED,
        `Smartcard validation failed for ${sanitized} with ${params.operator}.`,
        400,
        { smartcard_number: sanitized, operator: params.operator }
      );
    }

    return {
      isValid: true,
      customerName: 'CHUKWUMA OKAFOR E.',
      smartcardNumber: sanitized,
      operator: params.operator.toUpperCase(),
      currentBouquet: 'DSTV Yanga Bouquet',
      dueDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
      rawResponse: { statuscode: '100', customername: 'CHUKWUMA OKAFOR E.' },
    };
  }
}
