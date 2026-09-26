# Alexvya — Stage 2.5.4: Idempotency & Concurrency Protection

**Document Version:** 1.0.0  
**Status:** Approved & Verified Implementation Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** React 19 / Vite 8 / TypeScript 5.7+ / Node.js Express / Cloud Firestore / Firebase Admin SDK  
**Current Stage:** Stage 2.5.4 (Idempotency & Concurrency Protection)  
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
- `docs/alexvya-stage-2.5.2-immutable-wallet-ledger.md` (Locked)
- `docs/alexvya-stage-2.5.3-atomic-wallet-mutations.md` (Locked)

---

## 1. Executive Summary & Core Objective

The core objective of Stage 2.5.4 is to harden the financial mutation engine (`creditWallet`, `debitWallet`, `refundWallet`) against duplicate requests, network retries, browser double-submissions, concurrent race conditions, cross-user replays, and duplicate refunds.

The fundamental architectural principle is:
> **$\text{ONE FINANCIAL OPERATION} = \text{ONE FINANCIAL EFFECT}$**

Any subsequent retry of an already completed financial operation safely returns the cached original result with `isIdempotentReplay: true` instead of executing a second financial mutation.

---

## 2. Idempotency Architecture & Flow

```
                                  Client Request (Idempotency-Key)
                                                 │
                                                 ▼
                               ┌───────────────────────────────────┐
                               │  Header / Key Format Validation   │
                               │   (8 - 128 alphanumeric chars)    │
                               └─────────────────┬─────────────────┘
                                                 │
                                                 ▼
                               ┌───────────────────────────────────┐
                               │ Compute SHA-256 Fingerprint       │
                               │  (Canonical JSON of business data)│
                               └─────────────────┬─────────────────┘
                                                 │
                                                 ▼
                               ┌───────────────────────────────────┐
                               │   Firestore Transaction Boundary  │
                               │   (Read idempotencyKeys/{key})    │
                               └─────────────────┬─────────────────┘
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        │                                                 │
                [Document Exists]                               [Document Not Found]
                        │                                                 │
        ┌───────────────┴───────────────┐                                 ▼
        │                               │                  ┌───────────────────────────────┐
 [User / Hash Mismatch]          [Status: COMPLETED]       │ Read & Validate Wallet State  │
        │                               │                  │ (available, ledger, status)   │
        ▼                               ▼                  └──────────────┬────────────────┘
 403 FORBIDDEN /                 Return Cached                    │
 409 IDEMPOTENCY_CONFLICT        Response Body                    ▼
 (No financial effect)           (isIdempotentReplay: true)┌───────────────────────────────┐
                                 (0 balance/version change)│ Perform Balance Math (kobo)   │
                                                           │ Increment Version (v = v + 1) │
                                                           │ Create Ledger Journal Record  │
                                                           │ Create Idempotency Key Record │
                                                           │ (status: COMPLETED)           │
                                                           └──────────────┬────────────────┘
                                                                          │
                                                                          ▼
                                                           ┌───────────────────────────────┐
                                                           │ Atomic Commit (Wallet+Ledger+ │
                                                           │ Idempotency Key)              │
                                                           └───────────────────────────────┘
```

---

## 3. Request Fingerprinting Engine

To prevent malicious or accidental payload mutations under the same idempotency key, request fingerprints are generated using a deterministic SHA-256 hash over canonical JSON serialization.

### 3.1 Canonicalization Rules:
- Keys are sorted lexicographically at every object depth.
- Non-deterministic values (such as timestamps, ephemeral random IDs, and client IP headers) are strictly excluded from the fingerprint payload.
- Canonical JSON output format: `{"amount_kobo":100000,"category":"AIRTIME_PURCHASE",...}`.

### 3.2 Fingerprint Schemas:
- **Credit:** `{ user_id, operation_type: 'CREDIT', amount_kobo, category, description, transaction_id, transaction_reference }`
- **Debit:** `{ user_id, operation_type: 'DEBIT', amount_kobo, category, description, transaction_id, transaction_reference }`
- **Refund:** `{ user_id, operation_type: 'REFUND', amount_kobo, original_transaction_id, original_transaction_reference }`

If a client sends an existing `Idempotency-Key` with a different payload (e.g., changing `amount_kobo` from ₦1,000 to ₦2,000), the system rejects the request with `409 IDEMPOTENCY_CONFLICT`.

---

## 4. Locked Deduplication & Retention Lifecycles

Alexvya enforces the Stage 1.1 domain-specific deduplication lifecycles:

