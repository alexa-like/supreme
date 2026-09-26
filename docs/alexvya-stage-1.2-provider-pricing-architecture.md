# Alexvya — Stage 1.2: Provider & Pricing Architecture

**Document Version:** 1.1.0 (Targeted Correction Review Applied)  
**Status:** Approved Provider & Pricing Architecture Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** Next.js / TypeScript / Firebase / Google Cloud / Cloud Firestore  
**Current Stage:** Stage 1.2 (Provider & Pricing Architecture)  
**Preceding Stages:**  
- `docs/alexvya-stage-0-project-foundation.md`  
- `docs/alexvya-stage-1-product-blueprint.md`  
- `docs/alexvya-stage-1.1-firestore-database-architecture.md`

---

## 1. Provider Architecture & Abstraction Model

Alexvya operates as an enterprise aggregation layer over downstream telecommunication and utility Value-Added Service (VAS) aggregators. To guarantee zero tight-coupling, the transaction fulfillment engine communicates strictly through a normalized provider abstraction layer.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      Alexvya Core Order Service                         │
│       (Wallet Debit ➔ Idempotency Check ➔ Normalized Order Request)     │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Normalized Order Command
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Provider Router                                │
│   - Evaluates active provider operational health & latency              │
│   - Checks Circuit Breaker states (CLOSED / OPEN / HALF_OPEN)           │
│   - Resolves active provider: Configurable Policy (Primary vs Fallback) │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Dispatches to Selected Adapter
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Normalized Provider Adapter (Interface)               │
├────────────────────────────────────┬────────────────────────────────────┤
│          VTpass Adapter            │        ClubKonnect Adapter         │
│  - Formats VTpass API JSON         │  - Formats ClubKonnect Query/JSON  │
│  - Injects server VTpass secrets   │  - Injects server ClubK secrets    │
│  - Handles VTpass error codes      │  - Handles ClubK error codes       │
│  - Requeries via VTpass endpoints  │  - Requeries via ClubK endpoints   │
└──────────────────┬─────────────────┴──────────────────┬─────────────────┘
                   │ Outbound HTTPS                     │ Outbound HTTPS
                   ▼                                    ▼
       ┌──────────────────────┐             ┌──────────────────────┐
       │     VTpass APIs      │             │   ClubKonnect APIs   │
       └──────────────────────┘             └──────────────────────┘
```

### 1.1 The Normalized Provider Adapter Interface
Every provider integration must implement the conceptual `ProviderAdapter` contract:

```typescript
export interface NormalizedValidationRequest {
  serviceCategory: 'ELECTRICITY' | 'CABLE_TV';
  providerCode: string; // e.g. "IKEDC", "DSTV"
  customerIdentifier: string; // Meter number or Smartcard IUC
  meterType?: 'PREPAID' | 'POSTPAID';
}

export interface NormalizedValidationResult {
  isValid: boolean;
  customerName: string | null;
  customerAddress?: string | null;
  currentBouquet?: string | null;
  rawResponse: Record<string, unknown>;
}

export interface NormalizedOrderRequest {
  serviceOrderId: string;
  transactionReference: string;
  serviceCategory: 'AIRTIME' | 'DATA' | 'ELECTRICITY' | 'CABLE_TV';
  providerPlanCode: string;
  recipientIdentifier: string;
  nominalAmountKobo: number;
  meterType?: 'PREPAID' | 'POSTPAID';
}

export interface NormalizedOrderResult {
  normalizedStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REJECTED';
  providerTransactionId: string | null;
  operatorReference: string | null;
  token?: string | null;
  tokenUnits?: string | null;
  actualCostKobo: number;
  rawResponseCode: string | number;
  rawResponseMessage: string;
  isRetryable: boolean;
  requiresRequery: boolean;
}

