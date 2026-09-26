# Alexvya — Stage 2.4: Firestore Repositories + Validation Architecture

**Document Version:** 1.0.0  
**Status:** Approved & Verified Implementation Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** React 19 / Vite 8 / TypeScript 5.7+ / Node.js Express / Cloud Firestore / Firebase Admin SDK  
**Current Stage:** Stage 2.4 (Firestore Repositories + Validation)  
**Preceding Stages:**  
- `docs/alexvya-stage-0-project-foundation.md` (Locked)
- `docs/alexvya-stage-1-product-blueprint.md` (Locked)
- `docs/alexvya-stage-1.1-firestore-database-architecture.md` (Locked)
- `docs/alexvya-stage-1.2-provider-pricing-architecture.md` (Locked)
- `docs/alexvya-stage-1.3-firebase-security-architecture.md` (Locked)
- `docs/alexvya-stage-1.4-api-integration-architecture.md` (Locked)
- `docs/alexvya-stage-1.5-frontend-design-architecture.md` (Locked)
- `docs/alexvya-stage-2.1-runtime-project-environment-foundation.md` (Locked)
- `docs/alexvya-stage-2.2-firebase-client-admin-architecture.md` (Locked)
- `docs/alexvya-stage-2.3-authentication-user-provisioning.md` (Locked)

---

## 1. Executive Summary & Verification Matrix

Stage 2.4 establishes the server-side, type-safe data-access foundation for the Alexvya platform. It translates the locked Stage 1.1 Firestore schema and Stage 1.3 security invariants into modular repository functions, Zod validation engines, integer financial arithmetic bounds, and composite index definitions.

### Stage 2.4 Verification Status

| Verification Criterion | Requirement | Result |
|---|---|:---:|
| **Locked Collections Coverage** | All 17 collections & subcollections implemented with zero missing entities | **PASS** |
| **Server/Client Isolation** | Repositories execute in server-only context (`src/server/repositories/`) | **PASS** |
| **Role Model Reconciliation** | Authoritative roles `CUSTOMER`, `ADMIN`, `SUPER_ADMIN`, `AUDITOR`, `SYSTEM` | **PASS** |
| **Financial Integrity** | Integer Kobo only (`Number.isSafeInteger()`, non-negative, float rejection) | **PASS** |
| **Basis-Point Arithmetic** | `0`–`10,000` bps range, integer arithmetic, floor discount, ceil fees | **PASS** |
| **Validation Layer** | Comprehensive Zod schemas for all document models and enums | **PASS** |
| **Pagination Engine** | Cursor-based pagination (`limit`, `cursor`, `hasMore`, `nextCursor`) | **PASS** |
| **Composite Indexes** | 13 composite indexes + 6 single-field exemptions in `firestore.indexes.json` | **PASS** |
| **Database-Gated Auth** | Active check on `adminUsers/{userId}.is_active` for privileged operations | **PASS** |
| **Automated Test Suite** | 12 test suites passing 100% across all repository & validation boundaries | **PASS** |

---

## 2. Complete 17 Locked Collections Architecture Map

Alexvya strictly enforces the 17 locked Firestore collections and subcollections from Stage 1.1:

```text
Cloud Firestore (Native Mode)
├── users/{userId}                                 [Root: Customer identity & profile authority]
├── wallets/{userId}                              [Root: Single wallet per customer]
│   └── ledger/{ledgerId}                         [Subcollection: Append-only financial journal]
├── transactions/{transactionId}                  [Root: Master commercial transaction ledger]
├── paymentAttempts/{paymentAttemptId}            [Root: Paystack checkout attempts]
├── serviceOrders/{orderId}                       [Root: Abstract VAS order lifecycle]
├── airtimeOrders/{orderId}                       [Root: Airtime delivery metadata]
├── dataOrders/{orderId}                          [Root: Data bundle delivery metadata]
├── billOrders/{orderId}                          [Root: Electricity & Cable TV token metadata]
├── serviceProducts/{productId}                   [Root: Commercial catalog & pricing]
├── providers/{providerId}                        [Root: Provider routing & health state]
├── providerTransactions/{providerTransactionId}  [Root: Outbound provider payload audits]
├── webhookEvents/{webhookEventId}                [Root: Inbound third-party webhooks queue]
├── notifications/{notificationId}                [Root: User notifications inbox]
├── adminUsers/{userId}                           [Root: Database-gated staff RBAC]
├── auditLogs/{auditLogId}                        [Root: Append-only compliance journal]
└── idempotencyKeys/{idempotencyKey}              [Root: API deduplication locks & responses]
```

