/**
 * Alexvya Platform — Utility & Service Pre-Purchase Validation Service
 * Stage 2.7 V1 VAS Service Purchase Engine
 * 
 * CORE ARCHITECTURAL INVARIANT:
 * Meter and smartcard validation MUST remain completely separate from purchase.
 * Pre-purchase validation NEVER debits the customer wallet or writes to the ledger.
 */

import { ProviderRouterService } from './providerRouter.service.ts';
import {
  MeterValidationParams,
  MeterValidationResult,
  SmartcardValidationParams,
  SmartcardValidationResult,
} from '../providers/provider.types.ts';
import { ServiceCategory } from '../../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';

export class VasValidationService {
  /**
   * Validates Nigerian mobile phone number format (MSISDN).
   * Accepts: +234XXXXXXXXXX, 234XXXXXXXXXX, 080XXXXXXXX, 090XXXXXXXX, 070XXXXXXXX, 081XXXXXXXX
   * Returns canonical 11-digit local format: 08012345678 or E.164.
   */
  public static validateAndNormalizeMsisdn(phoneNumber: string): string {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_MSISDN,
        'Phone number is required and must be a valid string.',
        400
      );
    }

    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
    let normalized = cleaned;

    if (cleaned.startsWith('+234')) {
      normalized = '0' + cleaned.substring(4);
    } else if (cleaned.startsWith('234') && cleaned.length === 13) {
      normalized = '0' + cleaned.substring(3);
    }

    if (!/^0[789][01]\d{8}$/.test(normalized)) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_MSISDN,
        `Invalid Nigerian phone number format: '${phoneNumber}'. Expected 11 digits starting with 070, 080, 081, 090, 091.`,
        400,
        { phoneNumber }
      );
    }

    return normalized;
  }

  /**
   * Validates electricity meter number with provider.
   * Completely separate from purchase — ZERO wallet debit.
   */
  public static async validateMeter(params: MeterValidationParams): Promise<MeterValidationResult> {
    if (!params.disco || typeof params.disco !== 'string') {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'DISCO code (e.g. IKEDC, EKEDC, IBEDC, AEDC) is required.',
        400
      );
    }

    if (!params.meterNumber || typeof params.meterNumber !== 'string') {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_METER,
        'Meter number is required.',
        400
      );
    }

    const provider = await ProviderRouterService.selectProviderForService(ServiceCategory.ELECTRICITY);
    return provider.validateMeter(params);
  }

  /**
   * Validates cable TV smartcard / IUC number with provider.
   * Completely separate from purchase — ZERO wallet debit.
   */
  public static async validateSmartcard(params: SmartcardValidationParams): Promise<SmartcardValidationResult> {
    if (!params.operator || typeof params.operator !== 'string') {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'Cable operator (e.g. DSTV, GOTV, STARTIMES) is required.',
        400
      );
    }

    if (!params.smartcardNumber || typeof params.smartcardNumber !== 'string') {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_SMARTCARD,
        'Smartcard / IUC number is required.',
        400
      );
    }

    const provider = await ProviderRouterService.selectProviderForService(ServiceCategory.CABLE_TV);
    return provider.validateSmartcard(params);
  }
}