export interface ProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  
  validateCustomer(req: NormalizedValidationRequest): Promise<NormalizedValidationResult>;
  submitOrder(req: NormalizedOrderRequest): Promise<NormalizedOrderResult>;
  queryOrderStatus(providerTxId: string, orderRef: string): Promise<NormalizedOrderResult>;
  checkBalance(): Promise<number>; // Returns balance in integer kobo
  checkHealth(): Promise<{ isHealthy: boolean; latencyMs: number }>;
}
```

---

## 2. Provider Capability Matrix

Provider capabilities are structured as dynamic configuration documents stored in Firestore (`providers/{providerId}`) rather than hardcoded in application logic.

| Capability Attribute | VTpass (Default Config) | ClubKonnect (Default Config) | Future Provider Standard |
|---|:---:|:---:|:---:|
| **Airtime VTU (MTN/Airtel/Glo/9mobile)** | Supported | Supported | Required |
| **SME Mobile Data** | Supported | Supported | Supported |
| **Corporate Gifting Data** | Supported | Supported | Optional |
| **Direct Mobile Data** | Supported | Supported | Optional |
| **Pre-Payment Meter Lookup** | Supported | Supported | Required for Utility |
| **Electricity Prepaid Token Generation** | Supported | Supported | Required for Utility |
| **Postpaid Electricity Settlement** | Supported | Supported | Optional |
| **Cable TV Smartcard Verification** | Supported | Supported | Required for Cable |
| **Cable TV Bouquet Renewal** | Supported | Supported | Required for Cable |
| **Status Requery API (`/requery` or `/status`)** | Supported (`/requery`) | Supported (`/status`) | Mandatory |
| **Inbound Webhooks** | Supported | Partial | Optional (Requery primary) |
| **Synchronous Fulfillment** | Yes (< 5s) | Yes (< 6s) | Yes |

---

## 3. Provider Router & Dynamic Routing Configuration

The Provider Router dynamically selects the execution provider for each transaction based on an authoritative priority and health evaluation pipeline. **Cheapest cost is never the sole criterion.**

### 3.1 Fully Configurable Operational Routing Policy
> **Architecture Principle:** Routing assignments (e.g., VTpass for Bills, ClubKonnect for SME Data) are **initial operational defaults stored in Firestore configuration** (`serviceProducts/{productId}` and `providers/{providerId}`). They are **NEVER hardcoded into the transaction engine**. Administrators can dynamically modify primary/fallback hierarchies, enable maintenance windows, or adjust weights without code changes or redeployments.

```text
Incoming Order Request
   │
   ▼
1. Filter: Which providers support this exact product and service category?
   │
   ▼
2. Health Check: Is the provider marked ACTIVE (not MAINTENANCE or DISABLED)?
   │
   ▼
3. Circuit Breaker: Is the provider's Circuit Breaker CLOSED or HALF_OPEN?
   │
   ▼
4. Balance Check: Does provider have verified merchant balance > order cost?
   │
   ▼
5. Routing Policy Evaluation:
   ├── Check Admin Dynamic Route Configurations in serviceProducts / providers
   ├── Check Success Rate over last 15 mins (Must exceed 90%)
   └── Select highest-ranked candidate (Configured Primary ➔ Configured Fallback)
```

### 3.2 Provider Operational Statuses
- **`PRIMARY`**: Dynamically configured default routing destination for a given service category.
- **`FALLBACK`**: Standby provider invoked when Primary fails eligibility or trips circuit breaker.
- **`DEGRADED`**: Success rate between 70% and 90%; receives lower traffic share.
- **`CIRCUIT_OPEN`**: Automatically isolated due to consecutive network failures; receives zero customer traffic.
- **`MAINTENANCE`**: Manually set by administrator during upstream telco maintenance windows.
- **`DISABLED`**: Permanently disabled provider integration.

---

## 4. Failover & Anti-Duplicate Fulfillment Rules

### 4.1 The Fundamental Timeout Ambiguity Rule
> **Critical Invariant:** An HTTP network timeout, 502 Bad Gateway, 504 Gateway Timeout, or socket drop between Alexvya and a provider does NOT indicate that the order failed. The provider may have received the packet and vended the airtime/token.
> **Anti-Duplication Guard:** Under NO circumstances does an ambiguous timeout trigger immediate fallback re-routing to another provider or immediate customer wallet refund.

```text
HTTP Timeout Encountered on Outbound Provider Request
   │
   ▼
DO NOT Switch to Fallback Provider! (Risk of Double Vending)
DO NOT Refund Customer Wallet! (Risk of Free Service)
   │
   ▼
Set Service Order & Transaction Status to PENDING
   │
   ▼
Execute Unified V1 Requery Lifecycle (T+30s, then every 60s up to 5 mins)
   │
   ├──────────────────────────────┬──────────────────────────────┐
   ▼                              ▼                              ▼