---

## 3. Server Repository Architecture

All Firestore operations are encapsulated inside `src/server/repositories/`:

- `base.repository.ts`: Common pagination parameters, page limit sanitization, Firestore resolver, and memory fallback store.
- `users.repository.ts`: Identity lookup, customer creation, profile update whitelist, account status enforcement.
- `wallets.repository.ts`: Read-only wallet state, version retrieval, and default wallet initialization. (Mutations deferred to Stage 2.5).
- `ledger.repository.ts`: Append-only ledger entries and chronological statement querying.
- `transactions.repository.ts`: Reference resolution, customer transaction feeds, administrative queries.
- `paymentAttempts.repository.ts`: Paystack payment attempt storage and gateway reference lookup.
- `serviceOrders.repository.ts`: VAS service order lifecycle management and sub-order detail storage (`airtimeOrders`, `dataOrders`, `billOrders`).
- `serviceProducts.repository.ts`: Active catalog querying sorted by price and product definition management.
- `providers.repository.ts`: Provider status, circuit breaker states, and health monitoring.
- `providerTransactions.repository.ts`: Auditing raw provider request/response payloads.
- `webhookEvents.repository.ts`: Inbound webhook deduplication, signature status, and asynchronous processing queue.
- `notifications.repository.ts`: Customer notifications inbox with unread filters and read receipts.
- `adminUsers.repository.ts`: Real-time database-gated role verification.
- `auditLogs.repository.ts`: Append-only audit logging by actor or action.
- `idempotencyKeys.repository.ts`: Request fingerprint validation, in-progress locks, and response caching.

---

## 4. Authoritative Role Model Reconciliation

Alexvya enforces the role model specified in locked Stage 1.3:

```typescript
export const UserRole = {
  CUSTOMER: 'CUSTOMER',       // Default authenticated user (Self data only)
  ADMIN: 'ADMIN',             // Operational staff (Orders, pricing, non-sensitive logs)
  SUPER_ADMIN: 'SUPER_ADMIN', // Executive staff (Staff roles, provider routes, maintenance)
  AUDITOR: 'AUDITOR',         // Compliance officer (Read-only financial & audit journals)
  SYSTEM: 'SYSTEM',           // Background crons & automated worker services
} as const;
```

### Normalization Logic
Legacy or external inputs referencing `'USER'` or lowercase `'customer'` are automatically normalized to `UserRole.CUSTOMER` via `normalizeUserRole()`.

---

## 5. Financial Integrity & Integer Kobo Invariants

To eliminate floating-point currency drift, Alexvya enforces integer kobo arithmetic across all layers:

1. **Integer Representation:** `₦1.00 = 100 kobo`. `₦5,000.00 = 500,000 kobo`.
2. **Safe Integer Bounds:** All amounts are constrained to `0 <= amount <= Number.MAX_SAFE_INTEGER` (`9,007,199,254,740,991`).
3. **Runtime Validation:** `isSafeKobo()` rejects `NaN`, `Infinity`, negative values, non-integers, and floats.
4. **Zod Schema Rejection:** `koboSchema` and `positiveKoboSchema` reject invalid amounts before reaching repository layers.

---

## 6. Basis-Point Precision & Rounding Rules

1. **Range:** `0 <= bps <= 10,000` (`0.00%` to `100.00%`).
2. **Discount Formula (Floor):**
   $$\text{discount\_kobo} = \left\lfloor \frac{\text{face\_value\_kobo} \times \text{discount\_bps}}{10000} \right\rfloor$$
3. **Fee Formula (Ceil):**
   $$\text{fee\_kobo} = \left\lceil \frac{\text{amount\_kobo} \times \text{fee\_bps}}{10000} \right\rceil$$

---

## 7. Zod Validation Engine & Schema Hardening

All 17 collections have corresponding Zod schemas in `src/lib/validation/firestore.ts`. Any attempt to persist an invalid enum value, negative balance, or unauthorized field throws a validation error immediately.

---

## 8. Cursor-Based Pagination Strategy

For scalable querying across high-volume collections (`transactions`, `ledger`, `notifications`, `auditLogs`, `serviceOrders`), repositories implement cursor-based pagination:

