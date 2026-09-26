# Alexvya — Stage 1.5: Transaction State Machines & Financial Lifecycle Specification

**Document Version:** 1.1.0 (Correction Review Applied)  
**Status:** Approved Architectural Specification Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** Next.js (App Router) / TypeScript / Firebase Authentication / Cloud Firestore / Firebase Admin SDK / Paystack / VTpass / ClubKonnect / Resend  
**Current Stage:** Stage 1.5 (Transaction State Machines & Financial Lifecycle Specification)  
**Preceding Stages (All Locked):**  
- `docs/alexvya-stage-0-project-foundation.md`  
- `docs/alexvya-stage-1-product-blueprint.md`  
- `docs/alexvya-stage-1.1-firestore-database-architecture.md`  
- `docs/alexvya-stage-1.2-provider-pricing-architecture.md`  
- `docs/alexvya-stage-1.3-firebase-security-architecture.md`  
- `docs/alexvya-stage-1.4-api-specification.md`

---

## 1. State Machine Principles & Domain Boundary Separation

Financial correctness in Alexvya requires strict decoupling between external protocol states, internal operational fulfillment records, and authoritative customer balances. A provider's HTTP status or raw vendor response must **never** directly mutate an Alexvya financial balance without server-side validation, normalization, and state translation.

### 1.1 Domain State Boundary Definitions

| State Domain | Primary Entity / Collection | Authority & Purpose |
|---|---|---|
| **Universal Transaction State** | `transactions/{transactionId}` | **Primary Customer-Facing Source of Truth.** Represents the lifecycle of the customer's financial transaction (`PENDING`, `SUCCESSFUL`, `FAILED`, `REFUNDED`, `REVERSED`, `UNKNOWN`). |
| **Payment Attempt State** | `paymentAttempts/{attemptId}` | **Gateway Ingestion Lifecycle.** Tracks Paystack checkout attempts (`PENDING`, `SUCCESSFUL`, `FAILED`, `ABANDONED`). Isolated from customer wallet balances until verified. |
| **Service Order State** | `serviceOrders/{orderId}` | **Internal Fulfillment Operations.** Tracks Alexvya's business process for delivering digital value (`PENDING`, `PROCESSING`, `SUCCESSFUL`, `FAILED`, `UNKNOWN`). Synchronized with domain sub-orders (`airtimeOrders`, `dataOrders`, `billOrders`). |
| **Provider Transaction State** | `providerTransactions/{txId}` | **External Vendor Audit Journal.** Records raw requests, vendor references, response payloads, and normalized provider states (`ACCEPTED`, `PROCESSING`, `SUCCESS`, `FAILED`, `REVERSED`, `REFUNDED`, `UNKNOWN`). |
| **Wallet Mutation State** | `wallets/{userId}` & `ledger` | **Authoritative Customer Journal.** Atomic balance changes governed by running version numbers and immutable, single-account journal entries with running balance snapshots. |
| **Refund / Reversal State** | `transactions.settlement_economics` | **Financial Settlement Life-Cycle.** Tracks whether original economics were refunded to the customer or reversed by the upstream provider. |
| **Reconciliation State** | `serviceOrders.reconciliation_status` | **Discrepancy Resolution.** Tracks unresolved or ambiguous transactions undergoing automated polling or manual administrative investigation (`NONE`, `SCHEDULED_POLLING`, `MANUAL_REVIEW`, `RESOLVED`). |

---

## 2. Explicit Firestore / External Provider Execution Boundary

A foundational architectural requirement of Alexvya is the strict isolation between atomic database transactions and external network communications.

### 2.1 The Architectural Rule
> **MANDATORY INVARIANT:** External provider API calls (e.g. Paystack, VTpass, ClubKonnect) **MUST NEVER** occur inside a Cloud Firestore `runTransaction` block.

