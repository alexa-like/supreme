/**
 * Supreme Digital Network — Resend Email Provider Adapter
 * Stage 2.14 Production Notifications, Email Delivery & Communication Infrastructure
 * 
 * CORE INVARIANTS:
 * 1. RESEND_API_KEY is SERVER-ONLY.
 * 2. Missing RESEND_API_KEY never crashes startup or breaks financial operations.
 * 3. Normalizes provider status into SENT, FAILED, SKIPPED.
 */

import { logger } from '../../../lib/logger/logger.ts';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  correlationId?: string;
}

export interface SendEmailResult {
  success: boolean;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  providerMessageId?: string | null;
  error?: string | null;
  isTransient?: boolean;
}

export async function sendTransactionalEmail(
  options: SendEmailOptions
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (
    !apiKey ||
    apiKey.trim() === '' ||
    apiKey.includes('YOUR_') ||
    apiKey === 'undefined'
  ) {
    logger.warn(
      `[EmailProvider] RESEND_API_KEY is not configured. Transactional email to ${options.to} skipped.`,
      undefined,
      options.correlationId
    );
    return {
      success: false,
      status: 'SKIPPED',
      error: 'Email provider key is not configured',
      isTransient: false,
    };
  }

  const sender =
    process.env.SYSTEM_EMAIL_SENDER ||
    'Supreme Digital Network <no-reply@supremedigitalnetwork.com>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    const data: any = await res.json().catch(() => ({}));

    if (res.ok && data?.id) {
      logger.info(
        `[EmailProvider] Email delivered to ${options.to} via Resend. Message ID: ${data.id}`,
        undefined,
        options.correlationId
      );
      return {
        success: true,
        status: 'SENT',
        providerMessageId: data.id,
      };
    } else {
      const errMsg = data?.message || data?.error?.message || `Resend returned HTTP ${res.status}`;
      const isTransient = res.status === 429 || res.status >= 500;
      logger.warn(
        `[EmailProvider] Resend error (${res.status}): ${errMsg}`,
        { to: options.to, isTransient },
        options.correlationId
      );
      return {
        success: false,
        status: 'FAILED',
        error: errMsg,
        isTransient,
      };
    }
  } catch (err: any) {
    logger.warn(
      `[EmailProvider] Network exception sending email to ${options.to}: ${err.message}`,
      undefined,
      options.correlationId
    );
    return {
      success: false,
      status: 'FAILED',
      error: err.message || 'Network exception',
      isTransient: true,
    };
  }
}
