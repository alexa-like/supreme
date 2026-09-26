# Alexvya — Stage 1.1: Exact Firestore Database Architecture

**Document Version:** 1.1.0 (Targeted Correction Review Applied)  
**Status:** Approved Firestore Database Architecture Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Database:** Google Cloud Firestore (Native Mode)  
**Security & Auth Foundation:** Firebase Authentication / Firebase Admin SDK  
**Current Stage:** Stage 1.1 (Exact Firestore Database Architecture)  
**Preceding Stages:** `docs/alexvya-stage-0-project-foundation.md` & `docs/alexvya-stage-1-product-blueprint.md`

---

## 1. Firestore Architecture Overview

Alexvya utilizes **Google Cloud Firestore in Native Mode** as its single authoritative datastore for user profiles, financial balances, immutable wallet journals, service fulfillment orders, product catalogs, provider routing configurations, webhook ingestion logs, and administrative audit trails.

Unlike relational databases that rely on tabular normalization and pessimistic row-level locking (`SELECT ... FOR UPDATE`), Firestore is a globally distributed, document-oriented NoSQL database. Alexvya’s database architecture is designed specifically around:
1. **Document-Level Granularity:** Scoped documents with atomic snapshot isolations.
2. **Subcollection Encapsulation:** High-volume user ledger feeds and notification queues partitioned by parent entity paths (`wallets/{userId}/ledger/{ledgerId}`).
3. **Optimistic Concurrency via Firestore Transactions (`runTransaction`):** Guarantees serializable read-modify-write atomicity on wallet balance mutations.
4. **Server-Authoritative Gateways:** Direct client write access is restricted by Firebase Security Rules; all financial mutations, payment verifications, and provider orders execute exclusively via the trusted Firebase Admin SDK on the Next.js server.
5. **Zero Floating-Point Financial Representation:** All monetary fields are stored and computed strictly as **non-negative integer kobo** bounded by JavaScript safe-integer limits (`100 kobo = ₦1.00`).

---

## 2. Core Firestore Design Principles

- **Single Source of Identity:** Firebase Authentication manages credentials, password hashing, and session tokens. `users/{userId}` documents are keyed directly by the Firebase Auth `uid`.
- **Immutable Financial Journal:** Wallet documents hold current aggregated balances, but every state change MUST append an immutable document to the subcollection `wallets/{userId}/ledger/{ledgerId}`.
- **Historical Financial Snapshots:** When an order is placed, full pricing metadata (`provider_cost_kobo`, `selling_price_kobo`, `fee_kobo`, `discount_kobo`, `gross_profit_kobo`) is frozen into the order document. Subsequent changes to product catalog prices do not alter historical records.
- **Anti-Denial-of-Wallet Protection:** Arrays are strictly bounded or replaced with subcollections to prevent 1MB document size limit exhaustion and unbounded read cost explosions.
- **Denormalization for Fast Queries:** Frequently accessed display fields (e.g., recipient phone, plan names, Disco names) are denormalized into transaction summary documents to eliminate N+1 lookup latency.
- **Strict Server Timestamps:** All timestamp fields are populated using Firestore Server Timestamps (`FieldValue.serverTimestamp()`), never client clock timestamps.

---

## 3. Money Model: Integer Kobo & Safe Integer Standard

### 3.1 Technical Representation & Safe Arithmetic Boundaries
In the V8/Node.js JavaScript runtime environment powering Next.js Edge/Server Route Handlers, all standard `number` primitives conform to IEEE-754 double-precision floating-point format. To prevent precision loss and rounding errors, Alexvya establishes the following rigid standards:

1. **Storage Representation:** Firestore `number` integer.
2. **TypeScript Representation:** `number` with strict runtime validation (`Number.isSafeInteger(n) && n >= 0`).
3. **Safe Mathematical Boundary:** Standard JavaScript guarantees exact integer arithmetic without precision loss between $0$ and `Number.MAX_SAFE_INTEGER` ($2^{53} - 1 = 9,007,199,254,740,991$ kobo $\approx \text{₦}90,071,992,547,409.91$). This safe range exceeds Alexvya's realistic operational volume by several orders of magnitude.
4. **Platform Runtime Constraints:**
   - Minimum Transaction Value: `5000` kobo (₦50.00).
   - Maximum Single VAS Purchase: `10000000` kobo (₦100,000.00).
   - Maximum Single Wallet Funding: `5000000` kobo (₦50,000.00) for Tier 1; `20000000` kobo (₦200,000.00) for Tier 2.
   - Maximum Allowable Account Balance: `1000000000` kobo (₦10,000,000.00).
5. **Arithmetic & Rounding Rules:**
   - Direct addition and subtraction are performed exclusively on integer kobo.
   - Any percentage markup, fee, or discount calculation must use explicit basis-point integer math with explicit rounding:
     $$\text{discount\_kobo} = \lfloor \frac{\text{face\_value\_kobo} \times \text{discount\_basis\_points}}{10000} \rfloor$$
   - Fractional kobo are strictly disallowed; any remainder is truncated or rounded to the nearest integer kobo prior to storage.
6. **Prohibited Representations:**
   - Floating-point currency numbers (e.g., `1000.50`) are forbidden.
   - Decimal string formats (e.g., `"1000.50"`) as mathematical values are forbidden.
   - Client-calculated totals submitted in API request bodies are discarded.

| Nominal Amount (NGN) | Firestore Stored Integer (Kobo) | Data Type | Validation Invariant |
|---|---|---|---|
| ₦1.00 | `100` | `number` (Integer) | `Number.isSafeInteger(100)` |
| ₦50.00 | `5000` | `number` (Integer) | `Number.isSafeInteger(5000)` |
| ₦1,000.00 | `100000` | `number` (Integer) | `Number.isSafeInteger(100000)` |
| ₦50,000.00 | `5000000` | `number` (Integer) | `Number.isSafeInteger(5000000)` |
| ₦500,000.00 | `50000000` | `number` (Integer) | `Number.isSafeInteger(50000000)` |

---

## 4. Top-Level Collection Hierarchy & Paths

```text
/databases/(default)/documents
│
├── users/{userId}                                (Customer Profile & Identity Metadata)
│
├── wallets/{userId}                              (Authoritative Customer Wallet Balance)
│   └── ledger/{ledgerId}                         (Immutable Single-Account Balance Journal Subcollection)
│
├── transactions/{transactionId}                  (Universal Financial & VAS Transaction Summary)
│
├── paymentAttempts/{paymentAttemptId}            (Paystack Funding & Verification Lifecycle)
│
├── serviceOrders/{orderId}                       (Abstract Base Order Document)
│
├── airtimeOrders/{orderId}                       (Airtime VTU Specific Fulfillment Details)
│
├── dataOrders/{orderId}                          (Mobile Data Bundle Specific Fulfillment Details)
│
├── billOrders/{orderId}                          (Electricity STS Tokens & Cable TV Bouquets)
│
├── serviceProducts/{productId}                   (Internal Service Catalog & Pricing Rules)
│
├── providers/{providerId}                        (Provider Operational Status & Metadata)
│
├── providerTransactions/{providerTransactionId}  (Outbound Provider Dispatch & Raw Traceability)
│
├── webhookEvents/{webhookEventId}                (Ingested Webhook Payloads & Deduplication)
│
├── notifications/{notificationId}                (Customer Notification Messages)
│
├── adminUsers/{userId}                           (Administrative Role Assignments & Access Tiers)
│
├── auditLogs/{auditLogId}                        (Immutable Administrative Event Audit Trail)
│
└── idempotencyKeys/{idempotencyKey}              (Mutation Deduplication & Replay Guard)
```