### 2.2 Why This Boundary Exists
1. **Firestore Timeout & Contention Constraints:** Firestore transactions enforce a strict 10-second maximum execution timeout and automatically abort/retry if underlying documents change. External provider HTTP calls can suffer network latency, DNS delays, or server hangs (taking 5–30 seconds), which would cause extreme lock contention, transaction exhaustion, and system-wide failures.
2. **Side-Effect Duplication Risk:** If an external HTTP call were placed inside a `runTransaction` and Firestore automatically retried the transaction due to a concurrent write, the external provider vend request would be executed multiple times, resulting in duplicate financial dispatch and double-vending.
3. **Clean Failure Domains:** Decoupling database state commitment from external network dispatch allows independent error handling, deterministic idempotency tracking, and robust requery workflows.

### 2.3 Required Conceptual VAS Execution Sequence
```text
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Request Intake & Schema Validation (Zod, Headers, Idempotency-Key) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. Authoritative Price Resolution (Query serviceProducts for discounts)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. Account Eligibility Verification (Status active, limits verified)   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. EXECUTE FIRESTORE ATOMIC TRANSACTION (runTransaction)               │
│    - Read wallets/{userId} (Verify available_balance >= total_charge)  │
│    - Apply authoritative wallet debit (Increment version)             │
│    - Append immutable single-account journal entry (wallets/ledger)    │
│    - Write transactions/{id} (status: "PENDING", freeze original_econ) │
│    - Write serviceOrders/{id} (status: "PENDING", set order_id)        │
│    - Commit Firestore transaction                                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼ [TRANSACTION COMMITTED]
┌────────────────────────────────────────────────────────────────────────┐
│ 5. DISPATCH TO EXTERNAL PROVIDER (OUTSIDE FIRESTORE TRANSACTION)       │
│    - Query active provider from Provider Router                        │
│    - Send HTTPS request using deterministic reference (order_id)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 6. PROCESS PROVIDER RESPONSE & TRANSITION STATE                        │
│    ├── Confirmed SUCCESS ➔ Update transactions ➔ SUCCESSFUL           │
│    ├── Ambiguous TIMEOUT ➔ Keep PENDING ➔ Enqueue Requery Schedule    │
│    └── Confirmed FAILURE ➔ Execute Separate Atomic Restoration Tx:    │
│          - Credit customer wallet (+total_charged_kobo)                │
│          - Append REFUND journal entry in wallets/ledger               │
│          - Transition transactions ➔ REFUNDED                          │
│          - Update settlement_economics                                 │
│          - Record structured audit event in auditLogs                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Provider Dispatch Idempotency Model

Because provider dispatch occurs *after* the wallet transaction has committed, independent dispatch idempotency must be strictly maintained.

### 3.1 Entity Identification Hierarchy

```text
Idempotency-Key (UUIDv4) ──[Enforces 24h Client Request Deduplication]
       │
       ▼
transactions/{transactionId} (ALX-TXN-YYYYMMDD-XXXXXX) ──[Customer Record]
       │
       ▼
serviceOrders/{orderId} (ALX-ORD-YYYYMMDD-XXXXXX) ──[Internal Fulfillment]
       │
       ▼
providerTransactions/{providerTxId} (ALX-PVTX-YYYYMMDD-XXXXXX) ──[Vendor Attempt]
       │
       ▼
