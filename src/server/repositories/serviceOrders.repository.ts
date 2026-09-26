/**
 * Alexvya Platform — Service Orders & Sub-Orders Repository (Server-Only Foundation)
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Target Collections:
 * - serviceOrders/{orderId}
 * - airtimeOrders/{orderId}
 * - dataOrders/{orderId}
 * - billOrders/{orderId}
 */

import { inMemoryStore, PaginationOptions, PaginatedResult, sanitizePageLimit } from './base.repository.ts';
import {
  ServiceOrderDocument,
  AirtimeOrderDocument,
  DataOrderDocument,
  BillOrderDocument,
} from '../../types/firestore.ts';
import { ServiceOrderStatus } from '../../types/enums.ts';
import {
  serviceOrderDocumentSchema,
  airtimeOrderDocumentSchema,
  dataOrderDocumentSchema,
  billOrderDocumentSchema,
} from '../../lib/validation/firestore.ts';

const SERVICE_ORDERS_COL = 'serviceOrders';
const AIRTIME_ORDERS_COL = 'airtimeOrders';
const DATA_ORDERS_COL = 'dataOrders';
const BILL_ORDERS_COL = 'billOrders';

// ============================================================================
// Service Orders (Abstract Base)
// ============================================================================

export async function getServiceOrderById(orderId: string): Promise<ServiceOrderDocument | null> {
  return inMemoryStore.getDoc(SERVICE_ORDERS_COL, orderId);
}

export async function createServiceOrder(order: ServiceOrderDocument): Promise<ServiceOrderDocument> {
  serviceOrderDocumentSchema.parse(order);
  inMemoryStore.setDoc(SERVICE_ORDERS_COL, order.id, order);
  return order;
}

export async function updateServiceOrder(
  orderId: string,
  updates: Partial<ServiceOrderDocument>
): Promise<ServiceOrderDocument | null> {
  const existing = await getServiceOrderById(orderId);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  serviceOrderDocumentSchema.parse(updated);
  inMemoryStore.setDoc(SERVICE_ORDERS_COL, orderId, updated);
  return updated;
}


/**
 * Reconciler polling query: Finds in-flight/stuck orders by status.
 * Uses composite index: status ASC, created_at ASC.
 */
export async function queryServiceOrdersByStatus(
  status: ServiceOrderStatus,
  options: PaginationOptions = {}
): Promise<PaginatedResult<ServiceOrderDocument>> {
  const limit = sanitizePageLimit(options.limit);
  const col = inMemoryStore.getCollection(SERVICE_ORDERS_COL);
  const orders: ServiceOrderDocument[] = Array.from(col.values())
    .filter((o) => o.status === status)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // ASC order for reconciler

  let startIndex = 0;
  if (options.cursor) {
    const cursorIdx = orders.findIndex((o) => o.id === options.cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paged = orders.slice(startIndex, startIndex + limit);
  const nextCursor = paged.length === limit && startIndex + limit < orders.length
    ? paged[paged.length - 1].id
    : null;

  return {
    items: paged,
    nextCursor,
    hasMore: nextCursor !== null,
    total: orders.length,
  };
}

// ============================================================================
// Airtime Orders
// ============================================================================

export async function getAirtimeOrder(orderId: string): Promise<AirtimeOrderDocument | null> {
  return inMemoryStore.getDoc(AIRTIME_ORDERS_COL, orderId);
}

export async function createAirtimeOrder(order: AirtimeOrderDocument): Promise<AirtimeOrderDocument> {
  airtimeOrderDocumentSchema.parse(order);
  inMemoryStore.setDoc(AIRTIME_ORDERS_COL, order.id, order);
  return order;
}

// ============================================================================
// Data Orders
// ============================================================================

export async function getDataOrder(orderId: string): Promise<DataOrderDocument | null> {
  return inMemoryStore.getDoc(DATA_ORDERS_COL, orderId);
}

export async function createDataOrder(order: DataOrderDocument): Promise<DataOrderDocument> {
  dataOrderDocumentSchema.parse(order);
  inMemoryStore.setDoc(DATA_ORDERS_COL, order.id, order);
  return order;
}

// ============================================================================
// Bill Orders (Electricity & Cable TV)
// ============================================================================

export async function getBillOrder(orderId: string): Promise<BillOrderDocument | null> {
  return inMemoryStore.getDoc(BILL_ORDERS_COL, orderId);
}

export async function createBillOrder(order: BillOrderDocument): Promise<BillOrderDocument> {
  billOrderDocumentSchema.parse(order);
  inMemoryStore.setDoc(BILL_ORDERS_COL, order.id, order);
  return order;
}

export async function updateBillOrder(
  orderId: string,
  updates: Partial<BillOrderDocument>
): Promise<BillOrderDocument | null> {
  const existing = await getBillOrder(orderId);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  billOrderDocumentSchema.parse(updated);
  inMemoryStore.setDoc(BILL_ORDERS_COL, orderId, updated);
  return updated;
}