---

## 5. Detailed Schema Specifications

### 5.1 Collection: `users`
- **Document Path:** `users/{userId}` (`userId` matches Firebase Auth `uid`)
- **Description:** Holds user account information, profile details, and account status.
- **Ownership:** Belongs to the authenticated user.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (Auth UID) | Immutable | Public Read (Self/Admin) | Firebase Auth UID. |
| `email` | `string` | Yes | - | Immutable* | Customer Read / Server Only | Primary login email address. |
| `email_verified` | `boolean` | Yes | `false` | Server-Mutable | Customer Read / Server Only | Synced with Firebase Auth verification state. |
| `phone_number` | `string` | No | `null` | Customer-Mutable | Customer Read/Write (Self) | Customer mobile number in E.164 format (`+234...`). |
| `first_name` | `string` | No | `null` | Customer-Mutable | Customer Read/Write (Self) | Customer legal first name. |
| `last_name` | `string` | No | `null` | Customer-Mutable | Customer Read/Write (Self) | Customer legal last name. |
| `display_name` | `string` | No | `null` | Customer-Mutable | Customer Read/Write (Self) | Display handle or combined full name. |
| `account_status` | `string` | Yes | `"ACTIVE"` | Admin-Mutable | Customer Read / Admin Write | Enum: `ACTIVE`, `SUSPENDED`, `FROZEN`, `CLOSED`. |
| `kyc_tier` | `number` | Yes | `1` | Server-Mutable | Customer Read / Server Write | Tier level (`1` = Basic, `2` = Verified, `3` = Tiered). |
| `daily_funding_limit_kobo` | `number` | Yes | `5000000` | Server-Mutable | Customer Read / Server Write | Daily maximum deposit limit in kobo (₦50,000). |
| `notification_preferences` | `map` | Yes | (See below) | Customer-Mutable | Customer Read/Write (Self) | Preferences map for email and in-app alerts. |
| `notification_preferences.email_on_wallet_credit` | `boolean` | Yes | `true` | Customer-Mutable | Customer Read/Write | Send email on deposit. |
| `notification_preferences.email_on_purchase` | `boolean` | Yes | `true` | Customer-Mutable | Customer Read/Write | Send email on service purchase. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Document creation server timestamp. |
| `updated_at` | `timestamp` | Yes | `serverTimestamp()` | Server-Mutable | Customer Read / Server Write | Last document update server timestamp. |

---

### 5.2 Collection: `wallets`
- **Document Path:** `wallets/{userId}` (`userId` matches Firebase Auth `uid`)
- **Description:** Authoritative stored-value wallet balance for each customer.
- **Ownership:** Belongs to `userId`. Customers have **read-only** access; writes are strictly server-side.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (Auth UID) | Immutable | Customer Read / Server Write | Matches customer `userId`. |
| `user_id` | `string` | Yes | (Auth UID) | Immutable | Customer Read / Server Write | Document reference to `users/{userId}`. |
| `currency` | `string` | Yes | `"NGN"` | Immutable | Customer Read / Server Write | Fixed ISO currency code. |
| `available_balance_kobo` | `number` | Yes | `0` | Server-Mutable | Customer Read / Server Write | Current usable balance in integer kobo. |
| `ledger_balance_kobo` | `number` | Yes | `0` | Server-Mutable | Customer Read / Server Write | Total settled balance in integer kobo. |
| `locked_balance_kobo` | `number` | Yes | `0` | Server-Mutable | Customer Read / Server Write | Amount held for pending in-flight transactions. |
| `status` | `string` | Yes | `"ACTIVE"` | Admin-Mutable | Customer Read / Admin Write | Enum: `ACTIVE`, `LOCKED`, `FROZEN`. |
| `daily_spent_kobo` | `number` | Yes | `0` | Server-Mutable | Customer Read / Server Write | Cumulative debits for current rolling 24-hr window. |
| `last_ledger_entry_id` | `string` | No | `null` | Server-Mutable | Customer Read / Server Write | ID of the most recent ledger entry document. |
| `version` | `number` | Yes | `1` | Server-Mutable | Customer Read / Server Write | Monotonically increasing version counter. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Creation timestamp. |
| `updated_at` | `timestamp` | Yes | `serverTimestamp()` | Server-Mutable | Customer Read / Server Write | Timestamp of last balance mutation. |

---