```typescript
export interface PaginationOptions {
  limit?: number;           // Default 20, Max 100
  cursor?: string | null;   // Document ID to start after
  direction?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}
```

---

## 9. Idempotency & TTL Lifecycle Enforcement

Alexvya enforces domain-specific deduplication retention windows:

| Operation Category | Target Storage | Retention Window (TTL) | Rationale |
|---|---|:---:|---|
| **VAS Purchases** | `idempotencyKeys/{key}` | **24 Hours** | Prevents rapid double-clicks and client reconnections. |
| **Paystack Checkout** | `paymentAttempts/{id}` | **72 Hours** | Covers bank transfer latency and customer checkout grace period. |
| **Paystack Verification** | `paymentAttempts.gateway_reference` | **90 Days** | Prevents repeated verification triggers from double-crediting wallets. |
| **Inbound Webhooks** | `webhookEvents/{hash}` | **30 Days** | Provider retry policies resend webhooks during extended outages. |
| **Refunds & Adjustments** | `transactions/{id}` & `auditLogs/{id}` | **Permanent** | Immutable financial auditability. |

---

## 10. Database-Gated Authorization Foundation

Because the Firebase Admin SDK bypasses security rules in trusted server environments, server route handlers verify staff authorization via database queries against `adminUsers/{userId}`:

```typescript
export async function verifyIsActiveAdmin(userId: string, requiredRole?: AdminRole): Promise<boolean> {
  const admin = await getAdminUserById(userId);
  if (!admin || !admin.is_active) return false;
  if (requiredRole && admin.role !== requiredRole && admin.role !== AdminRole.SUPER_ADMIN) {
    return false;
  }
  return true;
}
```

---

## 11. Composite Indexes & Optimization Strategy

The 13 required composite indexes and 6 single-field exemptions are defined in `firestore.indexes.json`:

1. `transactions`: `user_id` ASC, `created_at` DESC
2. `transactions`: `user_id` ASC, `status` ASC, `created_at` DESC
3. `transactions`: `user_id` ASC, `type` ASC, `created_at` DESC
4. `transactions`: `status` ASC, `created_at` DESC
5. `transactions`: `type` ASC, `status` ASC, `created_at` DESC
6. `wallets/{userId}/ledger`: `user_id` ASC, `created_at` DESC
7. `wallets/{userId}/ledger`: `user_id` ASC, `entry_type` ASC, `created_at` DESC
8. `serviceOrders`: `status` ASC, `created_at` ASC
9. `serviceProducts`: `category` ASC, `is_active` ASC, `selling_price_kobo` ASC
10. `notifications`: `user_id` ASC, `is_read` ASC, `created_at` DESC
11. `webhookEvents`: `provider` ASC, `processing_status` ASC, `received_at` ASC
12. `auditLogs`: `actor_id` ASC, `created_at` DESC
13. `auditLogs`: `action` ASC, `created_at` DESC

---

## 12. Dual-Environment Fallback Architecture

To ensure hermetic testing, local developer productivity, and production cloud reliability, repositories utilize a dual-mode fallback architecture:
- In production with live GCP / Firebase Admin credentials: queries and writes execute against Cloud Firestore in Native Mode.
- In hermetic test environments: operations seamlessly fall back to an isolated, strongly-typed in-memory repository store (`InMemoryRepositoryStore`).

---

## 13. Comprehensive Automated Test Suite Analysis

The test suite in `src/server/tests/repositories-validation.test.ts` executes 12 validation suites with 100% pass rate:
- **Test 1:** User create, read, and update profile
- **Test 2:** Role normalization & protected field invariance
- **Test 3:** Wallet creation & integer balance foundation
- **Test 4:** Transaction creation and reference lookup
- **Test 5:** Cursor-based pagination on collections
- **Test 6:** Idempotency key registration and TTL validity
- **Test 7:** Domain Enum validation and rejection
- **Test 8:** Money integrity and integer arithmetic
- **Test 9:** Basis-point validation & discount calculation
- **Test 10:** Malformed document schema rejection
- **Test 11:** Database-gated admin verification
- **Test 12:** Repository smoke validations across all 17 collections

---

## 14. Stage 2.5 Readiness & Sign-Off Criteria

Stage 2.4 is complete, verified, and locked. The data-access layer is fully prepared for **Stage 2.5 (Wallet Engine + Double-Entry Ledger Transactions)**.