External Provider Reference: request_id = orderId ──[Deterministic Vendor Key]
```

### 3.2 Anti-Duplicate Dispatch Rules
1. **Deterministic External Reference:** When dispatching a vend request to VTpass or ClubKonnect, Alexvya uses the unique, deterministic `serviceOrders.order_id` as the external `request_id`.
2. **Requery Over Re-Dispatch:** If an initial outbound provider call times out or drops, the system **NEVER** re-sends a `/pay` or `/vend` request. All subsequent automated attempts (T+30s through T+270s) and manual administrator retries query the provider's `/requery` endpoint using the exact same `orderId`.
3. **Single Active Provider Attempt:** A `serviceOrder` can only have one active `providerTransaction` at any time. Multi-provider dispatch races are prohibited.

---

## 4. Universal Transaction State Machine (`transactions`)

The `transactions/{transactionId}` document is the authoritative customer-facing record.

```text
                           ┌───────────────────┐
                           │      CREATED      │
                           │(Idempotency Locked)
                           └─────────┬─────────┘
                                     │ Wallet Debited (VAS) / Checkout Initialized (Funding)
                                     ▼
                           ┌───────────────────┐
                           │      PENDING      │◄─────────────────────────┐
                           │ (Committed/Active)│                          │
                           └─────────┬─────────┘                          │
                                     │ Provider Dispatched / Requery Active
                                     ▼                                    │
                           ┌───────────────────┐                          │
                           │    PROCESSING     │                          │
                           │  (In Provider)    │                          │
                           └─────────┬─────────┘                          │
                                     │                                    │
         ┌───────────────────────────┼───────────────────────────┐        │
         │ Confirmed Success         │ Confirmed Failure         │ T+300s │
         ▼                           ▼                           ▼ Timeout│
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┤
│   SUCCESSFUL    │         │     FAILED      │         │     UNKNOWN     │
│   (Terminal)    │         │   (Terminal)    │         │(Admin Reconcile)│
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         │ Provider Reversal         │ Auto-Refunded             │ Manual Resolution
         ▼                           ▼                           ▼
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│    REVERSED     │         │    REFUNDED     │◄────────┤   SUCCESSFUL /  │
│   (Terminal)    │         │   (Terminal)    │         │     FAILED      │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

### 4.1 State Definitions & Invariants

1. **`CREATED`**: Initial state generated when request passes schema validation and locks `idempotencyKeys/{key}`. Transitory; not exposed in user feeds.
2. **`PENDING`**: Financial commitment state.
   - For VAS: Customer wallet debited atomically, single-account journal entry appended, order enqueued for provider dispatch.
   - For Funding: Paystack checkout initialized, awaiting payment.
3. **`PROCESSING`**: Outbound provider HTTP request dispatched or provider returned asynchronous processing acknowledgement (`ACCEPTED` / `PROCESSING`).
4. **`SUCCESSFUL`**: Terminal success. Digital value verified delivered. Gross profit is recognized in `settlement_economics`.
5. **`FAILED`**: Terminal failure. Payment aborted or rejected prior to balance debit.
6. **`UNKNOWN`**: Ambiguous state reached **only** when provider request times out and all 5 automated requery attempts (T+30s through T+270s) fail to resolve delivery status by T+300s. Freezes automatic processing; escalates to manual administrative reconciliation.
7. **`REFUNDED`**: Terminal lifecycle state. Customer wallet has been credited back the full charged amount following a confirmed failure or manually resolved order. `original_economics` remains frozen; `settlement_economics.refund_amount_kobo` records the refund.
8. **`REVERSED`**: Terminal lifecycle state. Provider retracted a previously successful delivery and refunded merchant balance. Customer wallet is credited back and gross profit is reversed.

---

## 5. Wallet Funding State Machine (Paystack Integration)

```text
[Customer Browser]           [Alexvya Server]              [Paystack Gateway]
       │                             │                              │
       │── POST /fund/initialize ───►│                              │
       │   (Idempotency: 72h)        │── POST /transaction/init ───►│
       │                             │◄── auth_url, reference ──────│
       │                             │                              │
       │                             │ Create paymentAttempts: PENDING
       │                             │ Create transactions: PENDING │
       │◄── Redirect to Paystack ────│                              │
       │                             │                              │
       │════════════ Customer Enters Card / USSD ═══════════════════│
       │                             │                              │
       │── GET /fund/verify/:ref ───►│                              │
       │   (Redirect Verification)   │── GET /transaction/verify ──►│
       │                             │◄── Status: success ──────────│
       │                             │    Atomic Firestore Tx:      │
       │                             │    (Checks if already SUCCESS)
       │                             │    Credit wallets/{userId}   │
       │                             │    Append journal (CREDIT)   │
       │                             │    transactions ➔ SUCCESSFUL │
       │◄── Display Success Screen ──│                              │
       │                             │                              │
       │                             │◄── Webhook POST (HMAC-SHA512)│
       │                             │    (Deduplication: 30d)      │
       │                             │    Detects already SUCCESS   │
       │                             │── 200 OK ───────────────────►│
```