### 5.3 Subcollection: `wallets/{userId}/ledger` (Immutable Wallet Balance Journal)
- **Document Path:** `wallets/{userId}/ledger/{ledgerId}` (`ledgerId` is UUIDv4 or ULID)
- **Description:** Append-only, single-account balance journal recording every balance modification with before-and-after snapshots.
- **Architectural Clarification:** This is an **Immutable Wallet Transaction Journal**, providing absolute conservation of customer funds ($\text{balance\_after} = \text{balance\_before} \pm \text{amount}$). Full general ledger multi-account double-entry (with Chart of Accounts balancing assets against company liabilities) is maintained during reconciliation stages and is not conflated with customer wallet feeds.
- **Ownership:** Scoped under parent wallet. **Read-only** for the customer; writes are strictly server-only.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Customer Read / Server Write | Unique ledger document ID. |
| `wallet_id` | `string` | Yes | (Parent UID) | Immutable | Customer Read / Server Write | Reference to parent `wallets/{userId}`. |
| `user_id` | `string` | Yes | (Parent UID) | Immutable | Customer Read / Server Write | Customer `userId`. |
| `transaction_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Reference to `transactions/{transactionId}`. |
| `transaction_reference` | `string` | Yes | - | Immutable | Customer Read / Server Write | Human-readable transaction reference (`ALX-...`). |
| `entry_type` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `CREDIT`, `DEBIT`. |
| `direction` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `INFLOW`, `OUTFLOW`. |
| `amount_kobo` | `number` | Yes | - | Immutable | Customer Read / Server Write | Absolute transaction value in kobo (always > 0). |
| `balance_before_kobo` | `number` | Yes | - | Immutable | Customer Read / Server Write | Wallet available balance immediately prior to entry. |
| `balance_after_kobo` | `number` | Yes | - | Immutable | Customer Read / Server Write | Wallet available balance immediately following entry. |
| `category` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `WALLET_FUNDING`, `AIRTIME_PURCHASE`, `DATA_PURCHASE`, `ELECTRICITY_BILL`, `CABLE_TV`, `REFUND`, `REVERSAL`, `ADMIN_CREDIT`, `ADMIN_DEBIT`. |
| `description` | `string` | Yes | - | Immutable | Customer Read / Server Write | Human-readable explanation of journal event. |
| `actor` | `map` | Yes | - | Immutable | Customer Read / Server Write | Actor initiating mutation (`{ type: "SYSTEM"|"ADMIN"|"USER", id: string }`). |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Server timestamp of entry insertion. |

---

### 5.4 Collection: `transactions`
- **Document Path:** `transactions/{transactionId}` (`transactionId` is UUIDv4)
- **Description:** Universal customer-facing transaction record aggregating payment and VAS details.
- **Ownership:** Belongs to `user_id`. Customer has **read-only** access to own transactions; writes are server-only.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Customer Read / Server Write | Primary document ID. |
| `reference` | `string` | Yes | - | Immutable | Customer Read / Server Write | Human-readable code (`ALX-FND-...`, `ALX-AIR-...`, etc.). |
| `user_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Customer UID owning this transaction. |
| `user_email_snapshot` | `string` | Yes | - | Immutable | Admin Read / Server Write | Denormalized customer email at transaction time. |
| `type` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `WALLET_FUNDING`, `AIRTIME_PURCHASE`, `DATA_PURCHASE`, `ELECTRICITY_BILL`, `CABLE_TV`, `REFUND`, `REVERSAL`. |
| `status` | `string` | Yes | `"INITIATED"` | Server-Mutable | Customer Read / Server Write | Enum: `INITIATED`, `PENDING`, `PROCESSING`, `SUCCESSFUL`, `FAILED`, `REFUNDED`, `REVERSED`. |
| `currency` | `string` | Yes | `"NGN"` | Immutable | Customer Read / Server Write | Currency ISO code. |
| `amount_kobo` | `number` | Yes | - | Immutable | Customer Read / Server Write | Face value / nominal amount in kobo. |
| `fee_kobo` | `number` | Yes | `0` | Immutable | Customer Read / Server Write | Convenience/platform fee charged to customer. |
| `discount_kobo` | `number` | Yes | `0` | Immutable | Customer Read / Server Write | Discount deducted from customer charge. |
| `total_charged_kobo` | `number` | Yes | - | Immutable | Customer Read / Server Write | Net amount charged to customer wallet / card. |
| `provider_cost_kobo` | `number` | No | `null` | Immutable | Server/Admin Only | Actual cost billed by upstream provider (Hidden from customer). |
| `gross_profit_kobo` | `number` | No | `null` | Immutable | Server/Admin Only | Net profit margin (`total_charged - provider_cost`). |
| `provider` | `string` | No | `null` | Server-Mutable | Server/Admin Only | Enum: `PAYSTACK`, `VTPASS`, `CLUBKONNECT`, `INTERNAL`. |
| `provider_reference` | `string` | No | `null` | Server-Mutable | Server/Admin Only | Upstream reference issued by provider. |
| `idempotency_key` | `string` | Yes | - | Immutable | Server/Admin Only | Client/Request idempotency UUID. |
| `service_details` | `map` | Yes | `{}` | Server-Mutable | Customer Read / Server Write | Summary map (e.g. `{ recipient: "080...", disco: "IKEDC", token: "1234-..." }`). |
| `failure_reason` | `string` | No | `null` | Server-Mutable | Customer Read / Server Write | Safe customer-facing failure message. |
| `internal_error_code` | `string` | No | `null` | Server-Mutable | Server/Admin Only | Internal error enum for operational diagnostics. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Transaction initiation timestamp. |
| `completed_at` | `timestamp` | No | `null` | Server-Mutable | Customer Read / Server Write | Transaction completion or termination timestamp. |

---

### 5.5 Collection: `paymentAttempts`
- **Document Path:** `paymentAttempts/{paymentAttemptId}` (`paymentAttemptId` is UUIDv4)
- **Description:** Tracks Paystack wallet funding lifecycle and webhook verification states.
- **Ownership:** Belongs to `user_id`. Server-only writes. Customer read access to own attempts.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Customer Read / Server Write | Document identifier. |
| `transaction_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Foreign key to `transactions/{transactionId}`. |
| `transaction_reference` | `string` | Yes | - | Immutable | Customer Read / Server Write | Corresponding `ALX-FND-...` reference. |
| `user_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Customer UID. |
| `payment_gateway` | `string` | Yes | `"PAYSTACK"` | Immutable | Customer Read / Server Write | Gateway provider. |
| `gateway_reference` | `string` | Yes | - | Immutable | Customer Read / Server Write | Paystack reference string. |
| `amount_kobo` | `number` | Yes | - | Immutable | Customer Read / Server Write | Amount to deposit in kobo. |
| `gateway_fee_kobo` | `number` | Yes | `0` | Server-Mutable | Server/Admin Only | Paystack transaction fee deducted. |
| `status` | `string` | Yes | `"PENDING"` | Server-Mutable | Customer Read / Server Write | Enum: `PENDING`, `SUCCESSFUL`, `FAILED`, `ABANDONED`. |
| `authorization_url` | `string` | No | `null` | Immutable | Customer Read / Server Write | Paystack hosted checkout link. |
| `access_code` | `string` | No | `null` | Immutable | Customer Read / Server Write | Paystack inline checkout access code. |
| `channel` | `string` | No | `null` | Server-Mutable | Customer Read / Server Write | Enum: `CARD`, `BANK_TRANSFER`, `USSD`, `QR`. |
| `ip_address` | `string` | No | `null` | Immutable | Server/Admin Only | Client IP initiating payment. |
| `verified_at` | `timestamp` | No | `null` | Server-Mutable | Customer Read / Server Write | Timestamp of independent verification. |
| `verification_source` | `string` | No | `null` | Server-Mutable | Server/Admin Only | Enum: `WEBHOOK`, `SERVER_POLL`, `CLIENT_CALLBACK_VERIFY`. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Creation timestamp. |
| `expires_at` | `timestamp` | Yes | - | Immutable | Customer Read / Server Write | Payment checkout expiration timestamp (+72 hours). |

---

### 5.6 Collection: `serviceOrders`
- **Document Path:** `serviceOrders/{orderId}` (`orderId` matches `transactionId`)
- **Description:** Abstract service fulfillment order connecting universal transactions to domain-specific order sub-documents.
- **Ownership:** Belongs to `user_id`. Customer read-only; writes are server-only.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Customer Read / Server Write | Order ID (matches `transactionId`). |
| `transaction_reference` | `string` | Yes | - | Immutable | Customer Read / Server Write | Reference code (`ALX-AIR-...`, etc.). |
| `user_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Customer UID. |
| `service_category` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `AIRTIME`, `DATA`, `ELECTRICITY`, `CABLE_TV`. |
| `status` | `string` | Yes | `"PENDING"` | Server-Mutable | Customer Read / Server Write | Enum: `PENDING`, `PROCESSING`, `SUCCESSFUL`, `FAILED`, `REFUNDED`. |
| `product_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Internal reference to `serviceProducts/{productId}`. |
| `product_name_snapshot` | `string` | Yes | - | Immutable | Customer Read / Server Write | Human-readable plan/service name. |
| `recipient_identifier` | `string` | Yes | - | Immutable | Customer Read / Server Write | Target phone number, meter number, or smartcard number. |
| `face_value_kobo` | `number` | Yes | - | Immutable | Customer Read / Server Write | Nominal value in kobo. |
| `amount_debited_kobo` | `number` | Yes | - | Immutable | Customer Read / Server Write | Actual kobo debited from wallet. |
| `active_provider` | `string` | Yes | - | Server-Mutable | Server/Admin Only | Enum: `VTPASS`, `CLUBKONNECT`. |
| `provider_transaction_id` | `string` | No | `null` | Server-Mutable | Server/Admin Only | Reference to `providerTransactions/{id}`. |
| `retry_count` | `number` | Yes | `0` | Server-Mutable | Server/Admin Only | Number of dispatch attempts. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Order creation timestamp. |
| `updated_at` | `timestamp` | Yes | `serverTimestamp()` | Server-Mutable | Customer Read / Server Write | Last order update timestamp. |

