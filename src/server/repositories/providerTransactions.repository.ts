/**
 * Alexvya Platform — Provider Outbound Transactions Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: providerTransactions/{providerTransactionId}
 */

import { inMemoryStore } from './base.repository.ts';
import { ProviderTransactionDocument } from '../../types/firestore.ts';
import { providerTransactionDocumentSchema } from '../../lib/validation/firestore.ts';

const COLLECTION_NAME = 'providerTransactions';

export async function getProviderTransactionById(providerTransactionId: string): Promise<ProviderTransactionDocument | null> {
  return inMemoryStore.getDoc(COLLECTION_NAME, providerTransactionId);
}

export async function createProviderTransaction(doc: ProviderTransactionDocument): Promise<ProviderTransactionDocument> {
  providerTransactionDocumentSchema.parse(doc);
  inMemoryStore.setDoc(COLLECTION_NAME, doc.id, doc);
  return doc;
}

export async function queryProviderTransactionsByOrder(serviceOrderId: string): Promise<ProviderTransactionDocument[]> {
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  return Array.from(col.values())
    .filter((pt) => pt.service_order_id === serviceOrderId)
    .sort((a, b) => a.retry_attempt - b.retry_attempt);
}

export async function updateProviderTransaction(
  id: string,
  updates: Partial<ProviderTransactionDocument>
): Promise<ProviderTransactionDocument | null> {
  const existing = await getProviderTransactionById(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  providerTransactionDocumentSchema.parse(updated);
  inMemoryStore.setDoc(COLLECTION_NAME, id, updated);
  return updated;
}

