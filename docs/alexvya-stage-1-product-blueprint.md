# Alexvya — Stage 1: Product Blueprint & Requirements

**Document Version:** 1.0.0  
**Status:** Approved Product Blueprint & Requirements Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** Next.js / TypeScript / Firebase / Google Cloud / Firebase App Hosting  
**Current Stage:** Stage 1 (Product Blueprint & Requirements)  
**Preceding Stage:** `docs/alexvya-stage-0-project-foundation.md`

---

## 1. Product Identity

- **Brand Name:** **Alexvya**
- **Domain Focus:** Enterprise-grade Nigerian digital services, Virtual Top-Up (VTU), utility settlement, and consumer wallet infrastructure.
- **Core Value Proposition:** Fast, reliable, transparent, and secure digital utility fulfillment for Nigerian consumers and businesses, backed by server-authoritative pricing, automated multi-provider failover, and zero-loss financial reconciliation.

---

## 2. Product Vision

Alexvya is architected as an institutional-grade platform bridging Nigerian consumers to telecommunications networks and utility distribution companies. While V1 focuses on rock-solid consumer VTU, bills, and wallet management, the underlying technology foundation is engineered to support future ecosystem expansion:

- **Alexvya Wallet:** Full-scale digital wallet and personal financial management.
- **Alexvya Pay:** Merchant checkout gateway and payment acceptance infrastructure.
- **Alexvya Business:** Corporate disbursement, expense management, and bulk utility vending.
- **Alexvya API:** Developer-facing B2B digital services API.
- **Alexvya Technologies:** Parent technology ecosystem and fintech infrastructure.

*(Note: Future brand extensions are strictly out of scope for V1 implementation).*

---

## 3. V1 Product Scope

The V1 release delivers a tightly scoped, production-hardened suite of consumer and administrative capabilities.

### 3.1 Customer Scope
- **Identity & Access:**
  - Account creation via Email/Password and Google Sign-In.
  - Email verification enforcement for transactional access.
  - Secure password reset / recovery flow.
  - Session lifecycle management (login, logout, session expiration).
- **Profile & Settings:**
  - Profile overview (name, verified email, phone, account tier).
  - Customer-editable fields (first name, last name, notification preferences).
  - Server-controlled security metadata (account status, verification tier, created date).
- **Wallet & Funding:**
  - Real-time balance display in integer kobo (NGN).
  - Paystack-powered card, bank transfer, and USSD wallet funding.
  - Server-side independent payment verification.
  - Double-entry ledger audit history.
- **Value-Added Digital Services (VAS):**
  - **Airtime VTU:** Instant top-up across MTN, Airtel, Glo, and 9mobile with server-calculated discounts.
  - **Mobile Data Bundles:** SME, Corporate Gifting, and Direct Data bundles.
  - **Electricity Utility Bills:** Prepaid meter token generation and postpaid bill payment across all Nigerian Discos (IKEDC, EKEDC, AEDC, IBEDC, PHED, EEDC, KEDCO, KAEDCO, etc.).
  - **Cable TV Subscriptions:** Smartcard/IUC validation and bouquet renewal for DStv, GOtv, and StarTimes.
- **Transactions & In-App Transparency:**
  - Paginated transaction history with status filters.
  - Detailed digital receipts with fulfillment tokens and provider reference mapping.
- **Notifications:**
  - In-app notification inbox.
  - Transactional email receipts and alerts delivered via Resend.

### 3.2 Admin Scope
- **Administrative Governance & RBAC:**
  - Role-gated portal (`ADMIN`, `SUPER_ADMIN`, `AUDITOR`).
- **Dashboard & Business Metrics:**
  - Aggregated metrics: Active users, daily wallet funding, service sales volume, failure rates, provider health.
- **User Management:**
  - Search/filter users, inspect profiles, review transaction records, toggle account status (`ACTIVE`, `SUSPENDED`, `FROZEN`).
- **Wallet & Financial Supervision:**
  - View user wallet balances and immutable ledger entries.
  - Dual-authorized manual balance adjustments (`ADMIN_CREDIT`, `ADMIN_DEBIT`) with mandatory audit logging.
- **Transaction & Order Management:**
  - Real-time transaction inspection, filtering by provider, service, and status.
  - Transaction investigation dossier (raw provider payloads, response times, ledger linkage).
  - Manual refund and reversal workflows for failed provider transactions.
