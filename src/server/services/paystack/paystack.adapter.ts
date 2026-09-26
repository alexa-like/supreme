/**
 * Alexvya Platform — Paystack API Adapter & Signature Verification
 * Stage 2.6 Paystack Wallet Funding & Payment Lifecycle
 * 
 * STRICT INVARIANTS:
 * 1. Paystack secret key is SERVER ONLY (process.env.PAYSTACK_SECRET_KEY). Never exposed to client.
 * 2. API calls to Paystack happen exclusively outside Firestore transactions.
 * 3. Webhook signature verified via HMAC-SHA512 with crypto.timingSafeEqual against RAW body.
 * 4. Pluggable test adapter / mock hooks for isolated unit & regression testing.
 */

import crypto from 'crypto';
import { IntegerKobo } from '../../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';
import { logger } from '../../../lib/logger/logger.ts';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export interface PaystackInitializeParams {
  email: string;
  amountKobo: IntegerKobo;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
}

export interface PaystackInitializeData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: PaystackInitializeData;
}

export interface PaystackVerifyData {
  id: number;
  domain: string;
  status: 'success' | 'failed' | 'abandoned' | string;
  reference: string;
  amount: number; // in kobo
  message: string | null;
  gateway_response: string;
  paid_at: string | null;
  created_at: string;
  channel: string;
  currency: 'NGN' | string;
  ip_address: string | null;
  metadata?: Record<string, unknown>;
  fees: number | null; // in kobo
  customer?: {
    id: number;
    email: string;
    customer_code?: string;
  };
  authorization?: {
    authorization_code?: string;
    bin?: string;
    last4?: string;
    exp_month?: string;
    exp_year?: string;
    card_type?: string;
    bank?: string;
    country_code?: string;
    brand?: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: PaystackVerifyData;
}

export interface PaystackWebhookEvent {
  event: string;
  data: PaystackVerifyData;
}

export interface IPaystackClient {
  initializeTransaction(params: PaystackInitializeParams, correlationId?: string): Promise<PaystackInitializeResponse>;
  verifyTransaction(reference: string, correlationId?: string): Promise<PaystackVerifyResponse>;
  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string): boolean;
}

/**
 * Standard Production HTTP Paystack Client
 */
export class PaystackClient implements IPaystackClient {
  private secretKey: string;

  constructor(secretKey?: string) {
    this.secretKey = secretKey || process.env.PAYSTACK_SECRET_KEY || '';
  }

  private getHeaders(): Record<string, string> {
    if (!this.secretKey) {
      logger.warn('[PaystackClient] PAYSTACK_SECRET_KEY is not set in environment.');
    }
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async initializeTransaction(
    params: PaystackInitializeParams,
    correlationId?: string
  ): Promise<PaystackInitializeResponse> {
    const url = `${PAYSTACK_BASE_URL}/transaction/initialize`;
    const payload = {
      email: params.email,
      amount: params.amountKobo, // Paystack expects integer kobo for NGN
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      channels: params.channels,
    };

    logger.info(
      `[PaystackClient] Initializing transaction for reference: ${params.reference}, amount: ${params.amountKobo} kobo`,
      undefined,
      correlationId
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      const responseBody = await response.json().catch(() => null);

      if (!response.ok || !responseBody || !responseBody.status) {
        const errorMsg = responseBody?.message || `Paystack HTTP ${response.status}`;
        logger.error(
          `[PaystackClient] Initialize failed for ${params.reference}: ${errorMsg}`,
          undefined,
          correlationId
        );
        throw new AlexvyaApiError(
          ErrorCodes.PAYMENT_GATEWAY_ERROR,
          `Paystack initialization failed: ${errorMsg}`,
          502
        );
      }

      return responseBody as PaystackInitializeResponse;
    } catch (err: any) {
      if (err instanceof AlexvyaApiError) throw err;
      logger.error(
        `[PaystackClient] Network exception during initialization: ${err.message}`,
        undefined,
        correlationId
      );
      throw new AlexvyaApiError(
        ErrorCodes.PAYMENT_GATEWAY_TIMEOUT,
        'Network error or timeout connecting to payment gateway',
        504
      );
    }
  }

  async verifyTransaction(
    reference: string,
    correlationId?: string
  ): Promise<PaystackVerifyResponse> {
    const encodedRef = encodeURIComponent(reference);
    const url = `${PAYSTACK_BASE_URL}/transaction/verify/${encodedRef}`;

    logger.info(
      `[PaystackClient] Verifying transaction for reference: ${reference}`,
      undefined,
      correlationId
    );

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const responseBody = await response.json().catch(() => null);

      if (!response.ok || !responseBody || !responseBody.status) {
        const errorMsg = responseBody?.message || `Paystack HTTP ${response.status}`;
        logger.error(
          `[PaystackClient] Verification request failed for ${reference}: ${errorMsg}`,
          undefined,
          correlationId
        );
        throw new AlexvyaApiError(
          ErrorCodes.PAYMENT_GATEWAY_ERROR,
          `Paystack verification failed: ${errorMsg}`,
          502
        );
      }

      return responseBody as PaystackVerifyResponse;
    } catch (err: any) {
      if (err instanceof AlexvyaApiError) throw err;
      logger.error(
        `[PaystackClient] Network exception during verification: ${err.message}`,
        undefined,
        correlationId
      );
      throw new AlexvyaApiError(
        ErrorCodes.PAYMENT_GATEWAY_TIMEOUT,
        'Network error or timeout connecting to payment gateway verification',
        504
      );
    }
  }

  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string): boolean {
    if (!signatureHeader || !this.secretKey) {
      return false;
    }

    try {
      const hash = crypto
        .createHmac('sha512', this.secretKey)
        .update(rawBody)
        .digest('hex');

      const expectedBuffer = Buffer.from(hash, 'utf8');
      const receivedBuffer = Buffer.from(signatureHeader, 'utf8');

      if (expectedBuffer.length !== receivedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch (err) {
      return false;
    }
  }
}

// Global active client singleton & test override hook
let activePaystackClient: IPaystackClient = new PaystackClient();

export function getPaystackClient(): IPaystackClient {
  return activePaystackClient;
}

export function setMockPaystackClient(mockClient: IPaystackClient | null): void {
  if (mockClient) {
    activePaystackClient = mockClient;
  } else {
    activePaystackClient = new PaystackClient();
  }
}