### 5.1 Verification & Edge-Case Rules
1. **Redirect vs. Webhook Race:** Handled cleanly via Firestore transaction. Whichever arrives first (browser redirect query or gateway webhook) verifies with Paystack, credits the wallet, appends the journal entry, and marks the transaction `SUCCESSFUL`. The subsequent arrival detects the settled terminal state and exits idempotently.
2. **Customer Redirect Not Authoritative:** Browser redirect alone is never treated as proof of payment; server must verify status directly with Paystack REST API.
3. **Webhook Deduplication:** `webhookEvents/{SHA256(PAYSTACK+event_id+ref)}` ensures 30-day idempotent drop of repeated webhooks.
4. **Amount Mismatch Guard:** If Paystack reports success for an amount less than `paymentAttempts.amount_kobo`, status is marked `FAILED_MISMATCH`, zero funds are credited, and an urgent security alert is generated in `auditLogs`.

---

## 6. Value-Added Services (VAS) State Machines

### 6.1 Electricity Bill Payment State Machine
The electricity lifecycle is strictly divided into two decoupled phases: **Validation** and **Purchase**.

```text
PHASE 1: METER VALIDATION (Non-Financial, Idempotent)
  Customer submits { disco_code, meter_number, meter_type }
       │
       ▼
  Alexvya queries Provider Validation Endpoint
       ├── Provider Returns Valid Customer Name & Address ➔ Return 200 OK (Cache TTL: 15 mins)
       ├── Provider Returns Invalid Meter ➔ Return 422 Unprocessable Entity
       └── Provider Times Out ➔ Return 504 Gateway Timeout (Zero wallet impact)

PHASE 2: ELECTRICITY PURCHASE (Financial, Decoupled Execution)
  Customer submits { disco_code, meter_number, meter_type, customer_name, amount_kobo }
       │
       ▼
  1. Authoritative price & convenience fee resolved server-side from serviceProducts.
  2. Total charged = amount_kobo + fee_kobo.
  3. Execute Firestore Transaction (Debit wallet, append journal, commit PENDING transaction).
  4. Dispatch to Provider Vend API (Outside Firestore Transaction):
       ├── Provider SUCCESS:
       │     Extract normalized token payload:
       │       - token: "1234-5678-9012-3456-7890" (or Disco specific format)
       │       - token_type: "STS_STANDARD"
       │       - units: "68.4 kWh"
       │       - receipt_number: "REC-IKEDC-992019"
       │       - token_metadata: { disco_reference, bsst_token }
       │     Update transactions ➔ SUCCESSFUL. Persist token in billOrders.
       ├── Provider AMBIGUOUS TIMEOUT:
       │     Keep PENDING. Enqueue automated requery schedule. (DO NOT REFUND YET).
       └── Provider CONFIRMED FAILURE:
             Execute separate atomic restoration transaction (Credit wallet, append REFUND journal).
             Update transactions ➔ REFUNDED.
```

### 6.2 Airtime, Mobile Data & Cable TV State Machines
All digital VAS products strictly adhere to the same execution sequence:
- Server resolves wholesale pricing and customer discount/fee from `serviceProducts`.
- Wallet is debited and single-account journal entry written in a Firestore transaction before dispatch.
- External dispatch executes outside the database transaction.
- Outcomes follow the deterministic tripartite model: Confirmed Success (`SUCCESSFUL`), Confirmed Failure (`REFUNDED` via separate restoration tx), or Ambiguous Timeout (`PENDING` ➔ Requery Engine).

