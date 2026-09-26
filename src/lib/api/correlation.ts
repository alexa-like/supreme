/**
 * Alexvya Platform — Correlation & Request ID Generator
 * Stage 1.4 API Specification
 */

export function generateCorrelationId(prefix = 'req'): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${randomStr}`;
}