Requery Returns SUCCESS        Requery Returns FAILED         Requery Unresolved at 5 min
- Mark Order SUCCESSFUL        - Mark Order FAILED            - Mark Order UNKNOWN
- Deliver Token / Receipt      - Atomic Wallet Refund         - Escalate to Manual Admin
- Recognize Gross Profit       - Set Net Profit to 0            Reconciliation Queue
```

### 4.2 Retry & Failover Classification Matrix

| Condition / Error Code | Classification | Safe to Switch to Fallback? | Action Taken |
|---|---|:---:|---|
| **Invalid Customer Phone / Meter** | `PERMANENT_REJECTION` | **NO** | Terminate order as `FAILED`, refund wallet immediately. |
| **Insufficient Provider Merchant Balance** | `PROVIDER_DEFICIT` | **YES** | Trip circuit breaker on Primary; re-route order to Fallback. |
| **Immediate Connection Refusal (TCP Drop, 0 bytes sent)** | `NETWORK_RETRYABLE` | **YES** | Safe to re-route to Fallback (request never reached provider). |
| **HTTP 504 / Gateway Timeout (>20s)** | `TIMEOUT_AMBIGUOUS` | **NO** | Set status to `PENDING`; trigger status requery polling. |
| **Provider Returns Explicit "PENDING"** | `IN_FLIGHT` | **NO** | Wait for webhook or poll status. |
| **Provider Explicit "Out of Stock"** | `PRODUCT_UNAVAILABLE` | **YES** | Attempt immediate fulfillment with Fallback. |

---

## 5. Normalized Provider Status Model

Alexvya normalizes disparate provider response codes into seven standard domain statuses:

```text
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│    ACCEPTED     │ ────➔ │   PROCESSING    │ ────➔ │     SUCCESS     │
└────────┬────────┘       └────────┬────────┘       └─────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────┐       ┌─────────────────┐
│     FAILED      │       │     UNKNOWN     │ (Requires Requery / Admin)
└─────────────────┘       └─────────────────┘
```

1. **`ACCEPTED`**: Provider acknowledged request; order placed in upstream queue.
2. **`PROCESSING`**: Telco/Disco is currently vending units.
3. **`SUCCESS`**: Service confirmed delivered; STS token or operator reference issued.
4. **`FAILED`**: Explicitly rejected by provider/telco (e.g. "Invalid Meter Number").
5. **`REVERSED`**: Provider cancelled order post-acceptance and returned wholesale funds.
6. **`REFUNDED`**: Alexvya server credited customer wallet following failure confirmation.
7. **`UNKNOWN`**: Ambiguous state requiring background polling or manual administrative reconciliation.

---

## 6. Provider Error Model & Action Matrix

```typescript
export enum NormalizedErrorCode {
  // Client/Validation Errors (Non-Retryable, Immediate Wallet Refund)
  INVALID_RECIPIENT = 'INVALID_RECIPIENT',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  PRODUCT_UNSUPPORTED = 'PRODUCT_UNSUPPORTED',
  
  // Provider Operational Deficits (Safe to Route to Fallback Provider)
  PROVIDER_INSUFFICIENT_BALANCE = 'PROVIDER_INSUFFICIENT_BALANCE',
  PROVIDER_OUTAGE = 'PROVIDER_OUTAGE',
  PROVIDER_MAINTENANCE = 'PROVIDER_MAINTENANCE',
  
  // Ambiguous Network Errors (Must Requery, NEVER Re-route to Fallback)
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',
  NETWORK_SOCKET_ERROR = 'NETWORK_SOCKET_ERROR',
  PROVIDER_UNKNOWN_STATUS = 'PROVIDER_UNKNOWN_STATUS',
  
  // System Faults
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
}
```

---

## 7. Unified V1 Requery & Polling Strategy

To resolve status ambiguity deterministically without duplicate fulfillment, Alexvya implements a single unified requery policy:

```text
Time T0: Ambiguous Network Timeout Occurs
  │
  ├─► T0 + 30s:   Initial Requery Attempt 1 (Immediate quick probe)
  ├─► T0 + 90s:   Scheduled Polling Attempt 2 (60s after Attempt 1)
  ├─► T0 + 150s:  Scheduled Polling Attempt 3 (60s after Attempt 2)
  ├─► T0 + 210s:  Scheduled Polling Attempt 4 (60s after Attempt 3)
  ├─► T0 + 270s:  Scheduled Polling Attempt 5 (Final automated poll)
  │
  └─► T0 + 300s (5 Mins): Maximum Automated Polling Window Exceeded
        │
        ▼
      Set status = "UNKNOWN", requires_manual_reconciliation = true
      Escalate to Administrative Investigation Dashboard