---

### 5.7 Collection: `airtimeOrders`
- **Document Path:** `airtimeOrders/{orderId}` (`orderId` matches `serviceOrders/{orderId}`)
- **Description:** Domain-specific metadata for Airtime VTU orders.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Customer Read / Server Write | Matches `orderId`. |
| `service_order_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Reference to `serviceOrders/{orderId}`. |
| `network` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `MTN`, `AIRTEL`, `GLO`, `9MOBILE`. |
| `phone_number` | `string` | Yes | - | Immutable | Customer Read / Server Write | Recipient MSISDN (`+234...` or `080...`). |
| `airtime_type` | `string` | Yes | `"VTU"` | Immutable | Customer Read / Server Write | Enum: `VTU`, `SHARE_N_SELL`. |
| `operator_reference` | `string` | No | `null` | Server-Mutable | Customer Read / Server Write | Telco-issued delivery reference code. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Creation timestamp. |

---

### 5.8 Collection: `dataOrders`
- **Document Path:** `dataOrders/{orderId}` (`orderId` matches `serviceOrders/{orderId}`)
- **Description:** Domain-specific metadata for Mobile Data bundle orders.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Customer Read / Server Write | Matches `orderId`. |
| `service_order_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Reference to `serviceOrders/{orderId}`. |
| `network` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `MTN`, `AIRTEL`, `GLO`, `9MOBILE`. |
| `phone_number` | `string` | Yes | - | Immutable | Customer Read / Server Write | Recipient MSISDN. |
| `data_plan_type` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `SME`, `CORPORATE_GIFTING`, `DIRECT`. |
| `data_volume_mb` | `number` | Yes | - | Immutable | Customer Read / Server Write | Data allowance in megabytes (e.g. `1024` for 1GB). |
| `validity_days` | `number` | Yes | - | Immutable | Customer Read / Server Write | Plan validity period in days (e.g. `30`). |
| `provider_plan_code` | `string` | Yes | - | Immutable | Server/Admin Only | External provider's plan identifier code. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Creation timestamp. |

---

