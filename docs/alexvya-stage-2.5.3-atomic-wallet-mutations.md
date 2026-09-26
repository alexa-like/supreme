# Alexvya — Stage 2.5.3: Atomic Wallet Debit/Credit Engine

**Document Version:** 1.0.0  
**Status:** Approved & Verified Implementation Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** React 19 / Vite 8 / TypeScript 5.7+ / Node.js Express / Cloud Firestore / Firebase Admin SDK  
**Current Stage:** Stage 2.5.3 (Atomic Wallet Debit/Credit Engine)  
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

---

## 1. Objective

The objective of Stage 2.5.3 is to establish the authoritative server-side atomic wallet mutation engine for the Alexvya platform. 

This engine implements the core primitives:
1. `creditWallet(...)` — Atomic balance increase + immutable `CREDIT` ledger entry
2. `debitWallet(...)` — Atomic balance decrease + immutable `DEBIT` ledger entry
3. `refundWallet(...)` — Atomic compensating balance increase + immutable `REFUND` ledger entry

The non-negotiable architectural invariant of this stage is:
> **$\text{WALLET STATE CHANGE} + \text{LEDGER ENTRY} = \text{ONE ATOMIC OPERATION}$**

If any phase of the transaction fails, neither the wallet document nor the immutable ledger subcollection commits partial financial state.

---

## 2. Architectural Architecture & Invariants

```
                        ┌────────────────────────────────────────────────────────┐
                        │              Server Domain Invocation                  │
                        │    (Webhook / VAS Purchase / Admin / Compensator)      │
                        └──────────────────────────┬─────────────────────────────┘
                                                   │
                                                   ▼
                        ┌────────────────────────────────────────────────────────┐
                        │          Firestore Transaction Boundary                │
                        │            (db.runTransaction / Atomic)                │
                        │                                                        │
                        │ 1. Read & Validate Wallet State (wallets/{userId})     │
                        │ 2. Enforce Account & Wallet Status (ACTIVE only)       │
                        │ 3. Check Financial Bounds & Caps                       │
                        │    - Debit: available_balance_kobo >= amount_kobo      │
                        │    - Credit: ledger_balance <= MAX_ACCOUNT_BALANCE     │
                        │ 4. Compute New Balances (Exact Integer Kobo)           │
                        │ 5. Increment Monotonic Version (version = v + 1)       │
                        │ 6. Generate & Validate Immutable Ledger Entry          │
                        │    (wallets/{userId}/ledger/{ledgerId})                │
                        │ 7. Write Ledger Document & Update Wallet Document      │
                        └──────────────────────────┬─────────────────────────────┘
                                                   │
                                  ┌────────────────┴────────────────┐
                                  │                                 │
                         [Transaction Commit]              [Exception / Abort]
                                  │                                 │
                                  ▼                                 ▼
                     ┌─────────────────────────┐       ┌─────────────────────────┐
                     │ Atomic State Persisted: │       │ Transaction Rollback:   │
                     │ - Wallet balance & ver  │       │ - Zero balance change   │
                     │ - Ledger entry recorded │       │ - No ledger entry       │
                     └─────────────────────────┘       └─────────────────────────┘
```

### Core Invariants:
1. **Atomicity Guarantee:** A mutation never modifies the wallet without appending a ledger entry, and never appends a ledger entry without modifying the wallet.
2. **Strict Integer Kobo Arithmetic:** All monetary amounts are non-negative safe integers (`Number.isSafeInteger(v)` and $v > 0$). Floating-point calculations are strictly prohibited.
3. **Running Balance Snapshots:** Every ledger entry records `balance_before_kobo` and `balance_after_kobo`, satisfying:
   - Credit / Refund: $\text{balance\_after} = \text{balance\_before} + \text{amount}$
   - Debit: $\text{balance\_after} = \text{balance\_before} - \text{amount}$ ($\text{balance\_before} \ge \text{amount}$)