---

## 7. Confirmed Provider Failure & Wallet Restoration

When an external provider returns an explicit, confirmed failure code (e.g. `ERR_INVALID_MSISDN`, `ERR_DISCO_DOWN`, `ERR_PRODUCT_DISABLED`):

```text
[Confirmed Provider Failure Received (Outside Firestore Transaction)]
       │
       ▼
 1. Verify Failure Code is Permanent (Not an ambiguous timeout or network drop)
       │
       ▼
 2. Execute Separate Atomic Firestore Restoration Transaction (runTransaction):
    ├── Read wallets/{userId}
    ├── new_balance = available_balance_kobo + original_customer_charged_kobo
    ├── Increment wallets/{userId}.version
    ├── Write wallets/{userId}/ledger/{newId}:
    │     entry_type: "CREDIT"
    │     category: "REFUND"
    │     amount_kobo: original_customer_charged_kobo
    │     balance_before_kobo: current_balance
    │     balance_after_kobo: new_balance
    │     parent_transaction_id: transactionId
    │     reason: "Automated refund for confirmed provider failure"
    ├── Write transactions/{transactionId}:
    │     status: "REFUNDED"
    │     settlement_economics.refund_amount_kobo = original_customer_charged_kobo
    │     settlement_economics.net_recognized_profit_kobo = 0
    │     settlement_economics.settled_at = serverTimestamp()
    └── Write serviceOrders/{orderId} (status: "FAILED")
       │
       ▼
 3. Record Audit Event in auditLogs
```

---

## 8. Provider Timeout, Ambiguous Outcome & Requery Engine

### 8.1 Exact Locked Requery Schedule (Stage 1.2 Invariant)

When an HTTP timeout (e.g. 504 Gateway Timeout, ECONNRESET, ETIMEDOUT) occurs during provider dispatch, the transaction remains in `PENDING` and executes the exact 5-stage automated requery schedule:

```text
Time T0: Ambiguous Network Timeout Occurs (transactions.status = PENDING)
  │
  ├─► T0 + 30s:   Attempt 1 (Initial Quick Probe via Cloud Scheduler Worker)
  │     ├── Provider /requery reports SUCCESS ➔ Mark SUCCESSFUL. Stop.
  │     ├── Provider /requery reports FAILED  ➔ Execute Restoration Tx (REFUNDED). Stop.
  │     └── Ambiguous Timeout ➔ Continue to Attempt 2.
  │
  ├─► T0 + 90s:   Attempt 2 (60s after Attempt 1)
  │     └── Same evaluation logic.
  │
  ├─► T0 + 150s:  Attempt 3 (60s after Attempt 2)
  │     └── Same evaluation logic.
  │
  ├─► T0 + 210s:  Attempt 4 (60s after Attempt 3)
  │     └── Same evaluation logic.
  │
  ├─► T0 + 270s:  Attempt 5 (60s after Attempt 4)
  │     └── Same evaluation logic.
  │
  └─► T0 + 300s (5 Minutes Maximum Automated Polling Window Elapsed):
        │
        ▼
      Set transactions.status = "UNKNOWN"
      Set serviceOrders.reconciliation_status = "MANUAL_REVIEW"
      Record incident in auditLogs
      Alert Operations Team via Admin Dashboard Feed
```

### 8.2 Ambiguous Timeout Prohibitions (Anti-Corruption Invariants)
During an ambiguous timeout or while polling between T0 and T+300s, the system **MUST NOT**:
1. Automatically mark the transaction `FAILED`.
2. Automatically reroute the order to a secondary provider (prevents double-vending to the customer).
3. Automatically refund the customer's wallet (prevents free digital value delivery).
4. Assume provider failure or provider success.

---

## 9. Profit Recognition & Financial Settlement Mathematics