### 5.9 Collection: `billOrders`
- **Document Path:** `billOrders/{orderId}` (`orderId` matches `serviceOrders/{orderId}`)
- **Description:** Domain-specific metadata for Electricity token vends and Cable TV renewals.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Customer Read / Server Write | Matches `orderId`. |
| `service_order_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Reference to `serviceOrders/{orderId}`. |
| `bill_category` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `ELECTRICITY`, `CABLE_TV`. |
| `provider_code` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `IKEDC`, `EKEDC`, `AEDC`, `DSTV`, `GOTV`, etc. |
| `customer_identifier` | `string` | Yes | - | Immutable | Customer Read / Server Write | Meter Number or Smartcard/IUC Number. |
| `customer_name` | `string` | Yes | - | Immutable | Customer Read / Server Write | Validated customer legal account name. |
| `customer_address` | `string` | No | `null` | Immutable | Customer Read / Server Write | Meter service address (Electricity). |
| `meter_type` | `string` | No | `null` | Immutable | Customer Read / Server Write | Enum: `PREPAID`, `POSTPAID` (Electricity). |
| `sts_token` | `string` | No | `null` | Server-Mutable | Customer Read / Server Write | 20-digit prepaid electricity recharge token. |
| `token_units` | `string` | No | `null` | Server-Mutable | Customer Read / Server Write | Purchased power units (e.g. `"68.4 kWh"`). |
| `cable_package_name` | `string` | No | `null` | Immutable | Customer Read / Server Write | Name of bouquet (Cable TV). |
| `receipt_number` | `string` | No | `null` | Server-Mutable | Customer Read / Server Write | Utility-issued official receipt number. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Creation timestamp. |

---

### 5.10 Collection: `serviceProducts`
- **Document Path:** `serviceProducts/{productId}` (e.g. `prod_mtn_data_1gb_sme`)
- **Description:** Master catalog of digital services, pricing configurations, and provider mappings.
- **Ownership:** Administrative catalog. Public read; admin/server write.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | - | Immutable | Public Read / Admin Write | Internal product identifier (`prod_...`). |
| `category` | `string` | Yes | - | Immutable | Public Read / Admin Write | Enum: `AIRTIME`, `DATA`, `ELECTRICITY`, `CABLE_TV`. |
| `sub_category` | `string` | Yes | - | Immutable | Public Read / Admin Write | Network code or Disco code (e.g. `MTN`, `IKEDC`). |
| `name` | `string` | Yes | - | Admin-Mutable | Public Read / Admin Write | Customer display name. |
| `description` | `string` | No | `null` | Admin-Mutable | Public Read / Admin Write | Plan or service description. |
| `face_value_kobo` | `number` | Yes | `0` | Admin-Mutable | Public Read / Admin Write | Fixed face value (0 for flexible airtime/power). |
| `provider_cost_kobo` | `number` | Yes | `0` | Admin-Mutable | Server/Admin Only | Base wholesale cost charged by provider. |
| `selling_price_kobo` | `number` | Yes | `0` | Admin-Mutable | Public Read / Admin Write | Active retail price charged to customer. |
| `discount_percentage` | `number` | Yes | `0.0` | Admin-Mutable | Public Read / Admin Write | Percentage discount applied on face value (Airtime). |
| `service_fee_kobo` | `number` | Yes | `0` | Admin-Mutable | Public Read / Admin Write | Platform surcharge in kobo (if applicable). |
| `is_active` | `boolean` | Yes | `true` | Admin-Mutable | Public Read / Admin Write | Whether product is visible and purchasable. |
| `min_amount_kobo` | `number` | Yes | `5000` | Admin-Mutable | Public Read / Admin Write | Minimum order amount (50 NGN). |
| `max_amount_kobo` | `number` | Yes | `5000000` | Admin-Mutable | Public Read / Admin Write | Maximum order amount (50,000 NGN). |
| `provider_mappings` | `map` | Yes | `{}` | Admin-Mutable | Server/Admin Only | Map of provider codes (`{ vtpass: "mtn-1gb", clubkonnect: "1001" }`). |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Server/Admin Only | Creation timestamp. |
| `updated_at` | `timestamp` | Yes | `serverTimestamp()` | Admin-Mutable | Server/Admin Only | Last modification timestamp. |

---

### 5.11 Collection: `providers`
- **Document Path:** `providers/{providerId}` (e.g. `vtpass`, `clubkonnect`, `paystack`)
- **Description:** Tracks operational health, balance quotas, and routing status of external providers.
- **Ownership:** Administrative metadata. Admin read-only; writes are server/super-admin only. (Secrets NOT stored here).

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | - | Immutable | Admin Read / Super-Admin Write | Provider ID (`vtpass`, `clubkonnect`, `paystack`). |
| `display_name` | `string` | Yes | - | Admin-Mutable | Admin Read / Admin Write | Human-readable provider brand. |
| `status` | `string` | Yes | `"ACTIVE"` | Admin-Mutable | Admin Read / Admin Write | Enum: `ACTIVE`, `DEGRADED`, `MAINTENANCE`, `DISABLED`. |
| `supported_services` | `array<string>` | Yes | `[]` | Admin-Mutable | Admin Read / Admin Write | List of supported services (`AIRTIME`, `DATA`, etc.). |
| `current_balance_kobo` | `number` | No | `null` | Server-Mutable | Admin Read / Server Write | Last queried merchant balance with provider. |
| `success_rate_24h` | `number` | Yes | `100.0` | Server-Mutable | Admin Read / Server Write | Rolling 24-hour success percentage. |
| `avg_latency_ms` | `number` | Yes | `0` | Server-Mutable | Admin Read / Server Write | Average response latency in milliseconds. |
| `circuit_breaker_open` | `boolean` | Yes | `false` | Server-Mutable | Admin Read / Server Write | Whether automated failover has tripped. |
| `consecutive_failures` | `number` | Yes | `0` | Server-Mutable | Admin Read / Server Write | Consecutive failure counter. |
| `last_health_check_at` | `timestamp` | Yes | `serverTimestamp()` | Server-Mutable | Admin Read / Server Write | Timestamp of last health ping. |
| `updated_at` | `timestamp` | Yes | `serverTimestamp()` | Server-Mutable | Admin Read / Server Write | Last document update timestamp. |

---

### 5.12 Collection: `providerTransactions`
- **Document Path:** `providerTransactions/{providerTransactionId}` (`providerTransactionId` is UUIDv4)
- **Description:** Complete outbound API dispatch ledger recording raw HTTP communications and provider references.
- **Ownership:** Server and Admin only. Strictly inaccessible to customer clients.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Server/Admin Only | Document ID. |
| `transaction_id` | `string` | Yes | - | Immutable | Server/Admin Only | Reference to `transactions/{transactionId}`. |
| `service_order_id` | `string` | Yes | - | Immutable | Server/Admin Only | Reference to `serviceOrders/{orderId}`. |
| `provider_id` | `string` | Yes | - | Immutable | Server/Admin Only | Target provider (`vtpass`, `clubkonnect`, `paystack`). |
| `provider_reference` | `string` | No | `null` | Server-Mutable | Server/Admin Only | Provider's internal transaction ID. |
| `request_endpoint` | `string` | Yes | - | Immutable | Server/Admin Only | Outbound URL path called. |
| `request_payload_safe` | `map` | Yes | - | Immutable | Server/Admin Only | Sanitized request payload (secrets redacted). |
| `response_code` | `number` | No | `null` | Server-Mutable | Server/Admin Only | Upstream HTTP status code. |
| `response_payload_safe` | `map` | No | `null` | Server-Mutable | Server/Admin Only | Sanitized response payload. |
| `normalized_status` | `string` | Yes | `"PENDING"` | Server-Mutable | Server/Admin Only | Enum: `PENDING`, `SUCCESSFUL`, `FAILED`, `TIMEOUT`. |
| `latency_ms` | `number` | No | `null` | Server-Mutable | Server/Admin Only | Round-trip request duration in ms. |
| `retry_attempt` | `number` | Yes | `1` | Immutable | Server/Admin Only | Sequential attempt number for order. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Server/Admin Only | Timestamp request was dispatched. |
| `completed_at` | `timestamp` | No | `null` | Server-Mutable | Server/Admin Only | Timestamp response was received. |

---

### 5.13 Collection: `webhookEvents`
- **Document Path:** `webhookEvents/{webhookEventId}` (`webhookEventId` is deterministic hash or UUIDv4)
- **Description:** Ingested third-party webhook events supporting idempotent processing and deduplication.
- **Ownership:** Server/Admin Only.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | - | Immutable | Server/Admin Only | Deterministic key: `hash(provider + event_id + reference)`. |
| `provider` | `string` | Yes | - | Immutable | Server/Admin Only | Enum: `PAYSTACK`, `VTPASS`, `CLUBKONNECT`. |
| `event_type` | `string` | Yes | - | Immutable | Server/Admin Only | E.g. `charge.success`, `status.update`. |
| `external_event_id` | `string` | No | `null` | Immutable | Server/Admin Only | Provider-supplied unique event ID. |
| `signature_verified` | `boolean` | Yes | `true` | Immutable | Server/Admin Only | Result of HMAC signature verification. |
| `processing_status` | `string` | Yes | `"PENDING"` | Server-Mutable | Server/Admin Only | Enum: `PENDING`, `PROCESSING`, `PROCESSED`, `IGNORED`, `FAILED`. |
| `processing_attempts` | `number` | Yes | `0` | Server-Mutable | Server/Admin Only | Number of execution retries. |
| `related_transaction_id` | `string` | No | `null` | Server-Mutable | Server/Admin Only | Matched internal `transactionId`. |
| `payload_safe` | `map` | Yes | - | Immutable | Server/Admin Only | Redacted webhook payload. |
| `error_message` | `string` | No | `null` | Server-Mutable | Server/Admin Only | Error message if processing failed. |
| `received_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Server/Admin Only | Ingestion timestamp. |
| `processed_at` | `timestamp` | No | `null` | Server-Mutable | Server/Admin Only | Final execution timestamp. |

---

### 5.14 Collection: `notifications`
- **Document Path:** `notifications/{notificationId}` (`notificationId` is UUIDv4 or ULID)
- **Description:** In-app notification messages delivered to customer accounts.
- **Ownership:** Belongs to `user_id`. Customer can read and update `is_read`.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Customer Read / Server Write | Unique notification ID. |
| `user_id` | `string` | Yes | - | Immutable | Customer Read / Server Write | Customer UID recipient. |
| `title` | `string` | Yes | - | Immutable | Customer Read / Server Write | Notification title. |
| `message` | `string` | Yes | - | Immutable | Customer Read / Server Write | Notification body text. |
| `category` | `string` | Yes | - | Immutable | Customer Read / Server Write | Enum: `FINANCIAL`, `SERVICE_DELIVERY`, `SECURITY`, `SYSTEM`. |
| `is_read` | `boolean` | Yes | `false` | Customer-Mutable | Customer Read/Write (Self) | Read status flag. |
| `related_transaction_reference` | `string` | No | `null` | Immutable | Customer Read / Server Write | Associated `ALX-...` reference for deep linking. |
| `email_sent` | `boolean` | Yes | `false` | Server-Mutable | Server/Admin Only | Whether corresponding Resend email was sent. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Customer Read / Server Write | Timestamp notification was generated. |

---

### 5.15 Collection: `adminUsers`
- **Document Path:** `adminUsers/{userId}` (`userId` matches Firebase Auth `uid`)
- **Description:** Authoritative registry of administrative staff and their operational privilege tiers.
- **Ownership:** Super-Admin & Server Only. Regular customers have zero access.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (Auth UID) | Immutable | Admin Read / Super-Admin Write | Admin's Firebase Auth UID. |
| `email` | `string` | Yes | - | Immutable | Admin Read / Super-Admin Write | Administrative staff email. |
| `role` | `string` | Yes | - | Super-Admin-Mutable | Admin Read / Super-Admin Write | Enum: `ADMIN`, `SUPER_ADMIN`, `AUDITOR`. |
| `is_active` | `boolean` | Yes | `true` | Super-Admin-Mutable | Admin Read / Super-Admin Write | Active authorization status flag. |
| `assigned_by` | `string` | Yes | - | Immutable | Admin Read / Super-Admin Write | UID of Super Admin who granted role. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Admin Read / Super-Admin Write | Role assignment timestamp. |
| `updated_at` | `timestamp` | Yes | `serverTimestamp()` | Super-Admin-Mutable | Admin Read / Super-Admin Write | Last privilege modification timestamp. |

