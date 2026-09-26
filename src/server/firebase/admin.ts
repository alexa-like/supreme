/**
 * Supreme Digital Network — Server-Only Firebase Admin SDK Singleton
 * Stage 2.2 Firebase Architecture
 * 
 * CRITICAL SECURITY INVARIANTS:
 * 1. This module is STRICTLY server-side.
 * 2. It must NEVER be imported into client components or bundled into browser assets.
 * 3. Supports Application Default Credentials (ADC) in Google Cloud runtime & explicit Service Account credentials in local dev.
 */

import { initializeApp, getApps, getApp, App, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { validateFirebaseAdminConfig } from './config.ts';

function assertServerEnvironment() {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[CRITICAL_SECURITY_VIOLATION] Attempted to load Firebase Admin SDK in client/browser context.'
    );
  }
}

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;

export function getAdminApp(): { app: App; auth: Auth; db: Firestore } {
  assertServerEnvironment();

  const configStatus = validateFirebaseAdminConfig();
  const projectId = configStatus.projectId;
  const databaseId = configStatus.databaseId;

  if (getApps().length === 0) {
    if (projectId) {
      process.env.GOOGLE_CLOUD_PROJECT = projectId;
      process.env.GCLOUD_PROJECT = projectId;
      process.env.FIREBASE_PROJECT_ID = projectId;
    }

    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (clientEmail && privateKey && projectId) {
      // Service Account Credential initialization
      adminApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } else {
      // Application Default Credentials (ADC) for Google Cloud / Firebase App Hosting
      adminApp = initializeApp({
        credential: applicationDefault(),
        projectId: projectId || undefined,
      });
    }
  } else {
    adminApp = getApp();
  }

  adminAuth = getAuth(adminApp);
  adminDb = databaseId && databaseId !== '(default)'
    ? getFirestore(adminApp, databaseId)
    : getFirestore(adminApp);

  return {
    app: adminApp,
    auth: adminAuth,
    db: adminDb,
  };
}

// Lazy accessor functions for server operations
export const getAdminAuth = (): Auth => getAdminApp().auth;
export const getAdminDb = (): Firestore => getAdminApp().db;
export const getAdminFirestore = (): Firestore => getAdminApp().db;

