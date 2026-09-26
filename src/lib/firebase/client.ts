/**
 * Alexvya Platform — Firebase Client SDK Initializer
 * Stage 2.2 Firebase Architecture
 * 
 * Browser-safe singleton for Firebase Authentication and Firestore client access.
 * Reuses existing initialized instance to guarantee singleton safety across hot reloads.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getFirebaseClientConfig } from './config.ts';

let firebaseApp: FirebaseApp;
let firebaseAuth: Auth;
let firebaseDb: Firestore;

export function initializeFirebaseClient(): {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
} {
  const config = getFirebaseClientConfig();

  if (getApps().length === 0) {
    firebaseApp = initializeApp(config);
  } else {
    firebaseApp = getApp();
  }

  firebaseAuth = getAuth(firebaseApp);
  firebaseDb = getFirestore(firebaseApp, 'ai-studio-supremedigitalne-26b1c0c6-2076-4c6e-a5ba-d6e0ccf3ef10');

  return {
    app: firebaseApp,
    auth: firebaseAuth,
    db: firebaseDb,
  };
}

export const { app, auth, db } = initializeFirebaseClient();