- **Service Catalog & Pricing Configuration:**
  - Manage internal airtime, data plans, discos, and cable bouquets.
  - Set active/inactive statuses and configure markups, discounts, and platform fees.
- **Provider & Routing Controls:**
  - Monitor VTpass and ClubKonnect balance quotas, operational status, and health.
  - Configure primary and fallback routing priorities.
- **Webhook & Audit Log Monitoring:**
  - Real-time feed of ingested webhooks, processing states, and failure retries.
  - Immutable audit trail of all staff and system mutations.

---

## 4. Future Scope (V2+ Backlog)

The following features are explicitly **excluded** from V1:
- Customer referral systems, affiliate commissions, and promo codes.
- Savings products, target lock savings, or interest accrual.
- Micro-lending, credit lines, or buy-now-pay-later (BNPL).
- Virtual/physical debit cards.
- Crypto/digital asset settlements.
- SMS or WhatsApp conversational bots / notifications.
- Native mobile applications (iOS/Android Kotlin/Swift).
- Developer public API keys and developer portals.
- Recurring automated subscriptions / auto-renewals.

---

## 5. User Types and Roles

| Actor / Role | Type | Capabilities & Authorization Scope |
|---|---|---|
| **Customer** | Human | Accesses self-service dashboard; views own profile, wallet, ledger, and transactions; funds wallet via Paystack; purchases VAS services; receives notifications. Strictly barred from admin views and other users' records. |
| **Admin** | Human | Accesses operational admin portal; inspects users, orders, and provider statuses; manages product catalogs and pricing; reviews webhook events and audit logs; processes authorized service refunds. |
| **Super Admin** | Human | Elevated privileges; modifies staff roles; executes manual wallet balance adjustments; overrides provider routing configurations; manages system parameters. |
| **Auditor** | Human | Read-only compliance access; reviews financial ledgers, reconciliation reports, audit logs, and transaction histories. Cannot perform financial mutations or configuration changes. |
| **Server / System** | Automated Worker | Trusted backend execution context (Next.js server / Firebase Admin); verifies payments; executes atomic Firestore balance mutations; dispatches provider API calls; verifies HMAC webhooks; runs reconciliation workers. |

---

## 6. End-to-End Customer Journey

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                  1. Onboarding Phase                                   │
│  User registers (Email/Pass or Google) ➔ Enters verification code ➔ Logs into App      │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              2. Wallet Funding Phase                                   │
│  Enters amount ➔ Server creates Tx & Paystack Checkout ➔ User completes card/transfer  │
│  ➔ Paystack Webhook/Verification ➔ Server atomically credits wallet & creates ledger   │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              3. Service Selection Phase                                │
│  Selects Airtime / Data / Electricity / Cable ➔ Enters recipient (Phone/Meter/IUC)     │
│  ➔ Server validates input & calculates authoritative price/discount                    │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              4. Order Execution Phase                                  │
│  User confirms ➔ Server verifies balance ➔ Atomically debits wallet (PENDING)         │
│  ➔ Server dispatches request to active provider (VTpass / ClubKonnect)                 │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
┌──────────────────────────────────────────┐  ┌──────────────────────────────────────────┐
│             Fulfillment Success          │  │           Fulfillment Failure            │
│  Provider returns success & token/receipt│  │  Provider returns rejection / failure    │
│  ➔ Order marked SUCCESSFUL               │  │  ➔ Server atomically refunds wallet      │
│  ➔ In-app + Email receipt sent           │  │  ➔ Order marked FAILED                   │
│  ➔ Real-time dashboard update            │  │  ➔ Customer notified with safe message   │
└──────────────────────────────────────────┘  └──────────────────────────────────────────┘
                                                           │
                                                           ▼ (Network Timeout / Unclear)
                                              ┌──────────────────────────────────────────┐
                                              │             Pending / In-Flight          │
                                              │  Order remains PENDING                   │
                                              │  ➔ Reconciliation worker resolves via    │
                                              │     webhook or status query              │
                                              └──────────────────────────────────────────┘