### 9.1 Immutability of Original Economics
When a transaction is initiated, `financial_snapshot.original_economics` is calculated and permanently frozen:
- `total_charged_kobo`: Authoritative amount debited from customer.
- `provider_cost_kobo`: Expected wholesale cost from provider.
- `markup_kobo`: Convenience fee or retail markup added.
- `discount_kobo`: Customer discount deducted.
- `expected_gross_profit_kobo`: $\text{total\_charged\_kobo} - \text{provider\_cost\_kobo}$.
- `pricing_rule_version`: Active catalog rule version.

### 9.2 Settlement Economics Interaction & Formula
Settlement adjustments are recorded exclusively in `financial_snapshot.settlement_economics`:
- `refund_amount_kobo`: Amount refunded to the customer.
- `reversal_amount_kobo`: Amount reversed by the wholesale provider.
- `net_recognized_profit_kobo`: Final settled profit.
- `settled_at`: Timestamp of final settlement.

$$\mathbf{net\_recognized\_profit\_kobo} = (\mathbf{total\_charged\_kobo} - \mathbf{refund\_amount\_kobo}) - (\mathbf{provider\_cost\_kobo} - \mathbf{reversal\_amount\_kobo})$$

### 9.3 Settlement Lifecycle Outcomes

| Operational Outcome | Customer Refund (`refund_amount_kobo`) | Provider Reversal (`reversal_amount_kobo`) | Net Recognized Profit (`net_recognized_profit_kobo`) | Settlement State |
|---|:---:|:---:|:---:|:---:|
| **Successful Full Fulfillment** | 0 | 0 | $\text{total\_charged} - \text{provider\_cost} = \mathbf{expected\_gross\_profit}$ | `SUCCESSFUL` |
| **Full Customer Refund** (Failure) | `total_charged_kobo` | 0 (or provider refund) | $(total - total) - (0 - 0) = \mathbf{0}$ | `REFUNDED` |
| **Provider Reversal Post-Success** | `total_charged_kobo` | `provider_cost_kobo` | $(total - total) - (cost - cost) = \mathbf{0}$ | `REVERSED` |

> **V1 Scope Limitation:** The Alexvya V1 digital catalog (Airtime, Data, Electricity, Cable TV) operates on a binary fulfillment model (100% vended or 0% vended). Partial product fulfillment and partial refunds are not supported in V1.

---

## 10. Comprehensive State Transition Tables

### 10.1 Universal Transaction State Transitions

| Current State | Event / Trigger | Pre-Condition | Next State | Actor / System | Financial Effect | Single-Account Journal Effect | Audit Effect |
|---|---|---|---|---|---|---|---|
| **`CREATED`** | Intake Validation Passed | Valid Zod schema & headers | **`PENDING`** | System (Server Route) | Wallet debited (VAS) / Check init (Fund) | Append `DEBIT` journal (VAS) | Request logged |
| **`PENDING`** | Provider Dispatched | HTTP sent to vendor outside Tx | **`PROCESSING`** | System (Server Route) | None (Already debited) | None | Trace logged |
| **`PROCESSING`** | Provider Success Confirmed | Vendor reports success | **`SUCCESSFUL`** | System / Requery Worker | Profit recognized in `settlement_economics` | None | Transaction settled |
| **`PROCESSING`** | Provider Failure Confirmed | Vendor reports permanent fail | **`REFUNDED`** | System (Restoration Tx) | Wallet credited (+charged amount) | Append `REFUND` journal | Restoration logged |
| **`PROCESSING`** | Polling Window Exceeded | T > 300s elapsed | **`UNKNOWN`** | System (Requery Worker) | None (Frozen in escrow) | None | Incident alerted |
| **`UNKNOWN`** | Admin Confirms Delivery | Provider portal confirms vend | **`SUCCESSFUL`** | Admin / Super Admin | Profit recognized | None | Structured audit |
| **`UNKNOWN`** | Admin Confirms Non-Delivery | Provider portal confirms fail | **`REFUNDED`** | Admin / Super Admin | Wallet credited (+charged amount) | Append `REFUND` journal | Structured audit |
| **`SUCCESSFUL`** | Provider Clawback / Reversal | Vendor reverses charge | **`REVERSED`** | Super Admin / System | Profit reversed to 0; wallet restored | Append `REFUND` journal | Reversal audit |

