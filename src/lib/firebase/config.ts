/**
 * Supreme Digital Network — Public Firebase Client Configuration & Validator
 * Stage 2.2 Firebase Architecture
 * 
 * SECURITY INVARIANT:
 * This module exports ONLY public, browser-safe Firebase configuration.
 * It must NEVER contain Admin credentials, private keys, or 3P API secrets.
 */

import { z } from 'zod';
import firebaseAppletConfig from '../../../firebase-applet-config.json';

export const FirebaseClientConfigSchema = z.object({
  apiKey: z.string().min(1, 'Firebase API Key is required'),
  authDomain: z.string().min(1, 'Firebase Auth Domain is required'),
  projectId: z.string().min(1, 'Firebase Project ID is required'),
  storageBucket: z.string().min(1, 'Firebase Storage Bucket is required'),
  messagingSenderId: z.string().min(1, 'Firebase Messaging Sender ID is required'),
  appId: z.string().min(1, 'Firebase App ID is required'),
  measurementId: z.string().optional(),
});

export type FirebaseClientConfig = z.infer<typeof FirebaseClientConfigSchema>;

/**
 * Loads and validates client Firebase configuration.
 * Resolves configuration dynamically in priority order:
 * 1. Native platform / window injection (window.__FIREBASE_CONFIG__ or window.FIREBASE_CONFIG)
 * 2. Optional Vite build-time environment variables (import.meta.env.VITE_FIREBASE_*)
 * 3. Dedicated firebase-applet-config.json provisioned by Google AI Studio
 */
export function getFirebaseClientConfig(): FirebaseClientConfig {
  const win = typeof window !== 'undefined' ? (window as any) : {};
  const metaEnv: Record<string, string | undefined> =
    typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};

  // Check for native runtime injection provided by Google/Firebase environment
  const injected = win.__FIREBASE_CONFIG__ || win.FIREBASE_CONFIG || {};

  const rawConfig = {
    apiKey:
      injected.apiKey ||
      metaEnv.VITE_FIREBASE_API_KEY ||
      firebaseAppletConfig.apiKey ||
      '',
    authDomain:
      injected.authDomain ||
      metaEnv.VITE_FIREBASE_AUTH_DOMAIN ||
      firebaseAppletConfig.authDomain ||
      '',
    projectId:
      injected.projectId ||
      metaEnv.VITE_FIREBASE_PROJECT_ID ||
      firebaseAppletConfig.projectId ||
      '',
    storageBucket:
      injected.storageBucket ||
      metaEnv.VITE_FIREBASE_STORAGE_BUCKET ||
      firebaseAppletConfig.storageBucket ||
      '',
    messagingSenderId:
      injected.messagingSenderId ||
      metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      firebaseAppletConfig.messagingSenderId ||
      '',
    appId:
      injected.appId ||
      metaEnv.VITE_FIREBASE_APP_ID ||
      firebaseAppletConfig.appId ||
      '',
    measurementId:
      injected.measurementId ||
      metaEnv.VITE_FIREBASE_MEASUREMENT_ID ||
      firebaseAppletConfig.measurementId ||
      undefined,
  };

  const parsed = FirebaseClientConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    return rawConfig as FirebaseClientConfig;
  }

  return parsed.data;
}
