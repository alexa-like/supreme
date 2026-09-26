/**
 * Alexvya Platform — Service Products Catalog Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collection: serviceProducts/{productId}
 */

import { inMemoryStore, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import { ServiceProductDocument } from '../../types/firestore.ts';
import { ServiceCategory } from '../../types/enums.ts';
import { serviceProductDocumentSchema } from '../../lib/validation/firestore.ts';

const COLLECTION_NAME = 'serviceProducts';

export async function getProductById(productId: string): Promise<ServiceProductDocument | null> {
  return inMemoryStore.getDoc(COLLECTION_NAME, productId);
}

export async function upsertProduct(product: ServiceProductDocument): Promise<ServiceProductDocument> {
  serviceProductDocumentSchema.parse(product);
  inMemoryStore.setDoc(COLLECTION_NAME, product.id, product);
  return product;
}

/**
 * Public catalog query: browses active products sorted by selling price.
 * Uses composite index: category ASC, is_active ASC, selling_price_kobo ASC.
 */
export async function queryActiveProductsByCategory(
  category: ServiceCategory,
  options: PaginationOptions = {}
): Promise<PaginatedResult<ServiceProductDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  const products: ServiceProductDocument[] = Array.from(col.values())
    .filter((p) => p.category === category && p.is_active === true)
    .sort((a, b) => a.selling_price_kobo - b.selling_price_kobo);

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = products.findIndex((p) => p.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = products.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < products.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: products.length,
  };
}

export async function listAllProducts(options: PaginationOptions = {}): Promise<PaginatedResult<ServiceProductDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(COLLECTION_NAME);
  const products: ServiceProductDocument[] = Array.from(col.values());

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = products.findIndex((p) => p.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = products.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < products.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: products.length,
  };
}