```

---

## 7. Authentication Requirements

1. **Authentication Authority:** Firebase Authentication handles identity storage, password hashing, and OAuth tokens.
2. **Supported Methods:**
   - Google Sign-In (Firebase Auth Popup).
   - Email and Password (with minimum 8 characters, complexity rules).
3. **Email Verification:** Required prior to performing wallet funding and VAS purchases.
4. **Session Security:** Short-lived Firebase ID tokens validated server-side on every API request.
5. **Field Separation:**
   - *Customer-Editable:* `first_name`, `last_name`, `phone_number`, `notification_preferences`.
   - *Server-Controlled:* `uid`, `email`, `email_verified`, `role`, `account_status`, `kyc_tier`, `created_at`, `updated_at`.
6. **Account Restriction:** Accounts flagged as `SUSPENDED` or `FROZEN` are blocked from logging in or executing wallet mutations.

---

## 8. Customer Dashboard Requirements

- **Financial Overview:** Available wallet balance displayed prominently in integer kobo converted to standard Nigerian Naira (`₦`).
- **Quick Action Grid:** Direct action buttons for:
  - Fund Wallet
  - Buy Airtime
  - Buy Data
  - Pay Electricity
  - Pay Cable TV
- **Recent Activity Feed:** Latest 5 transactions with clear status pills (`SUCCESSFUL`, `PENDING`, `FAILED`, `REFUNDED`).
- **Notification Inbox:** Unread count indicator and quick preview drawer.
- **Mobile Responsiveness:** Touch-friendly inputs optimized for low-latency operation on Nigerian mobile networks.

---

## 9. Wallet & Accounting Requirements

1. **Integer Kobo Standard:** All wallet balances and ledger mutations are maintained as positive/zero 64-bit integers representing kobo (`100 kobo = ₦1.00`).
2. **Server-Side Concurrency Safety:** Wallet mutations must execute inside atomic Firestore transactions (`runTransaction`).
3. **Double-Entry Ledger Integrity:** Every wallet debit or credit must create an immutable ledger entry recording:
   - `entry_type`: `CREDIT` or `DEBIT`
   - `amount_kobo`: Integer
   - `balance_before_kobo`: Integer
   - `balance_after_kobo`: Integer
   - `category`: `WALLET_FUNDING`, `AIRTIME_PURCHASE`, `DATA_PURCHASE`, `ELECTRICITY_BILL`, `CABLE_TV`, `REFUND`, `ADMIN_ADJUSTMENT`
   - `transaction_reference`: String
4. **Zero Client Trust:** The client application NEVER calculates, modifies, or submits wallet balances.

---

## 10. Wallet Funding Architecture

1. **Flow:**
   - Customer specifies funding amount (Min: `10000` kobo / ₦100, Max: `5000000` kobo / ₦50,000).
   - Server initializes a `PENDING` funding transaction in Firestore.
   - Server calls Paystack `/transaction/initialize` with server secret key and internal reference `ALX-FND-YYYYMMDD-XXXXXX`.
   - Customer completes payment via Paystack checkout popup/redirect.
2. **Independent Verification:**
   - Browser redirects are treated as untrusted hints.
   - Authoritative funding confirmation occurs exclusively through Paystack HMAC-SHA512 Webhooks or explicit server-to-server verification (`/transaction/verify/:reference`).
3. **Idempotency & Replay Protection:**
   - Paystack transaction IDs and internal references are indexed uniquely in Firestore to guarantee a single credit per payment.

---

## 11. Airtime Recharge Product Requirements

- **Supported Networks:** MTN, Airtel, Glo, 9mobile (configured in Firestore dynamic catalog).
- **Pricing & Discounts:** Server applies configured customer discount percentage (e.g., 1.5% off ₦1,000 airtime = ₦985 debit).
- **Validation:** Phone number MSISDN validation (`+234...` or `080...`) and network prefix compatibility check.
- **Execution:** Server debits wallet `amount_debited_kobo`, creates `PENDING` order, and dispatches to active provider adapter.

---

## 12. Mobile Data Bundles Product Requirements

- **Plan Types:** SME Data, Corporate Gifting, and Direct Data.
- **Catalog Abstraction:** Customers select an `internal_product_id` (e.g., `prod_dat_mtn_1gb_sme`). The server's `ProviderRouter` maps this to the active provider's specific plan code.
- **Fulfillment:** Instant data delivery confirmation with recipient MSISDN logging.

---

## 13. Electricity Bills Product Requirements

- **Supported Discos:** All licensed Nigerian electricity distribution companies (IKEDC, EKEDC, AEDC, IBEDC, PHED, EEDC, KEDCO, KAEDCO, JED, YEDC, BEDC).
- **Pre-Payment Meter Validation:** Server queries provider API to validate meter number, returning customer name and address for confirmation before payment.
- **Token Delivery:** For prepaid meters, the generated 20-digit standard transfer specification (STS) token, token units (kWh), and receipt number are returned and permanently stored.

---

## 14. Cable TV Subscription Product Requirements

- **Supported Providers:** DStv, GOtv, StarTimes, Showmax.
- **Pre-Payment Smartcard Validation:** Server validates Smartcard / IUC number, returning customer account name and current bouquet status.
- **Bouquet Selection:** Customers can renew current bouquet or upgrade to higher tier at server-authoritative rates.

---

## 15. Universal Transaction Model

Every financial and VAS operation creates a unified transaction record containing:
- `id`: UUIDv4 string
- `reference`: Internal human-readable reference (`ALX-AIR-...`, `ALX-DAT-...`, `ALX-PWR-...`, `ALX-CAB-...`, `ALX-FND-...`)
- `user_id`: Authenticated customer UID
- `type`: `WALLET_FUNDING`, `AIRTIME_PURCHASE`, `DATA_PURCHASE`, `ELECTRICITY_BILL`, `CABLE_TV`, `REFUND`, `REVERSAL`
- `status`: `INITIATED`, `PENDING`, `PROCESSING`, `SUCCESSFUL`, `FAILED`, `REFUNDED`, `REVERSED`
- `amount_kobo`: Nominal face value
- `fee_kobo`: Platform fee
- `discount_kobo`: Customer discount
- `net_amount_kobo`: Actual wallet debit/credit
- `provider_info`: Provider name, provider reference, latency (server-only)
- `service_payload`: Recipient, token, meter details, or plan attributes
- `created_at` & `completed_at`: ISO 8601 UTC timestamps

---

## 16. Provider Architecture & Routing

```text
┌──────────────────────────────────────────────────────────┐
│                   Domain Order Service                   │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                     Provider Router                      │
│   - Evaluates active provider operational status         │
│   - Checks balance quotas and error rate thresholds      │
│   - Selects primary (e.g., VTpass) or fallback (ClubK)   │
└────────────────────────────┬─────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│      VTpass Adapter       │ │   ClubKonnect Adapter     │
│  - Formats VTpass payload │ │ - Formats ClubK payload   │
│  - Injects VTpass secrets │ │ - Injects ClubK secrets   │
│  - Parses raw response    │ │ - Parses raw response     │
└─────────────┬─────────────┘ └─────────────┬─────────────┘
              ▼ Outbound HTTPS              ▼ Outbound HTTPS