---

### 5.16 Collection: `auditLogs`
- **Document Path:** `auditLogs/{auditLogId}` (`auditLogId` is UUIDv4 or ULID)
- **Description:** Immutable administrative event audit trail.
- **Ownership:** Append-only. Readable by `ADMIN`, `SUPER_ADMIN`, and `AUDITOR`. Zero client or normal admin mutation.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (UUIDv4) | Immutable | Auditor/Admin Read / Server Write | Document identifier. |
| `actor_id` | `string` | Yes | - | Immutable | Auditor/Admin Read / Server Write | UID of staff member or `"SYSTEM"`. |
| `actor_role` | `string` | Yes | - | Immutable | Auditor/Admin Read / Server Write | Role at execution time (`SUPER_ADMIN`, etc.). |
| `action` | `string` | Yes | - | Immutable | Auditor/Admin Read / Server Write | Enum: `ROLE_CHANGE`, `WALLET_ADJUSTMENT`, `REFUND_PROCESSED`, `PRICE_UPDATE`, `PROVIDER_STATUS_CHANGE`, `USER_SUSPENDED`, `WEBHOOK_RETRY`. |
| `target_collection` | `string` | Yes | - | Immutable | Auditor/Admin Read / Server Write | E.g. `users`, `wallets`, `serviceProducts`. |
| `target_id` | `string` | Yes | - | Immutable | Auditor/Admin Read / Server Write | Target document ID modified. |
| `before_state` | `map` | No | `null` | Immutable | Auditor/Admin Read / Server Write | Document state snapshot prior to mutation. |
| `after_state` | `map` | No | `null` | Immutable | Auditor/Admin Read / Server Write | Document state snapshot following mutation. |
| `reason` | `string` | Yes | - | Immutable | Auditor/Admin Read / Server Write | Mandatory human-entered justification text. |
| `correlation_id` | `string` | Yes | - | Immutable | Auditor/Admin Read / Server Write | Request correlation ID (`req_...`). |
| `ip_address` | `string` | No | `null` | Immutable | Auditor/Admin Read / Server Write | Client IP of actor. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Auditor/Admin Read / Server Write | Server timestamp of audit record insertion. |

---

### 5.17 Collection: `idempotencyKeys`
- **Document Path:** `idempotencyKeys/{idempotencyKey}` (e.g. UUIDv4 provided in request header)
- **Description:** Manages request deduplication, concurrent in-flight locking, and cached API responses.
- **Ownership:** Server-Only.

| Field Name | Firestore Type | Required | Default | Mutability | Access Control | Description |
|---|---|:---:|:---:|---|---|---|
| `id` | `string` | Yes | (Client UUID) | Immutable | Server Only | Unique idempotency key. |
| `user_id` | `string` | Yes | - | Immutable | Server Only | Customer UID initiating request. |
| `request_path` | `string` | Yes | - | Immutable | Server Only | API path (e.g. `/api/v1/services/airtime/purchase`). |
| `request_hash` | `string` | Yes | - | Immutable | Server Only | SHA-256 hash of normalized request body. |
| `status` | `string` | Yes | `"IN_PROGRESS"` | Server-Mutable | Server Only | Enum: `IN_PROGRESS`, `COMPLETED`, `FAILED`. |
| `response_code` | `number` | No | `null` | Server-Mutable | Server Only | Cached HTTP response status code. |
| `response_body` | `map` | No | `null` | Server-Mutable | Server Only | Cached JSON response payload. |
| `created_at` | `timestamp` | Yes | `serverTimestamp()` | Immutable | Server Only | Initial request timestamp. |
| `expires_at` | `timestamp` | Yes | - | Immutable | Server Only | Record TTL expiration timestamp. |

---

## 6. Security Access Matrix

| Collection Path | Customer (Self) | Customer (Other) | Admin | Super Admin | Auditor | Server (Admin SDK) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `users/{userId}` | Read / Partial Update | DENIED | Read / Update Status | Read / Full Update | Read Only | Full Write |
| `wallets/{userId}` | Read Only | DENIED | Read Only | Read Only | Read Only | **Full Transactional Write** |
| `wallets/{userId}/ledger/{ledgerId}` | Read Only | DENIED | Read Only | Read Only | Read Only | **Append-Only Write** |
| `transactions/{transactionId}` | Read Only | DENIED | Read Only | Read / Refund Action | Read Only | Full Write |
| `paymentAttempts/{paymentAttemptId}` | Read Only | DENIED | Read Only | Read Only | Read Only | Full Write |
| `serviceOrders/{orderId}` | Read Only | DENIED | Read Only | Read Only | Read Only | Full Write |
| `airtimeOrders/{orderId}` | Read Only | DENIED | Read Only | Read Only | Read Only | Full Write |
| `dataOrders/{orderId}` | Read Only | DENIED | Read Only | Read Only | Read Only | Full Write |
| `billOrders/{orderId}` | Read Only | DENIED | Read Only | Read Only | Read Only | Full Write |
| `serviceProducts/{productId}` | Read Only | Read Only | Read / Update | Read / Full Write | Read Only | Full Write |
| `providers/{providerId}` | DENIED | DENIED | Read / Toggle | Read / Full Write | Read Only | Full Write |
| `providerTransactions/{id}` | DENIED | DENIED | Read Only | Read Only | Read Only | **Full Write (Server Only)** |
| `webhookEvents/{id}` | DENIED | DENIED | Read Only | Read / Retry Action | Read Only | **Full Write (Server Only)** |
| `notifications/{notificationId}` | Read / Update `is_read` | DENIED | Read Only | Read Only | Read Only | Append / Update |
| `adminUsers/{userId}` | DENIED | DENIED | Read Only | Read / Write | Read Only | Full Write |
| `auditLogs/{auditLogId}` | DENIED | DENIED | Read Only | Read Only | Read Only | **Append-Only Write** |
| `idempotencyKeys/{key}` | DENIED | DENIED | DENIED | DENIED | DENIED | **Full Write (Server Only)** |

---

## 7. Firestore Security Rules Requirements (Stage 1.3 Baseline)

Stage 1.3 must generate hardened rules enforcing these strict invariants:
1. **Zero Client Balance Mutation:** Client writes to `wallets/{userId}` or `wallets/{userId}/ledger/{ledgerId}` MUST return `PERMISSION_DENIED`.
2. **Strict Identity Isolation:** For all customer collections (`users`, `transactions`, `notifications`), rule MUST check `request.auth.uid == resource.data.user_id` on reads.
3. **Role Gating via Database Lookup:** Admin operations MUST verify admin role existence via `exists(/databases/$(database)/documents/adminUsers/$(request.auth.uid))` with `is_active == true`. Client-provided JWT claims alone must never grant administrative writes.
4. **Field Immutability Checks:** On user profile updates, `incoming().diff(existing()).affectedKeys().hasOnly(['first_name', 'last_name', 'phone_number', 'display_name', 'notification_preferences'])`.
5. **Catch-All Default Deny:** Root rule MUST default-deny all unspecified paths: `match /{document=**} { allow read, write: if false; }`.

