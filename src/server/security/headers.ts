/**
 * Alexvya Platform — HTTP Security Headers & Safe CORS Middleware
 * Stage 2.5.6 Financial Security Hardening
 * 
 * Strict Guarantees:
 * 1. Enforces defensive security headers (X-Content-Type-Options, Referrer-Policy, Frame protection).
 * 2. Origin-bounded CORS: Authenticated financial APIs reject wildcard Access-Control-Allow-Origin: *.
 * 3. Safe development integration without breaking Vite dev proxy or iframe embedding.
 */

import { Request, Response, NextFunction } from 'express';

export function applySecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Frame protection (allow framing in same origin or specific AI Studio preview frames)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Cross-Site Scripting filter
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Cache-Control for authenticated API endpoints
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  // Strict-Transport-Security in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  next();
}

/**
 * Origin-Bounded CORS Middleware.
 * Explicitly manages Allowed Origins rather than blanket '*'.
 */
export function applySafeCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const isDev = process.env.NODE_ENV !== 'production';

  if (origin) {
    const isAllowedOrigin =
      isDev ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('supreme-digital-networks.ai.studio') ||
      origin.endsWith('.ai.studio') ||
      origin.endsWith('.run.app') ||
      origin.endsWith('.web.app') ||
      origin.endsWith('.firebaseapp.com');

    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Correlation-Id, Idempotency-Key, Accept'
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}