┌───────────────────────────┐ ┌───────────────────────────┐
│     VTpass Server API     │ │  ClubKonnect Server API   │
└───────────────────────────┘ └───────────────────────────┘
```

- **Circuit Breaker:** If a provider encounters 3 consecutive network timeouts or returns system error codes, the router automatically switches subsequent traffic to the fallback provider.

---

## 17. Server-Authoritative Pricing Model

$$\text{Customer Selling Price} = \text{Provider Cost} + \text{Fixed Markup} + (\text{Provider Cost} \times \text{Percentage Markup}) + \text{Service Fee} - \text{Customer Discount}$$

- **Immutability Principle:** When an order is created, a complete financial snapshot (`provider_cost_kobo`, `selling_price_kobo`, `fee_kobo`, `discount_kobo`) is frozen on the transaction document. Future changes to platform pricing do not modify historical transaction economics.

---

## 18. Profit & Financial Visibility

For every fulfilled transaction, the system computes and isolates gross margin:
$$\text{Gross Profit (kobo)} = \text{Customer Net Paid} - \text{Provider Actual Cost} - \text{Payment Gateway Fees}$$
*(Alexvya tracks operational gross profit for administrative reporting; official taxation and corporate accounting compliance remain business-level responsibilities).*

---

## 19. Notification System

- **Channels (V1):**
  - In-App Notification Center (Real-time Firestore sync).
  - Transactional Emails (HTML templates dispatched via Resend).
- **Key Triggers:**
  - `WALLET_FUNDED`: Payment confirmed, new balance shown.
  - `ORDER_SUCCESSFUL`: Airtime/data delivered or electricity token issued.
  - `ORDER_FAILED`: Service could not be delivered, refund issued to wallet.
  - `SECURITY_ALERT`: Password changed, login from new device.

---

## 20. Digital Receipt Specifications

Every completed transaction generates an immutable receipt view displaying:
- Alexvya Official Reference (`ALX-...`)
- Transaction Date & Time (WAT / UTC)
- Service Rendered (e.g. "Ikeja Electric Prepaid Token")
- Recipient Identifier (Phone / Meter / Smartcard)
- STS Token & Units (if electricity)
- Total Charged in NGN
- Payment Method ("Alexvya Wallet")
- Transaction Status Badge ("SUCCESSFUL")

---

## 21. Admin Platform Specifications

- **Dashboard:** Live operational metrics, total transaction volumes, active provider health badges.
- **User Management:** Detailed user dossiers, KYC status, wallet overview, account freeze/unfreeze controls.
- **Transaction Supervision:** Full search by reference, phone, or email; investigation logs with provider response inspection.
- **Financial Controls:** Super Admin dual-approval balance adjustments with mandatory justification text.
- **Product Management:** Enable/disable products, edit price matrices, configure Disco commission splits.
- **Audit Logs:** Tamper-evident administrative audit log feed.

---

## 22. Audit Trail Requirements

The platform records an immutable audit log for every privileged event:
- `actor_id` (Admin UID or `SYSTEM`)
- `action_type` (`ROLE_CHANGE`, `WALLET_ADJUSTMENT`, `REFUND_PROCESSED`, `PRICE_UPDATE`, `PROVIDER_SWITCH`, `USER_SUSPENDED`)
- `target_id` (User ID, Product ID, Transaction ID)
- `before_state` & `after_state` (JSON snapshots)
- `reason` (Mandatory human-entered justification)
- `ip_address` & `user_agent`
- `timestamp` (Server timestamp)

---

## 23. Reconciliation Engine Requirements

The reconciliation system periodically cross-verifies:
1. **Wallet Balance vs. Ledger Sum:** $\sum \text{Ledger Credits} - \sum \text{Ledger Debits} == \text{Current Wallet Balance}$.
2. **Paystack Settlement vs. Wallet Funding:** Verified Paystack charges match total `WALLET_FUNDING` credits.
3. **Provider Orders vs. External History:** Orders marked `PENDING` longer than 120 seconds are queried against provider query endpoints (`/requery` or `/status`) and updated accordingly.

---

## 24. Security Model & Trust Boundaries

- **Zero-Trust Client:** Client inputs are treated as unvalidated strings. All business decisions, calculations, and balances originate on the server.
- **Secret Isolation:** Provider credentials (`PAYSTACK_SECRET_KEY`, `VTPASS_SECRET_KEY`, `CLUBKONNECT_API_KEY`, `RESEND_API_KEY`) reside exclusively in server runtime environment variables.
- **HMAC Webhook Verification:** Paystack and provider webhooks require signature authentication prior to JSON parsing.
- **Rate Limiting:** Edge-level rate limiting on auth, service purchases, and meter validation endpoints.

---

## 25. Privacy, Regulatory & Compliance Considerations

- **Regulatory Transparency:** Alexvya is an enterprise technology platform. Prior to commercial public launch, management must ensure adherence to:
  - Corporate Affairs Commission (CAC) business incorporation.
  - CBN guidelines on closed-loop stored-value digital wallets and payment collection.
  - Nigerian Data Protection Act (NDPA) privacy and PII handling standards.
  - Value-Added Service (VAS) partner aggregator contracts.
*(No platform feature or documentation constitutes legal or regulatory certification).*

---

## 26. Operational Analytics

- **Operational Metrics:** Daily Active Users (DAU), Transaction Success Rate (%), Mean Provider Latency (ms), Top Vended Electricity Discos, Data Bundle Distribution Breakdown.
- **Separation of Concerns:** Analytics aggregation queries run asynchronously or via read-only mirrors to prevent impacting real-time Firestore transactional throughput.

---

## 27. Error & Failure Experience Standards

| Scenario | Customer Experience & Messaging | System Action |
|---|---|---|
| **Insufficient Balance** | *"Your wallet balance is insufficient for this purchase. Please fund your wallet to continue."* | Operation blocked before provider call; no ledger impact. |
| **Meter Lookup Failed** | *"Unable to verify meter number. Please check the number and Disco selection."* | Returns safe error; no wallet debit. |
| **Provider Synchronous Rejection** | *"Unable to complete purchase with telecom network. Your wallet has not been charged."* | Immediate rollback; wallet balance restored atomically. |
| **Provider Network Timeout** | *"Your transaction is processing with the provider. We will update you shortly."* | Order marked `PENDING`; background reconciler polls provider. |
| **Confirmed Provider Failure** | *"Purchase could not be completed. Your wallet balance has been refunded."* | Server creates `CREDIT` refund ledger entry; sends email notification. |

---

## 28. Scalability Architecture

- **Micro-Engine Modularity:** Domain services (`WalletEngine`, `PricingEngine`, `OrderOrchestrator`, `ReconciliationWorker`) are written as isolated TypeScript modules ready for serverless or container deployment.
- **Provider Agnostic Design:** Adding a third or fourth provider (e.g., Shago, BuyPower, Baxi) requires only implementing a standard `ProviderAdapter` interface without modifying core order logic.

---

## 29. V1 Scope vs. Future Scope Matrix

| Feature / Domain | V1 Scope (Approved Baseline) | Future Scope (V2+ Backlog) |
|---|:---:|:---:|
| **Authentication** | Google Sign-In & Email/Password | Biometric Passkeys, SMS OTP Auth |
| **Wallet Funding** | Paystack (Card, Transfer, USSD) | Direct Bank Virtual Accounts (Monnify/Flutterwave) |
| **Airtime Top-up** | MTN, Airtel, Glo, 9mobile VTU | International Airtime Top-up |
| **Data Bundles** | SME, Corporate, Direct Data | International Data eSIMs |
| **Electricity Bills** | All Nigerian Discos (Token Vend & Postpaid) | Auto-Vend on Low Units Alert |
| **Cable TV** | DStv, GOtv, StarTimes | Showmax Bundling, Netflix Gift Cards |
| **Notifications** | In-App Inbox + Resend Email | WhatsApp Bot, SMS Alerts |
| **Receipts** | In-App Digital Receipts | Downloadable PDF / Thermal Printer Format |
| **Admin Portal** | Web-based RBAC Admin Suite | Dedicated Admin Mobile App |
| **Discounts & Loyalty**| Configurable Catalog Discounts | Referral Codes, Cashback Points |
| **API Access** | Internal Next.js API Routes | Public B2B Developer API & Webhooks |

---

## 30. Open Decisions & Stage 1 Sign-Off

### 30.1 Open Decisions
1. *Default Provider Selection Policy:* Confirm whether VTpass will serve as default primary for all VAS services, with ClubKonnect serving as fallback exclusively for MTN/Airtel SME Data and Airtime. *(To be formalized in Stage 1.2).*
2. *Customer Email Verification Grace Period:* Confirm whether unverified email accounts may browse the catalog in read-only mode prior to mandatory verification at checkout. *(Recommended: Read-only catalog permitted, verification required at funding/checkout).*

---

### 30.2 Stage 1 Completion Checklist
- [x] Product Identity and Vision defined.
- [x] Comprehensive V1 and Future Scope boundaries established.
- [x] User types, human roles, and system actors articulated.
- [x] Customer journeys (happy paths and failure recoveries) documented.
- [x] Firebase Authentication and profile permissions specified.
- [x] Wallet double-entry and integer kobo principles established.
- [x] Wallet funding and independent Paystack verification flows specified.
- [x] Airtime, Data, Electricity, and Cable TV product requirements defined.
- [x] Universal transaction lifecycle models outlined.
- [x] Multi-provider router and adapter architecture specified.
- [x] Server-authoritative pricing and profit reporting models detailed.
- [x] Notification and digital receipt specifications established.
- [x] Admin governance, audit logging, and reconciliation requirements defined.
- [x] Security trust boundaries and compliance considerations documented.
- [x] Error experience standards and scalability principles defined.
- [x] Open decisions clearly listed.

---

**STAGE 1 COMPLETE — PROCEED ONLY TO STAGE 1.1 UPON EXPLICIT USER INSTRUCTION.**
