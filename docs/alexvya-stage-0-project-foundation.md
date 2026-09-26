# Alexvya — Stage 0: Project Foundation & Architecture

**Document Version:** 1.0.0  
**Status:** Approved Architectural Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** Next.js / TypeScript / Firebase / Google Cloud / Firebase App Hosting  
**Current Stage:** Stage 0 (Project Foundation)

---

## 1. Executive Overview & Brand Scope

**Alexvya** is an enterprise-grade Nigerian digital services platform designed to provide dependable, high-speed value-added telecommunications and utility services:

- **Airtime VTU Purchases:** Instant top-up across MTN, Airtel, Glo, and 9mobile.
- **Mobile Data Bundles:** SME, Direct, and Corporate Gifting data plans with dynamic provider routing.
- **Electricity Utility Payments:** Prepaid token generation and postpaid billing across all Nigerian Discos (IKEDC, EKEDC, AEDC, IBEDC, PHED, etc.).
- **Cable TV Subscriptions:** Instant validation and bouquet renewal for DStv, GOtv, and StarTimes.
- **Customer Wallet & Funding:** Server-verified Paystack checkout and double-entry balance management.
- **Transaction History & Ledger:** Transparent, immutable auditing for all debits, credits, and refunds.
- **Notifications:** In-app and transactional email updates via Resend.
- **Account & Identity Management:** Multi-factor Firebase Authentication with KYC verification tiers.
- **Administrative Governance:** Role-Based Access Control (RBAC) for transaction reconciliation, routing overrides, and audit investigations.

### Future Brand Trajectory
The underlying architectural foundation is engineered to scale into the broader **Alexvya Technologies** ecosystem:
- *Alexvya Wallet* (Consumer financial management)
- *Alexvya Pay* (Merchant checkout gateway)
- *Alexvya Business* (Corporate disbursement and bulk VTU)
- *Alexvya API* (Developer-facing B2B digital services)

---

## 2. Selected Technology Stack

| Layer / Concern | Chosen Technology | Architectural Rationale |
|---|---|---|
| **Framework & Frontend** | Next.js (App Router) + TypeScript | Server-Side Rendering (SSR), Edge Route Handlers, type-safe API boundaries, SEO optimization. |
| **Styling & UI Shell** | Tailwind CSS + Lucide Icons + shadcn/ui | High-performance, clean, mobile-optimized fintech design system without runtime CSS overhead. |
| **Authentication Authority** | Firebase Authentication | Enterprise identity management, Google Sign-in, email/password, email verification, session tokens. |
| **Primary Database** | Cloud Firestore (Google Cloud) | Real-time synchronization, multi-region high availability, document-level security rules, sub-collection isolation. |
| **Hosting & Runtime** | Firebase App Hosting / Google Cloud | Managed Next.js SSR execution, automatic GitHub CI/CD deployments, zero-maintenance scaling. |
| **Payment Gateway** | Paystack (Server-Mediated) | Authoritative Nigerian payment channels (Card, Bank Transfer, USSD), webhook signature verification. |
| **VAS / Telecom Providers** | VTpass & ClubKonnect (Dual Router) | Redundant fulfillment routing for airtime, data, and bill vending. |
| **Transactional Email** | Resend | High-deliverability transactional receipts and security alerts. |
| **Source Control** | GitHub | Version control, branch protection, automated CI/CD pipeline triggers. |

---

## 3. High-Level Application Architecture