```

1. **Initial Requery:** Fired at **T+30s** following the timeout event.
2. **Subsequent Polling:** Executed by a scheduled background worker at **60-second intervals**.
3. **Maximum Automated Polling Period:** **300 seconds (5 minutes)** total elapsed time.
4. **Transition to Manual Reconciliation:** If the provider status remains unresolved after 5 minutes, automated polling ceases, the order is marked `status: "UNKNOWN"`, and an alert is flagged in `auditLogs` / `adminUsers` for staff verification.

---

## 8. Product Catalog Architecture

Alexvya decouples customer-facing product identities from downstream provider codes.

```text
Alexvya Internal Product
(ID: "prod_mtn_data_1gb_sme")
   │
   ├── Customer Display Name: "MTN 1GB SME (30 Days)"
   ├── Category: DATA | Network: MTN | Face Value: ₦0 | Selling Price: ₦280 (28000 kobo)
   │
   └── Provider Mappings Map:
         ├── vtpass: { plan_code: "mtn-1gb", service_id: "sme-data", base_cost_kobo: 25000 }
         └── clubkonnect: { plan_code: "1001", package: "SME", base_cost_kobo: 24500 }
```

### Catalog Schema Attributes (`serviceProducts/{productId}`):
- `id`: Internal UUID or standardized slug (`prod_airtime_mtn`, `prod_data_glo_2gb`).
- `category`: `AIRTIME`, `DATA`, `ELECTRICITY`, `CABLE_TV`.
- `sub_category`: `MTN`, `AIRTEL`, `GLO`, `9MOBILE`, `IKEDC`, `EKEDC`, `DSTV`, `GOTV`.
- `name`: Clean customer label (e.g. "Airtel 5GB Corporate Gifting").
- `face_value_kobo`: Nominal face value (or `0` for variable top-up).
- `provider_cost_kobo`: Active wholesale cost baseline.
- `selling_price_kobo`: Active retail price charged to customer.
- `discount_percentage`: Percentage discount for airtime VTU (e.g. `1.50` = 1.5%).
- `service_fee_kobo`: Fixed convenience fee in kobo.
- `is_active`: Boolean availability flag.
- `min_margin_kobo`: Minimum acceptable profit margin floor guard.
- `provider_mappings`: Map of provider-specific plan codes.

---

## 9. Server-Side Pricing Engine Specifications

### 9.1 Mathematical Formulae (Integer Kobo Arithmetic Only)

#### A. Airtime Purchase Pricing (Nominal Value with Discount)
$$\text{discount\_kobo} = \lfloor \frac{\text{face\_value\_kobo} \times \text{discount\_basis\_points}}{10000} \rfloor$$
$$\text{selling\_price\_kobo} = \text{face\_value\_kobo} - \text{discount\_kobo} + \text{service\_fee\_kobo}$$

*Example: ₦1,000 Airtime with 1.5% discount (150 basis points) and ₦0 fee:*
- $\text{face\_value\_kobo} = 100000$
- $\text{discount\_kobo} = \lfloor \frac{100000 \times 150}{10000} \rfloor = 1500 \text{ kobo (₦15.00)}$
- $\text{selling\_price\_kobo} = 100000 - 1500 + 0 = 98500 \text{ kobo (₦985.00)}$

#### B. Mobile Data Bundle Pricing (Fixed Markup)
$$\text{selling\_price\_kobo} = \text{provider\_cost\_kobo} + \text{fixed\_markup\_kobo} + \text{service\_fee\_kobo}$$

*Example: MTN 1GB Data wholesale cost ₦245 (24500 kobo), fixed markup ₦35 (3500 kobo):*
- $\text{selling\_price\_kobo} = 24500 + 3500 + 0 = 28000 \text{ kobo (₦280.00)}$.

#### C. Electricity Bill Pricing (Nominal Amount + Convenience Fee)
$$\text{selling\_price\_kobo} = \text{recharge\_amount\_kobo} + \text{convenience\_fee\_kobo}$$

*Example: ₦5,000 Electricity Token with ₦100 convenience fee:*
- $\text{recharge\_amount\_kobo} = 500000$
- $\text{convenience\_fee\_kobo} = 10000$
- $\text{selling\_price\_kobo} = 510000 \text{ kobo (₦5,100.00)}$.

---

## 10. Explicit Profit Model & Historical Economics Preservation

### 10.1 Financial Distinctions & Profit Calculations
1. **Wallet Debit vs. Revenue:** A customer wallet debit is a reduction of company stored-value liability, **NOT** instant revenue or profit.
2. **Gross Profit Calculation:** Recognized only when service delivery succeeds:
   $$\text{original\_gross\_profit\_kobo} = \text{original\_customer\_charged\_kobo} - \text{original\_provider\_cost\_kobo} - \text{payment\_gateway\_fee\_kobo}$$
3. **Post-Settlement Net Financial Impact:**
   $$\text{net\_revenue\_kobo} = \text{original\_customer\_charged\_kobo} - \text{refund\_amount\_kobo}$$
   $$\text{net\_provider\_cost\_kobo} = \text{original\_provider\_cost\_kobo} - \text{reversal\_amount\_kobo}$$
   $$\text{net\_recognized\_profit\_kobo} = \text{net\_revenue\_kobo} - \text{net\_provider\_cost\_kobo} - \text{payment\_gateway\_fee\_kobo}$$

### 10.2 Preserving Historical Economics (No Overwriting)
When a transaction fails, reverses, or is refunded, the **original financial snapshot is NEVER overwritten**. Instead, lifecycle resolution fields are recorded alongside the original baseline:

```typescript
export interface TransactionFinancialEconomics {
  // Immutable Historical Snapshot (Frozen at Transaction Initiation)
  original_economics: {
    face_value_kobo: number;
    provider_cost_kobo: number;
    markup_kobo: number;
    discount_kobo: number;
    service_fee_kobo: number;
    total_charged_kobo: number;
    expected_gross_profit_kobo: number;
    pricing_rule_version: number;
    provider_id_used: string;
  };

