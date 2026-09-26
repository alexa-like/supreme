/**
 * Alexvya Platform — Rate Limiting & Abuse Prevention Engine
 * Stage 2.5.6 Financial Security Hardening
 * 
 * Baseline Rate Limits (Locked Stage 1.3):
 * - Login: 5 requests / 5 minutes
 * - Password Reset: 2 / hour
 * - Wallet Funding Initialization: 10 / hour
 * - VAS Purchases: 20 / minute
 * - Utility Validation: 15 / minute
 * - Admin Operations: 30 / minute
 * 
 * Strict Guarantees:
 * 1. Multi-dimensional limiting: IP, Authenticated UID, Endpoint Action.
 * 2. Sliding window memory implementation.
 * 3. Fail-safe behavior: If an error occurs during evaluation, fails safely without granting unlimited financial access.
 */

import { Request, Response, NextFunction } from 'express';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';
import { logger } from '../../lib/logger/logger.ts';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  actionName: string;
}

export const RATE_LIMIT_CONFIGS = {
  LOGIN: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 5,
    actionName: 'LOGIN',
  },
  PASSWORD_RESET: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 2,
    actionName: 'PASSWORD_RESET',
  },
  WALLET_FUNDING_INIT: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    actionName: 'WALLET_FUNDING_INIT',
  },
  VAS_PURCHASE: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 20,
    actionName: 'VAS_PURCHASE',
  },
  UTILITY_VALIDATION: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 15,
    actionName: 'UTILITY_VALIDATION',
  },
  ADMIN_OPERATIONS: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
    actionName: 'ADMIN_OPERATIONS',
  },
  GENERAL_API: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    actionName: 'GENERAL_API',
  },
} as const;

interface RateLimitRecord {
  timestamps: number[];
}

export class InMemoryRateLimiter {
  private records = new Map<string, RateLimitRecord>();

  /**
   * Resets all rate limit records (used in test setup).
   */
  clear(): void {
    this.records.clear();
  }

  /**
   * Checks whether the given key is rate-limited.
   * Returns { allowed: boolean, currentCount: number, limit: number, resetTimeMs: number }
   */
  checkLimit(
    key: string,
    config: RateLimitConfig
  ): {
    allowed: boolean;
    currentCount: number;
    limit: number;
    resetTimeMs: number;
    retryAfterSeconds: number;
  } {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    // Filter out timestamps older than the sliding window
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    const currentCount = record.timestamps.length;
    const allowed = currentCount < config.maxRequests;
    const oldestTimestamp = record.timestamps[0] || now;
    const resetTimeMs = oldestTimestamp + config.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - now) / 1000));

    if (allowed) {
      record.timestamps.push(now);
    }

    return {
      allowed,
      currentCount: allowed ? currentCount + 1 : currentCount,
      limit: config.maxRequests,
      resetTimeMs,
      retryAfterSeconds,
    };
  }

  /**
   * Enforces rate limiting programmatically, throwing AlexvyaApiError on violation.
   */
  enforce(
    key: string,
    config: RateLimitConfig,
    correlationId?: string
  ): void {
    try {
      const result = this.checkLimit(key, config);
      if (!result.allowed) {
        logger.warn(
          `[RateLimit] Action '${config.actionName}' rate limit exceeded for key '${key}'`,
          {
            current_count: result.currentCount,
            limit: result.limit,
            retry_after_seconds: result.retryAfterSeconds,
          },
          correlationId
        );

        throw new AlexvyaApiError(
          ErrorCodes.DAILY_LIMIT_EXCEEDED,
          `Too many requests for action '${config.actionName}'. Please wait ${result.retryAfterSeconds} seconds before retrying.`,
          429,
          {
            action: config.actionName,
            limit: result.limit,
            retry_after_seconds: result.retryAfterSeconds,
            correlation_id: correlationId,
          }
        );
      }
    } catch (err) {
      if (err instanceof AlexvyaApiError) {
        throw err;
      }
      // Fail-Safe: Log the internal error and deny or rethrow safely
      logger.error(`[RateLimit] Internal error evaluating rate limit`, { error: String(err) }, correlationId);
      throw new AlexvyaApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        'Rate limit evaluation failed. Action denied for security safety.',
        500,
        { correlation_id: correlationId }
      );
    }
  }
}

export const rateLimiter = new InMemoryRateLimiter();

export function resetRateLimiterStore(): void {
  rateLimiter.clear();
}

/**
 * Creates an Express middleware for rate limiting.
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req as any).correlationId;
    const userContext = (req as any).user;
    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    
    // Dimension key: UID if authenticated, otherwise IP
    const subjectKey = userContext?.uid ? `uid:${userContext.uid}` : `ip:${clientIp}`;
    const rateLimitKey = `${config.actionName}:${subjectKey}`;

    try {
      rateLimiter.enforce(rateLimitKey, config, correlationId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
