# Alexvya Platform — Stage 2.5.5: Financial Validation & Invariant Enforcement Specification

## 1. Architectural Overview & Financial Guarantees

The Alexvya Financial Core is architected around deterministic integer-only arithmetic, immutable running balance snapshots, and strict invariant enforcement. Every financial mutation operates under a zero-trust model where client payloads, mathematical calculations, and state transitions are validated server-side.

### Core Guarantees:
1. **Zero Floating-Point Money Arithmetic:** All monetary quantities are represented strictly as non-negative integer Kobo (`100 Kobo = ₦1.00`). Floating-point types (`0.1`, `0.2`) and naive parseFloat conversions are strictly forbidden across storage, calculation, and ledger journals.
2. **Deterministic String Decimal Parsing:** User inputs and human-readable Naira amounts (e.g. `"100.50"`) are parsed via deterministic character/digit decomposition. Inputs with more than two decimal places or negative signs are immediately rejected.
3. **Single-Account Running Balance Journal Identity:** Every customer wallet enforces the fundamental accounting identity:
   $$\text{ledger\_balance\_kobo} \equiv \text{available\_balance\_kobo} + \text{locked\_balance\_kobo}$$
4. **Immutable Directional Ledger Entries:**
   - **CREDIT (INFLOW):** $\text{balance\_after\_kobo} \equiv \text{balance\_before\_kobo} + \text{amount\_kobo}$
   - **DEBIT (OUTFLOW):** $\text{balance\_after\_kobo} \equiv \text{balance\_before\_kobo} - \text{amount\_kobo}$ with precondition $\text{balance\_before\_kobo} \ge \text{amount\_kobo}$
5. **Strict Monotonic Versioning:** Every successful wallet balance mutation increments the wallet version by exactly $+1$. Unchanged or rejected operations preserve the version counter.
6. **Server-Authoritative Economics & Margin Protection:** Pricing, discounts, markups, and profit margins are computed exclusively on the backend using integer basis points (`10000 bps = 100%`) with floor-rounding for discounts and ceil-rounding for platform fees.

---

## 2. Canonical Money Representation & Safe Integer Bounds

All monetary values are typed as `IntegerKobo` and constrained to safe integer ranges:

```typescript
export type IntegerKobo = number; // Integer in [0, Number.MAX_SAFE_INTEGER]
export type IntegerBps = number;  // Integer in [0, 10000]

export const MONEY_CONSTANTS = {
  KOBO_PER_NAIRA: 100,
  BPS_FULL_PERCENT: 10000,
  MIN_TRANSACTION_KOBO: 5000,           // ₦50.00
  MIN_VAS_PURCHASE_KOBO: 5000,          // ₦50.00
  MAX_SINGLE_VAS_KOBO: 10000000,        // ₦100,000.00
  MAX_VAS_PURCHASE_KOBO: 10000000,      // ₦100,000.00
  MAX_DAILY_FUNDING_TIER_1_KOBO: 5000000,   // ₦50,000.00
  MAX_DAILY_FUNDING_TIER_2_KOBO: 20000000,  // ₦200,000.00
  MAX_ACCOUNT_BALANCE_KOBO: 1000000000, // ₦10,000,000.00
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
} as const;
```

### Deterministic Decimal String Parsing Rules
Human-readable Naira values (e.g. from input fields) must be converted using `parseNgnToKobo`:
- Must match regular expression `/^\d+(\.\d{1,2})?$/`.
- Splits into `wholePart` and `fracPart` (padded to 2 digits).
- Total Kobo calculated as `wholePart * 100 + fracPart`.
- Rejects:
  - Negative numbers (`"-50.00"`).
  - Sub-kobo fractions (`"100.555"`).
  - Exponential notation (`"1e5"`).
  - Whitespace-only or malformed strings (`"abc"`, `""`).
  - Values exceeding `MAX_SAFE_INTEGER`.

---

## 3. Transaction Limits vs Account Balance Limits

The system enforces clear domain boundaries between individual purchase amounts and maximum wallet capacity:

| Boundary | Amount (Kobo) | Amount (NGN) | Enforcement Scope | Error Code |
| :--- | :--- | :--- | :--- | :--- |
| **Minimum VAS Purchase** | `5,000` | ₦50.00 | Airtime, Data, Bills | `INVALID_AMOUNT` |
| **Maximum Single VAS Purchase** | `10,000,000` | ₦100,000.00 | Single VAS Order | `INVALID_AMOUNT` |
| **Zero Amount Mutation** | `0` | ₦0.00 | Debits, Credits, Refunds | `ZERO_AMOUNT_NOT_ALLOWED` |
| **Maximum Wallet Balance** | `1,000,000,000` | ₦10,000,000.00 | Wallet Balance Cap | `MAX_BALANCE_EXCEEDED` |
| **Tier 1 Daily Funding Cap** | `5,000,000` | ₦50,000.00 | Daily Inflows | `DAILY_LIMIT_EXCEEDED` |
| **Tier 2 Daily Funding Cap** | `20,000,000` | ₦200,000.00 | Daily Inflows | `DAILY_LIMIT_EXCEEDED` |

---

## 4. Single-Account Balance Journal & Wallet Invariants

The `wallets/{userId}` document maintains a running summary of financial state:

```typescript
export interface WalletDocument {
  id: string;                      // Authenticated Firebase UID
  user_id: string;
  currency: 'NGN';
  available_balance_kobo: IntegerKobo;
  ledger_balance_kobo: IntegerKobo;
  locked_balance_kobo: IntegerKobo;
  status: WalletStatus;            // ACTIVE, LOCKED, FROZEN, SUSPENDED, CLOSED
  daily_spent_kobo: IntegerKobo;
  last_ledger_entry_id: string | null;
  version: number;                 // Strictly monotonic integer >= 1
  created_at: string;              // ISO8601
  updated_at: string;              // ISO8601
}
```

