import { logger } from '../../../lib/logger/logger.ts';

export interface ConfigValidationResult {
  status: 'CONFIGURED' | 'MISSING' | 'UNAVAILABLE' | 'INVALID';
  notes: string;
}

export class ProductionConfigValidator {
  public static validate(): Record<string, ConfigValidationResult> {
    const report: Record<string, ConfigValidationResult> = {};

    const configs = [
      { key: 'PAYSTACK_SECRET_KEY', required: true },
      { key: 'CLUBKONNECT_USER_ID', required: true },
      { key: 'CLUBKONNECT_API_KEY', required: true },
      { key: 'RESEND_API_KEY', required: true },
      { key: 'SYSTEM_EMAIL_SENDER', required: true },
      { key: 'GEMINI_API_KEY', required: false },
      { key: 'VTPASS_API_KEY', required: false },
      { key: 'VTPASS_SECRET_KEY', required: false },
      { key: 'VTPASS_PUBLIC_KEY', required: false },
    ];

    configs.forEach(({ key, required }) => {
      const value = process.env[key];
      if (value && value.trim() !== '' && !value.includes('YOUR_')) {
        report[key] = { status: 'CONFIGURED', notes: 'Credential present and appears valid.' };
      } else if (required) {
        report[key] = { status: 'MISSING', notes: 'Required configuration missing.' };
      } else {
        report[key] = { status: 'UNAVAILABLE', notes: 'Configuration not required or currently unavailable.' };
      }
    });

    return report;
  }
}