| Operation Category | Storage Path | Retention Window (TTL) | Rationale & Protection Scope |
|---|---|:---:|---|
| **VAS Purchases** (`airtime`, `data`, `bills`) | `idempotencyKeys/{key}` | **24 Hours** | Prevents rapid double-clicks and client retry bursts during active purchase windows. |
| **Paystack Funding Initializations** | `idempotencyKeys/{key}` | **72 Hours** | Covers Paystack checkout window, bank transfer validation, and offline grace periods. |
| **Payment Verification Dedup** | Unique gateway reference | **90 Days** | Ensures reconciliation sweeps and webhook retries cannot double-credit gateway charges. |
| **Third-Party Webhooks** | `webhookEvents/{hash}` | **30 Days** | Provider retry policies resend webhooks for days during upstream outages. |
| **Refunds & Admin Adjustments** | `idempotencyKeys/{ref_dedup_id}` | **Indefinite (100 Years)** | Permanent deduplication tied directly to parent `transactionId`. |

---

## 5. Concurrency Strategy & Race Condition Protection

### 5.1 Concurrent Same-Key Double-Clicks:
- When two identical requests with the same key arrive concurrently:
  - The Firestore transaction boundary (and in-memory async mutex serialization in test environments) serializes execution.
  - The first transaction to commit deducts the balance, increments the version, and sets the idempotency document to `COMPLETED`.
  - The second concurrent request reads the committed `COMPLETED` record, validates the matching fingerprint, and returns the cached result with `isIdempotentReplay: true`.
  - **Outcome:** 1 debit, 1 ledger entry, 1 version increment.

### 5.2 Concurrent Different-Key Operations (No Lost Updates):
- When two legitimate, distinct operations arrive simultaneously on an account with sufficient balance (e.g. ₦2,000 and ₦3,000 debits on ₦15,000 balance):
  - Both transactions execute sequentially via optimistic concurrency retries.
  - Final balance is exactly ₦10,000.
  - Wallet version increments by $+2$.
  - **Outcome:** 2 distinct ledger entries, 0 lost updates.

### 5.3 Insufficient Balance Race:
- When two concurrent debits of ₦1,000 arrive on a wallet with an available balance of ₦1,000:
  - The first transaction commits, reducing balance to ₦0.
  - The second transaction retries, reads the new balance of ₦0, and rejects with `402 INSUFFICIENT_BALANCE`.
  - **Outcome:** 1 success, 1 failure, final balance ₦0, zero negative balance.

---

## 6. Duplicate Refund Protection

- A transaction may only ever be refunded **once**.
- When `refundWallet(...)` is invoked:
  - It permanently registers a deduplication record under `ref_dedup_${originalTransactionId}`.
  - A retry with the identical idempotency key returns the cached refund result (`isIdempotentReplay: true`).
  - Any subsequent refund attempt on the same parent transaction using a new or different idempotency key is rejected with `409 DUPLICATE_REFUND`.
  - Historical debit records are strictly immutable and never altered or deleted.

---

## 7. Verification & Test Suite Summary

The test suite at `src/server/tests/idempotency-concurrency.test.ts` executes comprehensive concurrency and deduplication checks:

| Test Group | Verification Target | Result |
|---|---|:---:|
| **Test A** | Same Request Retry: Identical key yields `isIdempotentReplay: true`, 1 debit, 1 ledger entry, 1 version increment | PASS |
| **Test B** | Same Key Different Amount: Rejection with `IDEMPOTENCY_CONFLICT` (409), wallet untouched | PASS |
| **Test C** | Same Key Different Operation: Cross-operation reuse rejected with `IDEMPOTENCY_CONFLICT` (409) | PASS |
| **Test D** | Concurrent Same-Key Race: `Promise.all` yields exactly 1 financial effect and 1 replay | PASS |
| **Test E** | Concurrent Different-Keys: `Promise.all` concurrent debits execute with 0 lost updates | PASS |
| **Test F** | Concurrent Insufficient Balance: ₦1,000 balance with two ₦1,000 debits $\rightarrow$ 1 success, 1 fail (402), ₦0 final | PASS |
| **Test G** | Duplicate Refund: Permanent deduplication rejects second refund attempt with `DUPLICATE_REFUND` (409) | PASS |
| **Test H** | Failed Mutation Atomicity: Aborted transaction leaves zero dirty idempotency or ledger state | PASS |
| **Test I** | User Isolation: User B cannot reuse or replay User A's idempotency key (403 FORBIDDEN) | PASS |
| **Test J** | Key Validation: Keys <8 chars, >128 chars, containing invalid characters or whitespace rejected | PASS |

### Regression Suite Status:
- `auth-provisioning.test.ts`: **PASS**
- `repositories-validation.test.ts`: **PASS**
- `wallet-foundation.test.ts`: **PASS**
- `ledger-immutable.test.ts`: **PASS**
- `wallet-mutations.test.ts`: **PASS**
- `idempotency-concurrency.test.ts`: **PASS**
- TypeScript Compilation (`npm run lint`): **PASS**
- Vite Applet Build (`npm run build`): **PASS**
