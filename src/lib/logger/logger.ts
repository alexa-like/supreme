/**
 * Alexvya Platform — Structured JSON Logger
 * Stage 1.4 & Stage 2.1 Foundation
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogPayload {
  level: LogLevel;
  message: string;
  correlation_id?: string;
  userId?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

export const logger = {
  log(level: LogLevel, message: string, context?: Record<string, unknown>, correlationId?: string) {
    let sanitizedContext = context;
    if (context && level !== 'error' && 'error' in context) {
      const { error, ...rest } = context;
      sanitizedContext = { ...rest, details: typeof error === 'string' ? error : String(error) };
    }

    const payload: StructuredLogPayload = {
      level,
      message,
      correlation_id: correlationId,
      context: sanitizedContext,
      timestamp: new Date().toISOString(),
    };

    const formatted = JSON.stringify(payload);
    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  },

  info(message: string, context?: Record<string, unknown>, correlationId?: string) {
    this.log('info', message, context, correlationId);
  },

  warn(message: string, context?: Record<string, unknown>, correlationId?: string) {
    this.log('warn', message, context, correlationId);
  },

  error(message: string, context?: Record<string, unknown>, correlationId?: string) {
    this.log('error', message, context, correlationId);
  },

  debug(message: string, context?: Record<string, unknown>, correlationId?: string) {
    this.log('debug', message, context, correlationId);
  },
};
