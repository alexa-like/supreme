# Alexvya — Stage 2.5.2: Immutable Wallet Ledger

**Document Version:** 1.0.0  
**Status:** Approved & Verified Implementation Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** React 19 / Vite 8 / TypeScript 5.7+ / Node.js Express / Cloud Firestore / Firebase Admin SDK  
**Current Stage:** Stage 2.5.2 (Immutable Wallet Ledger)  
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
- `docs/alexvya-stage-2.4-firestore-repositories-validation.md` (Locked)
- `docs/alexvya-stage-2.5.1-wallet-foundation.md` (Locked)

---

## 1. Objective

The objective of Stage 2.5.2 is to establish the authoritative immutable journal for the Alexvya platform, adhering strictly to the **Locked Wallet Terminology**:  
> **"Immutable Single-Account Wallet Balance Journal with Running Balance Snapshots"**  
*(Note: As specified in the architecture, this is not a double-entry ledger).*

The canonical subcollection at `wallets/{userId}/ledger/{ledgerId}` serves as the immutable audit journal recording every balance movement (credits, debits, refunds, reversals, administrative adjustments) and the resulting running balance snapshots.

---

## 2. Canonical Ledger Path & Organization

```text
wallets/{userId}/ledger/{ledgerId}
```

- **Parent Document:** `wallets/{userId}` (holds authoritative current balances).
- **Subcollection:** `ledger` (holds immutable historical balance journal records).
- No top-level or alternate ledger collections (`/ledger`, `/walletLedger`, or `/walletTransactions`) exist.

---

## 3. Authoritative Ledger Schema

```typescript
// Subcollection: wallets/{userId}/ledger/{ledgerId}
export interface LedgerDocument {
  id: string;                               // Unique Ledger ID (UUIDv4 or ULID e.g. led_...)
  wallet_id: string;                        // Firebase Auth UID (identical to user_id)
  user_id: string;                          // Firebase Auth UID
  transaction_id: string;                   // Associated Transaction ID
  transaction_reference: string;            // Business Reference (e.g. ALX-TX-...)
  entry_type: LedgerEntryType;              // CREDIT | DEBIT
  direction: LedgerDirection;               // INFLOW | OUTFLOW
  amount_kobo: IntegerKobo;                 // Strictly positive integer kobo (> 0)
  balance_before_kobo: IntegerKobo;         // Balance before entry (>= 0)
  balance_after_kobo: IntegerKobo;          // Running balance snapshot (>= 0, <= MAX_ACCOUNT_BALANCE_KOBO)
  category: LedgerCategory;                 // Financial category (WALLET_FUNDING, AIRTIME_PURCHASE, etc.)
  description: string;                      // Human-readable audit narrative
  actor: LedgerActor;                       // { type: 'SYSTEM' | 'ADMIN' | 'USER' | 'CUSTOMER', id: string }
  created_at: FirestoreTimestamp;           // ISO-8601 string / Timestamp
}
```

---

## 4. Ledger Categories and Entry Types

| Entry Type | Allowed Direction | Typical Categories | Arithmetic Invariant |
|---|---|---|---|
| `CREDIT` | `INFLOW` | `WALLET_FUNDING`, `REFUND`, `REVERSAL`, `ADMIN_CREDIT` | `balance_after_kobo === balance_before_kobo + amount_kobo` |
| `DEBIT` | `OUTFLOW` | `AIRTIME_PURCHASE`, `DATA_PURCHASE`, `ELECTRICITY_BILL`, `CABLE_TV`, `ADMIN_DEBIT` | `balance_after_kobo === balance_before_kobo - amount_kobo` *(requires `balance_before_kobo >= amount_kobo`)* |

---

## 5. Integer Kobo & Running Balance Rules

- **Base Currency:** Nigerian Naira (`NGN`).
- **Sub-unit:** Kobo ($100\text{ kobo} = \text{₦}1.00$).
- **Strict Positive Amounts:** `amount_kobo` must be an integer $> 0$. Zero, negative values, floats, decimals, `NaN`, `Infinity`, and unsafe integers are rejected immediately.
- **Running Balance Snapshot:** `balance_after_kobo` captures the exact resulting wallet balance snapshot immediately after the entry. It is checked against mathematical invariants and capped at `MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO` (₦10,000,000.00 / 1,000,000,000 kobo).
- **Balance Audit Trail:** Running balance is stored per entry; the application does not execute full-table aggregation queries to compute wallet balance.

---

## 6. Immutability & Create-Only Semantics

1. **No Update & No Delete Methods:** The ledger repository deliberately does not expose any `updateLedgerEntry` or `deleteLedgerEntry` functions.
2. **Create-Only Protection:** 
   - Uses Firestore `docRef.create()` semantics which reject execution if the document ID already exists.
   - InMemory store verifies existing ID presence and throws `409 Conflict` (`LEDGER_ENTRY_EXISTS`).
   - Re-submitting an existing ledger ID produces a deterministic conflict error and leaves the original financial record untouched.
3. **Compensating Entries Only:** If financial adjustments or refunds are needed, a new compensating entry (e.g. `REFUND` or `REVERSAL`) is appended; previous records are never mutated.

---

## 7. Server-Only Authority & Security Boundary