All application operations strictly adhere to an authoritative, server-mediated control flow. The browser client is treated as an **untrusted environment**.

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             Customer Browser / Client                            │
│           Next.js Client Components • User Form Inputs • Local UI State          │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ HTTPS / JSON / Session JWT
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         Next.js Edge / Server Gateway                            │
│             Route Handlers (/api/*) • Input Validation • Rate Limiting           │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Authenticate Session & Extract Claims
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    Authoritative Authentication & RBAC Layer                     │
│               Firebase Auth Token Verification + Firestore Role Lookup           │
│                              (CUSTOMER, ADMIN, AUDITOR)                          │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Authorized Application Call
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             Domain Business Logic                                │
│       WalletEngine | PricingEngine | OrderOrchestrator | WebhookVerifier         │
│          (Strict Invariant Validation, Kobo Calculations, Idempotency)           │
└───────────────────────┬──────────────────────────────────┬───────────────────────┘
                        │                                  │
         Direct Firestore│                                 │ Provider Adapter
         Transaction     │                                 │ (Outbound HTTPS)
                        ▼                                  ▼
┌───────────────────────────────────────┐  ┌───────────────────────────────────────┐
│            Cloud Firestore            │  │           External Providers          │
│  - users / profiles                   │  │  - Paystack (Funding & Verification)  │
│  - wallets (Atomic transactions)      │  │  - VTpass (Airtime, Data, Power, TV)  │
│  - wallet_ledger (Immutable double)   │  │  - ClubKonnect (VTU Fallback/Routing) │
│  - transactions & service_orders      │  │  - Resend (Transactional Email)       │
│  - audit_logs & webhook_events        │  └───────────────────────────────────────┘
└───────────────────────────────────────┘
```

---

## 4. Firebase Architecture & Firestore Strategy

### 4.1 Firebase Authentication
- Manages user identity, session lifecycle, and authentication credentials.
- Supports **Google Sign-In** and **Email/Password** authentication.
- Enforces email verification state before allowing high-tier transaction limits.
- Client browsers authenticate directly with Firebase Auth, receiving secure JWT tokens.
- Server-side Next.js route handlers verify ID tokens using the Firebase Admin SDK.

### 4.2 Cloud Firestore Database Model (Conceptual Architecture)
Firestore provides document storage structured to isolate private customer data, ledger records, and administrative controls:

- **Entity Isolation:** Customer profiles (`users/{userId}`), wallets (`wallets/{walletId}`), and ledger records (`wallets/{walletId}/ledger/{entryId}`).
- **Zero-Trust Security Rules:** Client SDKs are restricted to read-only views of their own profiles and transaction history.
- **Server-Authoritative Mutations:** All financial mutations (wallet balance changes, payment creations, service order vending) are executed exclusively through the Firebase Admin SDK inside server route handlers wrapped in atomic `runTransaction` blocks.

*Note:* Detailed collection schemas, sub-collection structures, and security rule matrices will be formalized in the dedicated Database Architecture Stage.

---

## 5. Financial Safety & Invariants

Because Alexvya processes real monetary transactions, strict architectural invariants are established at baseline:

1. **Integer Kobo Standard:** All financial amounts are calculated, stored, and transmitted as **non-negative integer kobo** (`1 NGN = 100 kobo`). Floating-point mathematics (`0.1 + 0.2`) are strictly forbidden.
2. **Server-Authoritative Pricing:** The client browser never supplies product prices, discounts, or transaction totals. The server's `PricingEngine` determines exact charges.
3. **No Direct Wallet Modification:** The client cannot write or update wallet balances. Balances can only change via server-side atomic transactions.
4. **Immutable Double-Entry Ledger:** Every wallet balance change must produce a corresponding, immutable ledger entry (`CREDIT` or `DEBIT`) with before/after balances and source transaction references.
5. **Idempotency Enforcement:** All payment initializations, service purchase orders, and webhook ingestions require unique idempotency keys to prevent duplicate executions during network retries.
6. **Provider Disconnect Safety:** Provider timeouts or unhandled exceptions are never treated as immediate failures or successes. Orders enter a `PENDING` state until resolved by automated reconciliation workers or webhooks.
7. **Strict Audit Trail:** Every administrative action, manual balance adjustment, or provider override produces an immutable audit record.

---

## 6. Security Model & Trust Boundaries

```text
Untrusted Zone: Customer Browser / Mobile Web
  │ (User input, DOM state, Client cookies, Javascript execution)
  ▼
Trust Boundary: Next.js API Gateway (/api/*)
  │ (JWT Verification, CORS, Rate Limiting, Input Sanitization)
  ▼
Secure Zone: Server-Side Services & Firebase Cloud
  │ (Admin SDK, Provider Secret Keys, Firestore Transactions, Webhook Handlers)
  ▼
External Zone: Third-Party Service Providers
  │ (Paystack, VTpass, ClubKonnect, Resend via HTTPS)
```

### Security Rules:
- **No Secret Exposure:** Downstream provider keys (`PAYSTACK_SECRET_KEY`, `VTPASS_SECRET_KEY`, `CLUBKONNECT_API_KEY`, `RESEND_API_KEY`, `FIREBASE_PRIVATE_KEY`) exist exclusively on the server and must never appear in client bundles or API responses.
- **HMAC Webhook Verification:** Paystack and provider webhooks must be cryptographically verified using constant-time HMAC comparison before processing.
- **Role-Based Access Control:** Administrative endpoints check user role claims stored securely in Firestore against verified Firebase Auth UIDs.

---

## 7. Environment & Secrets Management Strategy

Environment variables are partitioned cleanly between client-safe public keys and server-only secrets:

### 7.1 Configuration Structure (`.env.example`)
```env
# Application Context
NEXT_PUBLIC_APP_ENV="development"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Firebase Client SDK (Public)
NEXT_PUBLIC_FIREBASE_API_KEY=""
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=""
NEXT_PUBLIC_FIREBASE_PROJECT_ID=""
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=""
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=""
NEXT_PUBLIC_FIREBASE_APP_ID=""

# Firebase Admin SDK (Server Secret)
FIREBASE_PROJECT_ID=""
FIREBASE_CLIENT_EMAIL=""
FIREBASE_PRIVATE_KEY=""

# Payment Gateway (Server Secret)
PAYSTACK_PUBLIC_KEY=""
PAYSTACK_SECRET_KEY=""
PAYSTACK_WEBHOOK_SECRET=""

# VAS Providers (Server Secret)
VTPASS_API_KEY=""
VTPASS_SECRET_KEY=""
VTPASS_PUBLIC_KEY=""
CLUBKONNECT_USER_ID=""
CLUBKONNECT_API_KEY=""

# Communications (Server Secret)
RESEND_API_KEY=""
SYSTEM_EMAIL_SENDER="Alexvya <noreply@alexvya.com>"
```

### 7.2 Secrets Governance
- Development: Local `.env.local` (ignored by Git).
- Production: Google Cloud Secret Manager integrated directly into Firebase App Hosting build and runtime environments.

---

## 8. Scalable Project Directory Structure

```text
alexvya/
├── .env.example                       # Environment template
├── .gitignore                          # Git exclusions (Secrets, build artifacts)
├── metadata.json                       # AI Studio project configuration
├── package.json                        # Dependency declarations
├── tsconfig.json                       # TypeScript compiler options
├── vite.config.ts / next.config.mjs    # Bundler & framework configuration
│
├── docs/                               # Architectural Specifications (Stage Artifacts)
│   ├── alexvya-stage-0-project-foundation.md
│   └── (Future Stage Documents...)
│
├── src/                                # Application Source Code
│   ├── app/                            # Next.js App Router (Pages, Layouts, API Routes)
│   │   ├── api/                        # Server Route Handlers
│   │   │   ├── auth/                   # Session verification endpoints
│   │   │   ├── wallet/                 # Wallet funding and inquiry routes
│   │   │   ├── services/               # Airtime, Data, Electricity, Cable routes
│   │   │   ├── webhooks/               # Ingest handlers (Paystack, VTpass)
│   │   │   └── admin/                  # Protected management routes
│   │   ├── (auth)/                     # Sign-in, Sign-up, Password Recovery
│   │   ├── (dashboard)/                # Customer Wallet, Services, History
│   │   ├── (admin)/                    # Admin Dashboard, Reconciliations, Logs
│   │   ├── layout.tsx                  # Root Application Shell
│   │   └── page.tsx                    # Landing Page
│   │
│   ├── components/                     # Reusable UI & Domain Components
│   │   ├── ui/                         # Base design primitives (Buttons, Cards, Inputs)
│   │   ├── layout/                     # Headers, Footers, Navigation sidebars
│   │   ├── auth/                       # Auth forms & state listeners
│   │   └── services/                   # Service purchase modals and selectors
│   │
│   ├── lib/                            # Infrastructure & External Integrations
│   │   ├── firebase/                   # Firebase Client & Admin SDK initializers
│   │   │   ├── client.ts               # Browser SDK (Auth, Firestore read-only)
│   │   │   └── admin.ts                # Server Admin SDK (Privileged operations)
│   │   ├── providers/                  # Provider Adapters & Routers
│   │   │   ├── paystack.ts             # Paystack payment API adapter
│   │   │   ├── vtpass.ts               # VTpass VAS API adapter
│   │   │   ├── clubkonnect.ts          # ClubKonnect fallback adapter
│   │   │   └── resend.ts               # Email dispatch adapter
│   │   └── utils/                      # Formatting, kobo converters, validation helpers
│   │
│   ├── services/                       # Core Authoritative Business Services
│   │   ├── wallet.service.ts           # Double-entry ledger & balance mutations
│   │   ├── pricing.service.ts          # Server-side pricing & commission calculation
│   │   ├── order.service.ts            # Service order lifecycle orchestrator
│   │   └── audit.service.ts            # Immutable event logging
│   │
│   └── types/                          # Shared TypeScript Domain Interfaces
│       ├── user.ts                     # User profiles and roles
│       ├── wallet.ts                   # Wallets, ledger entries, funding attempts
│       ├── transaction.ts              # Transactions, service orders, statuses
│       └── provider.ts                 # Provider requests, responses, webhook payloads
```

---

## 9. Error Handling & Observability Standards

### 9.1 Structured Error Envelope
All server endpoints return a standardized, safe JSON error format without exposing internal stack traces:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Your wallet balance is insufficient for this transaction."
  },
  "meta": {
    "timestamp": "2026-09-22T16:45:00.000Z",
    "request_id": "req_01J8X9V2Q4A6BC8D0EF1234567"
  }
}
```

### 9.2 Safe Logging Standards
- All logs emitted by backend services must be sanitized.
- **Redaction Rules:** Never log passwords, raw PINs, API keys, webhook signing secrets, full credit card numbers, or customer bank account tokens.
- Critical state changes (e.g., wallet funding confirmation, manual balance adjustment) emit structured audit logs to Firestore.

---

## 10. Deployment Target & CI/CD Strategy

- **Target:** **Firebase App Hosting / Google Cloud**
- **Process:**
  1. Developers commit clean, tested code to GitHub main branch.
  2. Firebase App Hosting automatically triggers builds, compiling Next.js SSR assets.
  3. Environment secrets are injected securely via Google Cloud Secret Manager.
  4. Serverless containers deploy across Google Cloud's enterprise infrastructure with automated health monitoring.

---

## 11. Staged Development Boundaries

To guarantee production-grade stability, development is divided into discrete, sequential stages:

- **Stage 0 (Current):** Project foundation, architecture baseline, security boundaries, repository configuration, documentation.
- **Stage 1 (Next):** Complete Database Architecture (Firestore document schemas, security rules, indexes), Provider Pricing Architecture, Exact API Specification, and Transaction State Machines.
- **Stage 2:** Core Platform Implementation (Firebase Auth integration, Firestore transactions, Paystack wallet funding, VTpass/ClubKonnect integrations, Next.js UI).
- **Stage 3:** Hardening, automated security rules testing, end-to-end reconciliation testing, and Firebase App Hosting deployment.

---

## 12. Unresolved Setup Decisions

1. **Firestore Multi-Region Location:** Decision on primary Cloud Firestore region (`europe-west3` Frankfurt vs `europe-west1` Belgium) based on lowest latency to Nigerian network hops and payment gateways.
2. **Provider Failover Thresholds:** Finalization of circuit-breaker failure count (e.g., 3 consecutive failures within 60 seconds) before automatic failover from VTpass to ClubKonnect.

*All foundational architectural requirements for Stage 0 are fully resolved and documented.*
