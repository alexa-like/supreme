# Alexvya — Stage 2.5.1: Wallet Foundation

**Document Version:** 1.0.0  
**Status:** Approved & Verified Implementation Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** React 19 / Vite 8 / TypeScript 5.7+ / Node.js Express / Cloud Firestore / Firebase Admin SDK  
**Current Stage:** Stage 2.5.1 (Wallet Foundation)  
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

---

## 1. Objective

The objective of Stage 2.5.1 is to establish the foundational authoritative wallet balance layer for the Alexvya platform, adhering strictly to the **Locked Wallet Terminology**:  
> **"Immutable Single-Account Wallet Balance Journal with Running Balance Snapshots"**

The wallet document at canonical path `wallets/{userId}` serves as the single authoritative record of current customer wallet state, while the nested `ledger` subcollection (to be implemented in subsequent Stage 2.5 sub-levels) provides the immutable audit journal.

---

## 2. Implementation Summary

1. **Authoritative Wallet Repository (`src/server/repositories/wallets.repository.ts`):**
   - Implemented server-authoritative methods: `ensureWallet`, `getWallet`, `getWalletByUserId`, `validateWalletState`, `enforceWalletStatus`, `getWalletVersion`, and `readWalletState`.
   - Guaranteed server-only execution isolation using Firebase Admin SDK.
   - Enforced idempotent wallet initialization without balance resets.

2. **Strict Financial & Invariant Enforcement:**
   - Enforced integer kobo arithmetic across all balance fields (`available_balance_kobo`, `ledger_balance_kobo`, `locked_balance_kobo`, `daily_spent_kobo`).
   - Implemented mathematical balance check: `ledger_balance_kobo === available_balance_kobo + locked_balance_kobo`.
   - Enforced balance ceilings: `0 <= balance <= MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO` (₦10,000,000.00 / 1,000,000,000 kobo).
   - Enforced integer version counter initialized at `1`.

3. **Server-Side Authorization & Read Route (`server.ts`):**
   - Implemented `GET /api/v1/wallet` endpoint extracting the authenticated user identity strictly from the verified Firebase ID token context (`userContext.uid`).
   - Blocked any client parameter tampering (e.g. `req.body.userId`, query params).

4. **Error Taxonomy Updates (`src/lib/api/errors.ts`):**
   - Standardized machine-readable error codes: `WALLET_NOT_FOUND`, `INVALID_WALLET_STATE`, `BALANCE_INVARIANT_VIOLATION`, `WALLET_LOCKED`, `WALLET_FROZEN`.

---

## 3. Authoritative Wallet Schema

```typescript
// Canonical Document: wallets/{userId}
export interface WalletDocument {
  id: string;                               // Firebase Auth UID (authoritative document ID)
  user_id: string;                          // Firebase Auth UID (identical to id)
  currency: 'NGN';                          // Fixed ISO Currency
  available_balance_kobo: IntegerKobo;      // Spendable funds (>= 0)
  ledger_balance_kobo: IntegerKobo;         // Total settled funds (>= 0)
  locked_balance_kobo: IntegerKobo;         // In-flight escrow/pending holds (>= 0)
  status: WalletStatus;                     // ACTIVE | LOCKED | FROZEN
  daily_spent_kobo: IntegerKobo;            // Cumulative daily spend in kobo
  last_ledger_entry_id: string | null;      // Pointer to most recent journal entry
  version: number;                          // Monotonic optimistic concurrency counter (>= 1)
  created_at: FirestoreTimestamp;           // ISO-8601 string / Timestamp
  updated_at: FirestoreTimestamp;           // ISO-8601 string / Timestamp
}
```

---

## 4. Repository Methods

| Method | Signature | Purpose & Behavior |
|---|---|---|
| `ensureWallet` | `(userId: string, correlationId?: string) => Promise<WalletDocument>` | Idempotently initializes `wallets/{userId}` with zero balance and `version = 1`. If already present, returns existing wallet unchanged. |
| `getWallet` | `(userId: string, correlationId?: string) => Promise<WalletDocument \| null>` | Retrieves authoritative wallet and executes `validateWalletState`. Returns `null` if not found. |
| `validateWalletState` | `(wallet: unknown, correlationId?: string) => asserts wallet is WalletDocument` | Validates schema structure, safe kobo ranges, mathematical balance relationship, and version counter. Throws `AlexvyaApiError` on violation. |
| `enforceWalletStatus` | `(wallet: WalletDocument, correlationId?: string) => void` | Validates that wallet is `ACTIVE`. Throws 403 `WALLET_LOCKED` or `WALLET_FROZEN` if status is restricted. |
| `getWalletVersion` | `(userId: string, correlationId?: string) => Promise<number \| null>` | Returns the current monotonic version counter for concurrency control. |
| `readWalletState` | `(userId: string, correlationId?: string) => Promise<WalletSnapshot \| null>` | Returns sanitized balance and version snapshot. |