  // Lifecycle Settlement & Audit Adjustments (Updated on State Transitions)
  settlement_economics: {
    refund_amount_kobo: number;         // Default 0; equals total_charged_kobo if refunded
    reversal_amount_kobo: number;       // Default 0; equals provider_cost_kobo if reversed
    payment_gateway_fee_kobo: number;   // Incurred payment gateway fee (if direct card)
    net_settled_revenue_kobo: number;   // original total_charged - refund_amount
    net_settled_provider_cost_kobo: number; // original provider_cost - reversal_amount
    net_recognized_profit_kobo: number; // Final net profit (0 on full refund)
    settled_at: Timestamp | null;
  };
}
```

---

## 11. Stale Pricing & Negative-Margin Protection

1. **Pre-Execution Margin Guard:**
   Before dispatching any provider order, the Pricing Engine executes an invariant check:
   $$\text{total\_charged\_kobo} \ge \text{provider\_cost\_kobo} + \text{min\_margin\_kobo}$$
2. **Negative Margin Rejection:** If upstream provider increases cost without admin updating the catalog, such that $\text{provider\_cost\_kobo} > \text{total\_charged\_kobo}$, the server **aborts the transaction**, restores user balance, trips a warning alert to `adminUsers`, and marks the product `MAINTENANCE`.

---

## 12. Provider Health & Circuit Breaker Architecture

```text
               ┌─────────────────────────────────┐
               │         CLOSED (Normal)         │
               │   All traffic routes normally   │
               └────────────────┬────────────────┘
                                │ Failure rate > 30% OR
                                │ 3 consecutive timeouts
                                ▼
               ┌─────────────────────────────────┐
               │          OPEN (Isolated)        │
               │ Traffic shifts 100% to Fallback │
               └────────────────┬────────────────┘
                                │ Cooldown Timer (120s)
                                ▼
               ┌─────────────────────────────────┐
               │        HALF_OPEN (Testing)      │
               │ Sends 1 test probe request      │
               └───────┬─────────────────┬───────┘
                       │ Probe Succeeds  │ Probe Fails
                       ▼                 ▼
                 (Back to CLOSED)   (Back to OPEN)
