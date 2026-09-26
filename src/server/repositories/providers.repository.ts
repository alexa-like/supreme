/**
 * Alexvya Platform — Providers Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: providers/{providerId}
 */

import { inMemoryStore } from './base.repository.ts';
import { ProviderDocument } from '../../types/firestore.ts';
import { ProviderId, ProviderStatus } from '../../types/enums.ts';
import { providerDocumentSchema } from '../../lib/validation/firestore.ts';

const COLLECTION_NAME = 'providers';

export async function getProviderById(providerId: ProviderId | string): Promise<ProviderDocument | null> {
  return inMemoryStore.getDoc(COLLECTION_NAME, providerId);
}

export async function upsertProvider(provider: ProviderDocument): Promise<ProviderDocument> {
  providerDocumentSchema.parse(provider);
  inMemoryStore.setDoc(COLLECTION_NAME, provider.id, provider);
  return provider;
}

export async function listProviders(): Promise<ProviderDocument[]> {
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  return Array.from(col.values());
}

export async function updateProviderHealth(
  providerId: ProviderId | string,
  healthUpdates: Partial<ProviderDocument>
): Promise<ProviderDocument> {
  return inMemoryStore.updateDoc(COLLECTION_NAME, providerId, {
    ...healthUpdates,
    updated_at: new Date().toISOString(),
  });
}
