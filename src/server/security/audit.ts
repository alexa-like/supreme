/**
 * Alexvya Platform — Security Audit Logging Service
 * Stage 2.5.6 Financial Security Hardening
 * 
 * Strict Invariants:
 * 1. Append-only immutable records to auditLogs collection.
 * 2. Zero secrets in logs (scrubs passwords, tokens, API keys, private keys, authorization headers).
 * 3. Captures actor UID, role, action, resource, correlation ID, timestamp, and diff data.
 */

import { randomUUID } from 'crypto';
import { createAuditLog } from '../repositories/auditLogs.repository.ts';
import { AuditLogDocument } from '../../types/firestore.ts';
import { AuditAction, UserRole } from '../../types/enums.ts';
import { logger } from '../../lib/logger/logger.ts';

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'idtoken',
  'refreshtoken',
  'authorization',
  'apikey',
  'secret',
  'privatekey',
  'paystack_secret_key',
  'vtpass_secret_key',
  'clubkonnect_api_key',
  'resend_api_key',
  'card_number',
  'cvv',
  'pin',
]);

/**
 * Recursively sanitizes an object to remove sensitive keys.
 */
export function sanitizeAuditData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditData(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('token')) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export interface RecordAuditEventParams {
  actorId: string;
  actorRole: UserRole | string;
  action: AuditAction;
  targetId?: string;
  targetCollection?: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  justification?: string;
  ipAddress?: string;
  correlationId: string;
}

/**
 * Records an immutable security audit log.
 */
export async function recordAuditEvent(params: RecordAuditEventParams): Promise<AuditLogDocument> {
  const auditId = `aud_${Date.now()}_${randomUUID().substring(0, 8)}`;

  const logDoc: AuditLogDocument = {
    id: auditId,
    actor_id: params.actorId,
    actor_role: String(params.actorRole),
    action: params.action,
    target_collection: params.targetCollection || 'system',
    target_id: params.targetId || 'system',
    before_state: (sanitizeAuditData(params.beforeData) as Record<string, unknown>) || null,
    after_state: (sanitizeAuditData(params.afterData) as Record<string, unknown>) || null,
    reason: params.justification || 'Administrative action recorded for audit compliance',
    correlation_id: params.correlationId,
    ip_address: params.ipAddress || '127.0.0.1',
    created_at: new Date().toISOString(),
  };

  try {
    await createAuditLog(logDoc);
    logger.info(
      `[Audit] Event recorded: ${params.action} by ${params.actorRole}:${params.actorId}`,
      { target: params.targetId, audit_id: auditId },
      params.correlationId
    );
  } catch (err) {
    logger.error(
      `[Audit] Failed to write audit log for action ${params.action}`,
      { error: String(err) },
      params.correlationId
    );
  }

  return logDoc;
}