- **Client Prohibited from Direct Writes:** Firestore Security Rules deny direct client creation or modification of `wallets/{userId}/ledger/*`.
- **Admin SDK Enforcement:** All ledger creation operations execute through trusted server-side repository code via the Firebase Admin SDK.
- **Ownership Scoping:**
  - Authenticated user ID is derived exclusively from verified Firebase Auth ID tokens / session tokens (`userContext.uid`).
  - Client-supplied route parameters or body values cannot override authenticated user identity.
  - Users can only read their own ledger journal (`wallets/{uid}/ledger`).

---

## 8. Repository Methods (`src/server/repositories/ledger.repository.ts`)

| Method | Signature | Purpose & Behavior |
|---|---|---|
| `createLedgerEntry` | `(userId: string, entry: LedgerDocument, correlationId?: string) => Promise<LedgerDocument>` | Validates schema, arithmetic invariants, and appends an immutable entry to `wallets/{userId}/ledger/{entry.id}`. Throws 409 if ID already exists. |
| `appendLedgerEntry` | `(userId: string, entry: LedgerDocument, correlationId?: string) => Promise<LedgerDocument>` | Backwards-compatible alias for `createLedgerEntry`. |
| `getLedgerEntry` | `(userId: string, ledgerId: string, correlationId?: string) => Promise<LedgerDocument \| null>` | Retrieves single ledger entry under `wallets/{userId}/ledger/{ledgerId}` and runs invariant validation. Returns `null` if not found. |
| `getLedgerEntryById`| `(userId: string, ledgerId: string, correlationId?: string) => Promise<LedgerDocument \| null>` | Backwards-compatible alias for `getLedgerEntry`. |
| `queryLedgerByWalletId` | `(userId: string, options?: LedgerQueryOptions, correlationId?: string) => Promise<PaginatedResult<LedgerDocument>>` | Returns cursor-paginated statement ordered by `created_at DESC`, with optional `entry_type` filtering. |
| `validateLedgerEntry` | `(entry: unknown, correlationId?: string) => asserts entry is LedgerDocument` | Validates schema, safe kobo ranges, arithmetic balance identity, positive amounts, and maximum balance ceiling. |

---

## 9. Server Endpoints (`server.ts`)

1. **`GET /api/v1/wallet/ledger`**
   - **Auth:** Bearer token required.
   - **Query Params:** `limit` (number, default 20, max 100), `cursor` (string), `entry_type` (`CREDIT` | `DEBIT`).
   - **Response:** Paginated items, `nextCursor`, and `hasMore`.

2. **`GET /api/v1/wallet/ledger/:ledgerId`**
   - **Auth:** Bearer token required.
   - **Response:** Single `LedgerDocument` or 404 `LEDGER_ENTRY_NOT_FOUND`.

---

## 10. Automated Test Suite (`src/server/tests/ledger-immutable.test.ts`)

| Test Suite | Scope | Result |
|---|---|:---:|
| **Test A** | Ledger entry creation (`CREDIT`, `DEBIT`, `REFUND`) | **PASS** |
| **Test B** | Monetary integer kobo validation, zero/negative/float/NaN/Infinity rejection | **PASS** |
| **Test C** | Running balance snapshot arithmetic verification & mismatch rejection | **PASS** |
| **Test D & E** | Immutability enforcement, duplicate creation prevention (409 Conflict) | **PASS** |
| **Test F** | References, actor, and schema validation | **PASS** |
| **Test G** | Multi-tenant ownership and cross-user isolation | **PASS** |
| **Test H** | Cursor-based pagination and deterministic `created_at DESC` sorting | **PASS** |

### Complete Regression Test Run:
- `auth-provisioning.test.ts`: **19/19 PASSED (100%)**
- `repositories-validation.test.ts`: **12/12 PASSED (100%)**
- `wallet-foundation.test.ts`: **7/7 PASSED (100%)**
- `ledger-immutable.test.ts`: **8/8 PASSED (100%)**

---

## 11. Typecheck, Lint, and Build Results

- **Typecheck (`npm run lint`):** `tsc --noEmit` completed with **0 errors**.
- **Production Build (`npm run build`):** Built successfully.

---

## 12. Files Created / Modified

- `src/server/repositories/ledger.repository.ts` — Implemented immutable ledger repository with create-only semantics and running balance snapshot validation.
- `src/lib/api/errors.ts` — Added ledger error codes (`LEDGER_ENTRY_NOT_FOUND`, `LEDGER_ENTRY_EXISTS`, `INVALID_LEDGER_ENTRY`, `IMMUTABLE_RECORD_MODIFICATION`, `CONFLICT`).
- `server.ts` — Added `GET /api/v1/wallet/ledger` and `GET /api/v1/wallet/ledger/:ledgerId` endpoints.
- `src/server/tests/ledger-immutable.test.ts` — Automated test suite for Stage 2.5.2.
- `docs/alexvya-stage-2.5.2-immutable-wallet-ledger.md` — Stage 2.5.2 architectural documentation report.

---

## 13. Deviations from Locked Architecture

**None.** The implementation adheres strictly to Stage 1.1, Stage 1.3, Stage 1.4, Stage 1.5, Stage 2.4, and Stage 2.5.1 specifications.

---

## 14. Stage 2.5.2 Final Status

```text
STATUS: PASS
```