### 10.2 Invalid & Prohibited State Transitions
The following transitions are strictly rejected by the server runtime:
- `SUCCESSFUL ➔ PROCESSING` (Attempted re-fulfillment)
- `SUCCESSFUL ➔ PENDING` (Attempted rollback)
- `REFUNDED ➔ SUCCESSFUL` (Attempted double settlement)
- `FAILED ➔ PROCESSING` (Attempted retry of dead order)
- `UNKNOWN ➔ PENDING` (Backwards state mutation)
- Wallet balance modification without a corresponding `wallets/ledger` journal entry.

---

## 11. Financial Conservation Invariants & Concurrency Rules

### 11.1 Absolute Financial Invariants
1. **Strict Integer Kobo:** $1 \text{ NGN} = 100 \text{ kobo}$. Float values are rejected at runtime.
2. **Wallet Balance Conservation:** At all times, the available balance in `wallets/{userId}` must reconcile perfectly with the cumulative balance calculations of the immutable single-account wallet journal (`wallets/{userId}/ledger`).
3. **No Unearned Profit Recognition:** Gross profit is **never** recognized at the time of wallet debit. Profit is recognized **only** when `transactions.status` transitions to `SUCCESSFUL`.
4. **Historical Economics Immutability:** When an order is refunded or reversed, `financial_snapshot.original_economics` is **never modified**.

### 11.2 Concurrency & Race-Condition Handling
- **Simultaneous Purchases:** Firestore `runTransaction` locks the `wallets/{userId}` document; concurrent transactions serialize or abort with `INSUFFICIENT_BALANCE`.
- **Worker vs. Webhook:** Both execute inside a Firestore transaction; whichever commits first settles the transaction; subsequent calls detect the terminal state and exit safely.
- **Refund vs. Delayed Provider Response:** Permanent deduplication lock on parent transaction (`settlement_economics.refund_amount_kobo > 0`) prevents double refunding or duplicate wallet restoration.

---

## 12. Firestore Impact Audit

### 12.1 UNCHANGED Collections (17)
`users`, `wallets`, `wallets/{userId}/ledger`, `transactions`, `paymentAttempts`, `serviceOrders`, `airtimeOrders`, `dataOrders`, `billOrders`, `serviceProducts`, `providers`, `providerTransactions`, `webhookEvents`, `notifications`, `adminUsers`, `auditLogs`, `idempotencyKeys`.

### 12.2 MODIFIED Collections (0)
No schema modifications are introduced in Stage 1.5.

### 12.3 NEW Collections & Fields (0)
None.

---

## 13. Stage Consistency Audit & Final Sign-Off

- **Stage 1 (Product Blueprint):** 100% Aligned.
- **Stage 1.1 (Firestore Database):** 100% Aligned (Single-account wallet journal with running balance snapshots, multi-tier idempotency retention).
- **Stage 1.2 (Provider & Pricing):** 100% Aligned (Financial snapshots, provider router, circuit breakers, T+30s to T+300s requery schedule, UNKNOWN state).
- **Stage 1.3 (Firebase Security):** 100% Aligned (Zero-trust client, Admin SDK authorization, Two-Man Rule operational policy).
- **Stage 1.4 (API Specification):** 100% Aligned (Endpoint contracts, error codes, normalized tokens).
- **Stage 1.5 (State Machines):** 100% Aligned (Decoupled execution boundary, provider idempotency, exact settlement mathematics).

---

**STAGE 1.5 COMPLETE — SPECIFICATION LOCKED. READY FOR STAGE 2 UPON USER INSTRUCTION.**