### Invariant Rules:
1. `available_balance_kobo >= 0`, `ledger_balance_kobo >= 0`, `locked_balance_kobo >= 0`.
2. `ledger_balance_kobo === available_balance_kobo + locked_balance_kobo`.
3. `daily_spent_kobo >= 0`.
4. `version >= 1` and increments by exactly $+1$ per transaction commit.
5. If any balance becomes negative or the identity check fails, the transaction is rejected and the wallet state marked corrupted.

---

## 5. Immutable Ledger Invariants & Running Balance Snapshots

Every mutation appends an immutable document to `wallets/{userId}/ledger/{ledgerId}`:

```typescript
export interface LedgerDocument {
  id: string;
  wallet_id: string;
  user_id: string;
  transaction_id: string;
  transaction_reference: string;
  entry_type: LedgerEntryType;     // CREDIT, DEBIT
  direction: LedgerDirection;       // INFLOW, OUTFLOW
  amount_kobo: IntegerKobo;         // Strictly > 0
  balance_before_kobo: IntegerKobo;
  balance_after_kobo: IntegerKobo;  // Snapshot of available balance
  category: LedgerCategory;
  description: string;
  actor: WalletMutationActor;
  created_at: string;
}
```

### Directional Pairing & Balance Snapshots:
- `CREDIT` entries MUST have direction `INFLOW`. Pairing `CREDIT` with `OUTFLOW` throws `INVALID_LEDGER_DIRECTION`.
  $$\text{balance\_after\_kobo} = \text{balance\_before\_kobo} + \text{amount\_kobo}$$
- `DEBIT` entries MUST have direction `OUTFLOW`. Pairing `DEBIT` with `INFLOW` throws `INVALID_LEDGER_DIRECTION`.
  $$\text{balance\_after\_kobo} = \text{balance\_before\_kobo} - \text{amount\_kobo}$$
- Historical ledger entries cannot be edited or deleted (`IMMUTABLE_RECORD_MODIFICATION`).

---

## 6. Percentage Math & Margin Calculation

1. **Basis Points (bps):** 1 bps = 0.01%, 10,000 bps = 100.00%.
2. **Discounts:** Floor-rounded to prevent undercharging the platform:
   $$\text{discount\_kobo} = \left\lfloor \frac{\text{face\_value\_kobo} \times \text{discount\_bps}}{10000} \right\rfloor$$
3. **Fees:** Ceil-rounded to protect processing cost coverage:
   $$\text{fee\_kobo} = \left\lceil \frac{\text{amount\_kobo} \times \text{fee\_bps}}{10000} \right\rceil$$
4. **Economics Snapshot Validation:**
   $$\text{expected\_gross\_profit\_kobo} = \text{total\_charged\_kobo} - \text{provider\_cost\_kobo}$$
   Profit is recognized upon verified fulfillment; wallet debits record expected margin.

---

## 7. Compensating Refunds & Permanent Deduplication

1. Refunds are executed as `CREDIT` + `INFLOW` ledger entries under category `REFUND`.
2. The original debit ledger entry remains unmodified.
3. Every refund requires:
   - `originalTransactionId` and `originalTransactionReference`.
   - `requestedRefundKobo > 0`.
   - $\text{alreadyRefundedKobo} + \text{requestedRefundKobo} \le \text{originalDebitKobo}$.
4. Permanent deduplication records (`ref_dedup_{originalTransactionId}`) prevent double-crediting on network retries or concurrent requests.

---

## 8. Deterministic Financial Error Taxonomy

| Error Code | HTTP Status | Description |
| :--- | :--- | :--- |
| `INVALID_MONEY_AMOUNT` | 400 | Naira string/number format invalid or >2 decimal places |
| `INVALID_KOBO_AMOUNT` | 400 | Amount is not a safe non-negative integer |
| `ZERO_AMOUNT_NOT_ALLOWED` | 400 | Mutation amount is zero |
| `MONEY_OVERFLOW` | 400 | Amount exceeds safe integer bounds |
| `INSUFFICIENT_BALANCE` | 402 | Available balance is less than required debit amount |
| `NEGATIVE_BALANCE_FORBIDDEN` | 500 | Wallet balance state would become negative |
| `MAX_BALANCE_EXCEEDED` | 400 | Credit would breach ₦10,000,000.00 account limit |
| `BALANCE_INVARIANT_VIOLATION` | 400 / 500 | Balance arithmetic mismatch or ledger identity corrupted |
| `WALLET_INVARIANT_VIOLATION` | 500 | Wallet internal schema or mathematical invariant violation |
| `WALLET_VERSION_INVALID` | 500 | Wallet version counter corrupted or non-monotonic |
| `INVALID_LEDGER_DIRECTION` | 400 | Credit paired with Outflow or Debit paired with Inflow |
| `INVALID_LEDGER_ENTRY` | 400 | Ledger schema or balance snapshot invalid |
| `INVALID_FINANCIAL_SNAPSHOT` | 400 | Financial economics calculation schema mismatch |
| `INVALID_PROFIT_CALCULATION` | 400 | Expected gross profit does not match charged minus cost |
| `REFUND_AMOUNT_INVALID` | 400 | Refund amount is zero, negative, or unsafe |
| `REFUND_AMOUNT_EXCEEDED` | 400 | Requested refund exceeds original transaction debit |
| `DUPLICATE_REFUND` | 409 | Transaction has already been permanently refunded |