```

### Circuit Breaker Parameters:
- **Failure Threshold:** 3 consecutive HTTP timeouts or 40% error rate over 60 seconds.
- **Cooldown Interval:** 120 seconds.
- **Probe Request:** Single synthetic balance/health check or queued customer transaction.
- **Manual Override:** Admins can force-reset circuit breakers via admin dashboard.

---

## 13. Multi-Way Reconciliation Engine

The system conducts continuous automated reconciliations across 4 primary ledgers:

```text
┌───────────────────────┐         ┌───────────────────────┐
│  Alexvya Transactions │ ◄─────► │  Wallet Balance Ledger │
└───────────┬───────────┘         └───────────────────────┘
            │                                 │
            ▼                                 ▼
┌───────────────────────┐         ┌───────────────────────┐
│   Paystack Gateway    │         │ Upstream VAS Providers│
│ (Deposits vs Credits) │         │  (Orders vs Debits)   │
└───────────────────────┘         └───────────────────────┘
```

1. **Internal Wallet Invariant:** Current wallet balance must exactly equal $\sum \text{Ledger Credits} - \sum \text{Ledger Debits}$.
2. **Paystack Funding Invariant:** Total successful `paymentAttempts` must equal total `WALLET_FUNDING` ledger credits.
3. **Provider Requery Invariant:** Requery worker polls pending orders to force definitive status transition before 5-minute timeout.

---

## 14. Firestore Architecture Impact Review

### 14.1 UNCHANGED Collections
- `users/{userId}`: Fully compliant with Stage 1.1.
- `wallets/{userId}`: Fully compliant with Stage 1.1.
- `wallets/{userId}/ledger/{ledgerId}`: Fully compliant with Stage 1.1.
- `paymentAttempts/{paymentAttemptId}`: Fully compliant with Stage 1.1.
- `airtimeOrders/{orderId}`: Fully compliant with Stage 1.1.
- `dataOrders/{orderId}`: Fully compliant with Stage 1.1.
- `billOrders/{orderId}`: Fully compliant with Stage 1.1.
- `notifications/{notificationId}`: Fully compliant with Stage 1.1.
- `adminUsers/{userId}`: Fully compliant with Stage 1.1.
- `auditLogs/{auditLogId}`: Fully compliant with Stage 1.1.
- `idempotencyKeys/{idempotencyKey}`: Fully compliant with Stage 1.1.

### 14.2 MODIFIED Collections (Field Refinements)
- **`transactions/{transactionId}`**:
  - *Refined:* `financial_snapshot` structured into `original_economics` (immutable) and `settlement_economics` (lifecycle adjustments).
- **`serviceProducts/{productId}`**:
  - *Added:* `min_margin_kobo` (integer kobo margin floor guard).
- **`providers/{providerId}`**:
  - *Added:* `circuit_breaker_state` enum (`CLOSED`, `OPEN`, `HALF_OPEN`), `circuit_breaker_opened_at` (timestamp).

### 14.3 NEW Collections
- **None.** The Stage 1.1 schema successfully accommodates all required provider and pricing models.

---

## 15. Admin Governance & Control Model

Administrative staff (`ADMIN` and `SUPER_ADMIN`) possess specific capabilities:
1. **Catalog Management:** Create/edit products, adjust discounts/fees, toggle availability.
2. **Dynamic Provider Routing:** Switch active provider routing priorities, toggle maintenance modes, force circuit breaker resets without code deploys.
3. **Reconciliation Interventions:** Review stuck `UNKNOWN` transactions, trigger manual status requeries, or execute single-click authorized customer refunds.
4. **Audit Enforcement:** Every administrative pricing modification or routing change requires mandatory justification text and produces an immutable entry in `auditLogs`.

---

## 16. Security Boundaries & Secret Management

- **Zero Secret Exposure:** Downstream credentials (`VTPASS_API_KEY`, `VTPASS_SECRET_KEY`, `CLUBKONNECT_USER_ID`, `CLUBKONNECT_API_KEY`, `PAYSTACK_SECRET_KEY`) exist exclusively in server-side environment variables and are never stored in Firestore documents.
- **Untrusted Provider Inputs:** Upstream HTTP responses and webhook payloads are treated as untrusted external input and must be validated and sanitized before persistence.

---

**STAGE 1.2 COMPLETE — PROCEED ONLY TO STAGE 1.3 UPON EXPLICIT USER INSTRUCTION.**
