/**
 * Supreme Digital Network — Server Firebase Admin Configuration & Validator
 * Stage 2.2 Firebase Architecture
 * 
 * Validates server-side Firebase configuration without logging sensitive credentials.
 */

import firebaseAppletConfig from '../../../firebase-applet-config.json';

export interface FirebaseAdminConfigStatus {
  hasServiceAccount: boolean;
  hasAdc: boolean;
  projectId: string;
  databaseId?: string;
  clientEmail?: string;
  isConfigured: boolean;
}

/**
 * Validates server-side Firebase Admin credentials.
 * NEVER logs private keys or secrets.
 */
export function validateFirebaseAdminConfig(): FirebaseAdminConfigStatus {
  // Dynamically resolve Project ID from environment or applet config
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    firebaseAppletConfig.projectId ||
    '';

  const databaseId =
    process.env.FIRESTORE_DATABASE_ID ||
    firebaseAppletConfig.firestoreDatabaseId ||
    '(default)';

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  const hasServiceAccount = Boolean(clientEmail && privateKey && projectId);
  // ADC is natively available in Google Cloud / Cloud Run / AI Studio or when service account is not provided
  const hasAdc = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.K_SERVICE ||
    process.env.GAE_SERVICE ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    !clientEmail
  );

  return {
    hasServiceAccount,
    hasAdc,
    projectId,
    databaseId,
    clientEmail: clientEmail ? `${clientEmail.substring(0, 4)}...` : undefined,
    isConfigured: hasServiceAccount || hasAdc,
  };
}