4. **Monotonic Concurrency Versioning:** Every successful mutation increments `wallet.version` by exactly $+1$. Failed or aborted mutations do not advance the version counter.
5. **Compensating Refund Semantics:** Refunds create a new `CREDIT` entry under category `REFUND`. Historical debit records are strictly immutable and never altered or deleted.
6. **Zero Side-Effects Inside Transaction:** No network calls (Paystack, VTpass, ClubKonnect, HTTP) execute inside the transaction block.

---

## 3. Implemented Engine Primitives

### 3.1 `creditWallet(params: CreditWalletParams)`
- **Purpose:** Adds funds to customer wallet upon successful deposit or administrative credit.
- **Validations:**
  - `amountKobo > 0` and safe integer.
  - Wallet exists and `status === ACTIVE`.
  - Resulting `ledger_balance_kobo <= MONEY_CONSTANTS.MAX_ACCOUNT_BALANCE_KOBO` (₦10,000,000.00 / 1,000,000,000 kobo).
- **Mutations:**
  - `available_balance_kobo += amountKobo`
  - `ledger_balance_kobo += amountKobo`
  - `version += 1`
  - `last_ledger_entry_id = ledgerEntry.id`
  - Appends `CREDIT` (`INFLOW`) ledger entry.

### 3.2 `debitWallet(params: DebitWalletParams)`
- **Purpose:** Deducts funds from customer wallet to fulfill VAS services (airtime, data, electricity, cable).
- **Validations:**
  - `amountKobo > 0` and safe integer.
  - Wallet exists and `status === ACTIVE`.
  - `available_balance_kobo >= amountKobo` (Throws 402 `INSUFFICIENT_BALANCE` on failure).
- **Mutations:**
  - `available_balance_kobo -= amountKobo`
  - `ledger_balance_kobo -= amountKobo`
  - `daily_spent_kobo += amountKobo`
  - `version += 1`
  - `last_ledger_entry_id = ledgerEntry.id`
  - Appends `DEBIT` (`OUTFLOW`) ledger entry.

### 3.3 `refundWallet(params: RefundWalletParams)`
- **Purpose:** Issues a compensating credit when a service purchase fails upstream.
- **Validations:**
  - `amountKobo > 0` and safe integer.
  - `originalTransactionId` and `originalTransactionReference` provided.
  - Wallet exists and `status === ACTIVE`.
- **Mutations:**
  - `available_balance_kobo += amountKobo`
  - `ledger_balance_kobo += amountKobo`
  - `daily_spent_kobo = max(0, daily_spent_kobo - amountKobo)`
  - `version += 1`
  - `last_ledger_entry_id = ledgerEntry.id`
  - Appends `CREDIT` (`INFLOW`, `category: REFUND`) ledger entry preserving reference to original transaction.

---

## 4. Verification & Test Suite Summary

The test suite at `src/server/tests/wallet-mutations.test.ts` executes end-to-end atomic mutation verifications:

| Test Group | Target Verification | Result |
|---|---|:---:|
| **Test A** | Wallet Credit: balance increase, version increment, running snapshot, immutable ledger entry | PASS |
| **Test B** | Wallet Debit: balance decrease, daily spend tracking, version increment, ledger entry | PASS |
| **Test C** | Insufficient Balance: debit > balance rejected (402), 0 balance change, 0 version change | PASS |
| **Test D** | Compensating Refund: balance restoration, original debit record untouched, refund entry created | PASS |
| **Test E** | Maximum Balance Cap: funding up to ₦10,000,000 succeeds, overflow rejected (400) | PASS |
| **Test F** | Invalid Amounts: rejection of 0, negative, floating-point, NaN, Infinity, unsafe integers | PASS |
| **Test G** | Invariants & Status: rejection of LOCKED and FROZEN wallets (403) | PASS |
| **Test H** | Atomic Isolation: non-existent wallet rejection without side-effects | PASS |
| **Test I & J**| Monotonic Versioning & Full Ledger Statement Traceability | PASS |

### Regression Suite Status:
- `auth-provisioning.test.ts`: **PASS**
- `repositories-validation.test.ts`: **PASS**
- `wallet-foundation.test.ts`: **PASS**
- `ledger-immutable.test.ts`: **PASS**
- `wallet-mutations.test.ts`: **PASS**
- TypeScript Compilation: **PASS**
