/**
 * Alexvya Platform — Client Firestore Service Foundation
 * Stage 2.2 Firebase Architecture
 * 
 * SECURITY INVARIANTS:
 * 1. The client SDK is strictly read-only for public/user-owned resources.
 * 2. NO financial writes (wallet credits/debits, transactions) are permitted from client code.
 * 3. All balance modifications and purchases MUST execute via server API routes.
 */

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  DocumentData,
} from 'firebase/firestore';
import { db } from './client.ts';

/**
 * Fetch public active service products catalog (e.g. data plans, airtime discounts).
 */
export async function fetchActiveServiceProducts(serviceType?: string): Promise<DocumentData[]> {
  try {
    const productsRef = collection(db, 'serviceProducts');
    const q = serviceType
      ? query(productsRef, where('service_type', '==', serviceType), where('is_active', '==', true))
      : query(productsRef, where('is_active', '==', true));

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[FirestoreClient] Catalog read error (handled gracefully):', err);
    return [];
  }
}

/**
 * Fetch authenticated user profile document (read-only from client).
 */
export async function fetchUserProfile(uid: string): Promise<DocumentData | null> {
  if (!uid) return null;
  try {
    const userDocRef = doc(db, 'users', uid);
    const snap = await getDoc(userDocRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (err) {
    console.warn('[FirestoreClient] Profile read error:', err);
    return null;
  }
}