---

## 5. Wallet Invariants

The platform enforces five non-negotiable financial invariants at runtime:

1. **Non-Negativity:**  
   $$\text{available\_balance\_kobo} \ge 0, \quad \text{ledger\_balance\_kobo} \ge 0, \quad \text{locked\_balance\_kobo} \ge 0$$
2. **Authoritative Balance Identity:**  
   $$\text{ledger\_balance\_kobo} = \text{available\_balance\_kobo} + \text{locked\_balance\_kobo}$$
3. **Safe Integer Limits:**  
   All monetary amounts must satisfy `Number.isSafeInteger(v)` and $0 \le v \le 1,000,000,000 \text{ kobo}$ ($\le \text{₦10,000,000.00}$).
4. **Version Monotonicity:**  
   $$\text{version} \in \mathbb{Z}^+, \quad \text{version} \ge 1$$
5. **No Silent Mutation / Corruption Repair:**  
   Any invariant violation immediately raises a deterministic 500 error (`BALANCE_INVARIANT_VIOLATION` or `INVALID_WALLET_STATE`) and aborts execution.

---

## 6. Security Boundaries & Client Isolation

- **Zero Client-Side Write Access:** Cloud Firestore security rules prohibit direct client writes to the `wallets` collection.
- **Server-Only Authority:** Only the Node.js / Express backend using the Firebase Admin SDK can create or mutate wallet records.
- **Immutable User Identity:** Customer wallet ownership is derived exclusively from verified Firebase Authentication ID tokens (`userContext.uid`). Client-supplied body or query parameters cannot alter or substitute wallet ownership.

---

## 7. Idempotent Initialization Behavior

Calling `ensureWallet(userId)` follows strict idempotent rules:
1. Performs a sanitized lookup for document `wallets/{userId}`.
2. If document exists, performs invariant verification and returns the existing document unmodified.
3. If document does not exist, provisions a new record with zero balances and `version = 1`.
4. Guarantees zero duplicate documents and zero risk of balance overwrites upon repeated customer logins or sync requests.

---

## 8. Versioning Foundation

The `version` field provides the foundation for atomic financial mutations and optimistic locking:
- Initialized to `1` upon creation.
- Preserved across read and initialization calls.
- Validated to ensure it is always an integer $\ge 1$.
- Atomic debit/credit and version increments will be implemented in subsequent Stage 2.5 sub-levels.

---

## 9. Money Validation

All monetary values adhere to the Stage 2.4 / Stage 1.1 integer arithmetic constraints:
- Base currency: Nigerian Naira (`NGN`).
- Sub-unit: Kobo ($100 \text{ kobo} = \text{₦}1.00$).
- Floating-point representations, strings, `NaN`, `Infinity`, negative numbers, and unsafe integers are rejected at the schema and repository boundary.

---

## 10. Test Execution & Verification

Automated test suite `src/server/tests/wallet-foundation.test.ts` executes 7 major test suites:

| Suite | Scope | Result |
|---|---|:---:|
| **Test A** | Wallet creation with zero balances and version 1 | **PASS** |
| **Test B** | Idempotent initialization across repeated calls | **PASS** |
| **Test C** | Preservation of funded wallet state upon ensureWallet | **PASS** |
| **Test D** | Ownership and identity boundary (authoritative UID enforcement) | **PASS** |
| **Test E** | Monetary safe integer, float, NaN, Infinity, string rejection | **PASS** |
| **Test F** | Invariant validation (negative balances, sum mismatch, invalid version, status enforcement) | **PASS** |
| **Test G** | Client isolation & server-only authority | **PASS** |

### Complete Test Run Output:
- `auth-provisioning.test.ts`: **19/19 PASSED (100%)**
- `repositories-validation.test.ts`: **12/12 PASSED (100%)**
- `wallet-foundation.test.ts`: **7/7 PASSED (100%)**

---

## 11. Typecheck & Build Results

- **Typecheck (`npm run lint`):** `tsc --noEmit` completed with **0 errors**.
- **Production Build (`npm run build`):** Compiled successfully.

---

## 12. Files Created / Modified

- `src/lib/api/errors.ts` — Added wallet-specific error taxonomy codes.
- `src/server/repositories/wallets.repository.ts` — Implemented authoritative repository methods and invariant validation.
- `server.ts` — Added authenticated `GET /api/v1/wallet` endpoint.
- `src/server/tests/wallet-foundation.test.ts` — Automated test suite for Stage 2.5.1.
- `docs/alexvya-stage-2.5.1-wallet-foundation.md` — Stage 2.5.1 architectural documentation report.

---

## 13. Deviations from Locked Architecture

**None.** The implementation follows the locked Stage 1.1, Stage 1.3, Stage 1.5, and Stage 2.4 specifications exactly.

---

## 14. Stage 2.5.1 Final Status

```text
STATUS: PASS
```
