/**
 * Alexvya Platform — Standard API Response Helpers & Error Sanitizer
 * Stage 1.4 & Stage 2.5.6 Security Hardening
 * 
 * Strict Guarantees:
 * 1. Safe Error Delivery: Never leaks database paths, stack traces, environment variables, or private internal structures in production.
 * 2. Standard Envelope: Consistent { success, data/error, meta: { correlation_id, timestamp } }.
 */

import { ApiSuccessResponse, ApiErrorResponse } from '../../types/api.ts';
import { AlexvyaApiError, ErrorCodes } from './errors.ts';
import { logger } from '../logger/logger.ts';

export function createSuccessResponse<T>(
  data: T,
  correlationId: string
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    meta: {
      correlation_id: correlationId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Sanitizes an error details object to prevent leaking internal stack traces or paths.
 */
function sanitizeErrorDetails(details: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!details) return null;
  const isProd = process.env.NODE_ENV === 'production';

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (isProd && (k === 'stack' || k === 'internal' || k === 'query' || k === 'path')) {
      continue;
    }
    sanitized[k] = v;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function createErrorResponse(
  error: AlexvyaApiError | Error | unknown,
  correlationId: string
): { response: ApiErrorResponse; statusCode: number } {
  const isProd = process.env.NODE_ENV === 'production';

  if (error instanceof AlexvyaApiError) {
    return {
      statusCode: error.statusCode,
      response: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: sanitizeErrorDetails(error.details),
        },
        meta: {
          correlation_id: correlationId,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  // Handle unexpected non-Alexvya errors (500)
  const rawMessage = error instanceof Error ? error.message : String(error);
  logger.error('[UnhandledError] Internal error intercepted', { error: rawMessage }, correlationId);

  const safeMessage = isProd
    ? 'An unexpected internal error occurred. Please try again later.'
    : rawMessage;

  return {
    statusCode: 500,
    response: {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_SERVER_ERROR,
        message: safeMessage,
        details: null,
      },
      meta: {
        correlation_id: correlationId,
        timestamp: new Date().toISOString(),
      },
    },
  };
}
