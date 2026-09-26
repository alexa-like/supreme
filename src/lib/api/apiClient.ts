/**
 * Alexvya Platform — Frontend API Client
 * Built for Stage 2.9 (Customer VAS experience)
 */

import { auth } from '../firebase/client.ts';

function generateCorrelationId(): string {
  return `cor_client_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
  skipAuth?: boolean;
}

export async function apiFetch<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  
  // Set JSON content headers by default if body exists and is not FormData
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Set correlation ID
  headers.set('x-correlation-id', generateCorrelationId());

  // Set idempotency key if provided
  if (options.idempotencyKey) {
    headers.set('idempotency-key', options.idempotencyKey);
  }

  // Set Authorization header if user is logged in
  if (!options.skipAuth) {
    const user = auth.currentUser;
    if (user) {
      const idToken = await user.getIdToken();
      headers.set('Authorization', `Bearer ${idToken}`);
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `API request failed with status ${response.status}`;
    let errorCode = 'UNKNOWN_ERROR';
    let data: any = null;

    try {
      const errJson = await response.json();
      if (errJson.error) {
        errorMsg = errJson.error.message || errorMsg;
        errorCode = errJson.error.code || errorCode;
        data = errJson.error.details || null;
      }
    } catch {
      // Use fallback message
    }

    const error: any = new Error(errorMsg);
    error.status = response.status;
    error.code = errorCode;
    error.details = data;
    throw error;
  }

  const json = await response.json();
  return json.data as T;
}