---

## 8. Indexing Strategy

### 8.1 Single-Field Index Exemptions
To optimize storage and write performance, large text and complex map fields are excluded from single-field automatic indexing:
- `serviceProducts.provider_mappings`
- `providerTransactions.request_payload_safe`
- `providerTransactions.response_payload_safe`
- `webhookEvents.payload_safe`
- `auditLogs.before_state`
- `auditLogs.after_state`

### 8.2 Required Composite Indexes

| Collection ID | Fields Indexed | Query Purpose |
|---|---|---|
| `transactions` | `user_id` ASC, `created_at` DESC | Customer paginated transaction history feed. |
| `transactions` | `user_id` ASC, `status` ASC, `created_at` DESC | Customer filtering transactions by status (`SUCCESSFUL`, `PENDING`). |
| `transactions` | `user_id` ASC, `type` ASC, `created_at` DESC | Customer filtering transactions by service type. |
| `transactions` | `status` ASC, `created_at` DESC | Admin dashboard real-time transaction monitoring. |
| `transactions` | `type` ASC, `status` ASC, `created_at` DESC | Admin filtering transactions by service & failure status. |
| `wallets/{userId}/ledger` | `user_id` ASC, `created_at` DESC | Customer chronological wallet statement query. |
| `wallets/{userId}/ledger` | `user_id` ASC, `entry_type` ASC, `created_at` DESC | Customer filtering ledger by `CREDIT` vs `DEBIT`. |
| `serviceOrders` | `status` ASC, `created_at` ASC | Background reconciler polling stuck/in-flight `PENDING` orders. |
| `serviceProducts` | `category` ASC, `is_active` ASC, `selling_price_kobo` ASC | Customer browsing active service catalog sorted by price. |
| `notifications` | `user_id` ASC, `is_read` ASC, `created_at` DESC | Customer unread notifications counter and inbox query. |
| `webhookEvents` | `provider` ASC, `processing_status` ASC, `received_at` ASC | Asynchronous webhook processing queue query. |
| `auditLogs` | `actor_id` ASC, `created_at` DESC | Administrative compliance inspection of specific staff actions. |
| `auditLogs` | `action` ASC, `created_at` DESC | Auditing specific events (e.g. all `WALLET_ADJUSTMENT` logs). |

---

## 9. Denormalization & Snapshot Strategy

Firestore requires deliberate denormalization to maintain blazing-fast read performance and protect historical record economics.

```text
┌────────────────────────────────────────────────────────────┐
│              serviceProducts (Catalog Document)            │
│  - id: "prod_mtn_data_1gb_sme"                             │
│  - selling_price_kobo: 28000 (₦280)                        │
│  - provider_cost_kobo: 25000 (₦250)                        │
└─────────────────────────────┬──────────────────────────────┘
                              │
               User Purchases at Time T0
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│               transactions & dataOrders Snapshot           │
│  - amount_kobo: 28000                                      │
│  - provider_cost_kobo: 25000                               │
│  - plan_name_snapshot: "MTN 1GB SME (30 Days)"             │
│  - gross_profit_kobo: 3000                                 │
└────────────────────────────────────────────────────────────┘
                              │
               Catalog Price Changes at Time T1
               (selling_price_kobo updated to ₦300)
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│      Historical Transaction Remains Completely Unchanged   │
│           (Historical accounting ledger is immutable)      │
└────────────────────────────────────────────────────────────┘
```

### Denormalized Fields Matrix:
1. **`user_email_snapshot` on `transactions`:** Allows administrative search by email without performing expensive joins against the `users` collection.
2. **`product_name_snapshot` on `serviceOrders`:** Preserves exact plan or bouquet title as shown to customer at purchase time.
3. **`pricing snapshots` on `transactions`:** Freezes `amount_kobo`, `fee_kobo`, `discount_kobo`, `provider_cost_kobo`, and `gross_profit_kobo` to prevent ledger distortion upon catalog price updates.
4. **`customer_name` on `billOrders`:** Stores validated meter/smartcard account holder name returned during pre-payment validation.

---

## 10. Firestore Transaction & Concurrency Strategy

All financial mutations are executed inside server-side Firestore Transactions (`db.runTransaction()`).

### 10.1 Atomic Service Purchase & Wallet Debit Flow
```text
Inside db.runTransaction(async (transaction) => {
  1. READ: Get wallets/{userId}
  2. READ: Get idempotencyKeys/{key} (verify status !== 'COMPLETED')
  3. VALIDATE: Ensure wallet.status === 'ACTIVE'
  4. VALIDATE: Ensure wallet.available_balance_kobo >= total_charged_kobo
  5. COMPUTE: new_available = wallet.available_balance_kobo - total_charged_kobo
  6. WRITE: Update wallets/{userId} (set available_balance_kobo = new_available, inc version)
  7. WRITE: Create wallets/{userId}/ledger/{ledgerId} (entry_type: 'DEBIT', amount: total_charged_kobo)
  8. WRITE: Create transactions/{transactionId} (status: 'PENDING')
  9. WRITE: Create serviceOrders/{orderId} (status: 'PENDING')
 10. WRITE: Set idempotencyKeys/{key} (status: 'IN_PROGRESS')
})
// 11. OUTSIDE TRANSACTION: Dispatch external API request to provider adapter (VTpass / ClubKonnect)
```

### 10.2 Atomic Payment Verification & Wallet Credit Flow
```text
Inside db.runTransaction(async (transaction) => {
  1. READ: Get paymentAttempts/{paymentAttemptId}
  2. VALIDATE: Ensure paymentAttempt.status === 'PENDING'
  3. READ: Get wallets/{userId}
  4. COMPUTE: new_available = wallet.available_balance_kobo + paymentAttempt.amount_kobo
  5. WRITE: Update wallets/{userId} (set available_balance_kobo = new_available, inc version)
  6. WRITE: Create wallets/{userId}/ledger/{ledgerId} (entry_type: 'CREDIT', amount: amount_kobo)
  7. WRITE: Update transactions/{transactionId} (status: 'SUCCESSFUL')
  8. WRITE: Update paymentAttempts/{paymentAttemptId} (status: 'SUCCESSFUL')
  9. WRITE: Create notifications/{notificationId} (title: "Wallet Funded Successfully")
})
```

---

## 11. Operation-Specific Idempotency & Deduplication Retention

Rather than applying a generic flat TTL across heterogeneous operations, Alexvya enforces domain-specific deduplication lifecycles:

| Operation Category | Storage Path / Mechanism | Retention Window (TTL) | Rationale & Protection Scope |
|---|---|:---:|---|
| **VAS Purchases** (`airtime`, `data`, `bills`) | `idempotencyKeys/{client_key}` | **24 Hours** | Prevents rapid double-clicks, mobile UI retries, or flaky client reconnections within the active purchase window. |
| **Paystack Funding Initializations** | `paymentAttempts/{id}` & `transactions/{id}` | **72 Hours** | Covers Paystack checkout window, bank transfer validation latency, and offline customer cash payment grace periods. |
| **Paystack Verification Invocations** | `paymentAttempts.gateway_reference` Unique Index | **90 Days** | Ensures that repeated client verification triggers or reconciliation sweeps cannot double-credit a single gateway charge. |
| **Third-Party Webhooks** (`Paystack`, `VTpass`, `ClubKonnect`) | `webhookEvents/{deterministic_hash}` | **30 Days** | Provider retry policies resend webhooks for hours or days during outages; 30-day retention guarantees complete immunity against late duplicate webhooks. |
| **Refunds & Admin Adjustments** | `transactions/{id}.status` & `auditLogs/{id}` | **Indefinite (Permanent)** | Refunds and balance adjustments are permanent operations tied directly to parent `transactionId`. A transaction cannot be refunded twice under any circumstance. |

---

## 12. Data Retention & Archival Strategy

| Collection | Operational Hot Retention | Cold Archival / Compliance Policy |
|---|---|---|
| `wallets` & `wallets/{userId}/ledger` | Indefinite (Permanent) | Active online querying; zero deletion permitted. |
| `transactions` | 3 Years Hot in Firestore | Exported to BigQuery / Cloud Storage for 7-year regulatory retention. |
| `serviceOrders` & Sub-orders | 1 Year Hot in Firestore | Exported to BigQuery. |
| `providerTransactions` | 90 Days in Firestore | Raw logs purged after 90 days; summary metrics retained. |
| `webhookEvents` | 30 Days in Firestore | Processed webhook payloads purged after 30 days. |
| `idempotencyKeys` | 24 Hours to 72 Hours (Per Category) | Automated TTL deletion via Cloud Functions or scheduled task. |
| `auditLogs` | 5 Years in Firestore | Permanent append-only compliance archive. |
| `notifications` | 180 Days in Firestore | Old read notifications pruned after 180 days. |

---

## 13. Firestore Limits, Cost Optimization & Anti-Denial-of-Wallet

1. **Document Size Constraint:** No document may exceed Firestore's 1MB limit. Unbounded feeds (ledger, transactions, audit logs) are structured as subcollections or independent collections rather than embedded arrays.
2. **Max Write Rate per Document:** Firestore supports ~1 write/sec per document under sustained load. Customer wallets are isolated to 1 document per user, preventing global bottlenecking.
3. **Query Read Optimization:** Collections enforce strict limit clauses (e.g. `limit(20)`) and pagination cursors (`startAfter()`) to prevent runaway read billing.
4. **Realtime Listener Discipline:** Frontend clients only attach `onSnapshot` listeners to `wallets/{userId}` and `notifications` where real-time balance and alert updates deliver immediate UX value; historical transactions use standard one-time `getDocs()` queries.

---

## 14. Backup, Export & Disaster Recovery Plan

1. **Automated Daily Exports:** Cloud Firestore Managed Export scheduled daily via Cloud Scheduler and Cloud Functions, saving complete backups to Google Cloud Storage (GCS) multi-region buckets with 30-day object lifecycle retention.
2. **Point-In-Time Recovery (PITR):** Enable Firestore PITR on production database instances, allowing 7-day granular rollback to any microsecond timestamp in disaster scenarios.
3. **Ledger Self-Reconciliation:** A background worker runs nightly cross-verifying $\sum \text{Journal Credits} - \sum \text{Journal Debits} == \text{wallets.available_balance_kobo}$. Any discrepancy triggers an immediate security alert to the Super Admin.

---

## 15. Shared TypeScript Domain Types & Enums

```typescript
// ==========================================
// CORE DOMAIN ENUMS
// ==========================================

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  FROZEN = 'FROZEN',
  CLOSED = 'CLOSED',
}

export enum AdminRole {
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  AUDITOR = 'AUDITOR',
}

export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED',
  FROZEN = 'FROZEN',
}

export enum LedgerEntryType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum LedgerCategory {
  WALLET_FUNDING = 'WALLET_FUNDING',
  AIRTIME_PURCHASE = 'AIRTIME_PURCHASE',
  DATA_PURCHASE = 'DATA_PURCHASE',
  ELECTRICITY_BILL = 'ELECTRICITY_BILL',
  CABLE_TV = 'CABLE_TV',
  REFUND = 'REFUND',
  REVERSAL = 'REVERSAL',
  ADMIN_CREDIT = 'ADMIN_CREDIT',
  ADMIN_DEBIT = 'ADMIN_DEBIT',
}

export enum TransactionType {
  WALLET_FUNDING = 'WALLET_FUNDING',
  AIRTIME_PURCHASE = 'AIRTIME_PURCHASE',
  DATA_PURCHASE = 'DATA_PURCHASE',
  ELECTRICITY_BILL = 'ELECTRICITY_BILL',
  CABLE_TV = 'CABLE_TV',
  REFUND = 'REFUND',
  REVERSAL = 'REVERSAL',
}

export enum TransactionStatus {
  INITIATED = 'INITIATED',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESSFUL = 'SUCCESSFUL',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  REVERSED = 'REVERSED',
}

export enum ServiceCategory {
  AIRTIME = 'AIRTIME',
  DATA = 'DATA',
  ELECTRICITY = 'ELECTRICITY',
  CABLE_TV = 'CABLE_TV',
}

export enum ProviderCode {
  PAYSTACK = 'PAYSTACK',
  VTPASS = 'VTPASS',
  CLUBKONNECT = 'CLUBKONNECT',
  INTERNAL = 'INTERNAL',
}

export enum MeterType {
  PREPAID = 'PREPAID',
  POSTPAID = 'POSTPAID',
}
```

---

## 16. Open Decisions & Stage 1.1 Sign-Off

### 16.1 Open Decisions
1. *Subcollection vs. Root Collection for Ledger:* Formalized decision: `wallets/{userId}/ledger/{ledgerId}` subcollection is chosen for maximum data locality, security rules isolation, and natural multi-tenant partitioning.
2. *Provider Secrets Isolation:* Confirmed rule: No provider secret keys or webhook signing secrets will exist in any Firestore document; secrets exist exclusively in server environment variables / Google Cloud Secret Manager.

---

### 16.2 Stage 1.1 Completion Checklist
- [x] Firestore Architecture Overview and NoSQL paradigm defined.
- [x] Integer Kobo monetary model and JavaScript safe integer limits specified.
- [x] Accurate Wallet Transaction Journal terminology and conservation invariants established.
- [x] Operation-specific idempotency retention lifecycles documented.
- [x] Complete collection hierarchy and document path taxonomy defined.
- [x] Detailed field-by-field schema definitions for all 17 collections/subcollections.
- [x] Field types, nullability, defaults, mutability, and access control declared.
- [x] Comprehensive Security Access Matrix established.
- [x] Firestore Security Rules requirements outlined for Stage 1.3.
- [x] Single-field and Composite Indexes specified.
- [x] Denormalization and financial historical snapshot strategy defined.
- [x] Firestore transaction boundaries (`runTransaction`) and concurrency flows documented.
- [x] Backup, export, and reconciliation disaster recovery plan established.
- [x] Shared TypeScript domain enums and types defined.
- [x] Open decisions resolved.

---

**STAGE 1.1 REVIEW COMPLETE — PROCEED ONLY TO STAGE 1.2 UPON EXPLICIT USER INSTRUCTION.**
