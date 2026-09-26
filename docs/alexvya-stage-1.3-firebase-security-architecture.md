# Alexvya — Stage 1.3: Firebase Security Architecture

**Document Version:** 1.0.0  
**Status:** Approved Security Architecture Baseline  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** Next.js (App Router) / TypeScript / Firebase Authentication / Cloud Firestore / Firebase Admin SDK / Google Cloud  
**Current Stage:** Stage 1.3 (Firebase Security Architecture)  
**Preceding Stages:**  
- `docs/alexvya-stage-0-project-foundation.md`  
- `docs/alexvya-stage-1-product-blueprint.md`  
- `docs/alexvya-stage-1.1-firestore-database-architecture.md`  
- `docs/alexvya-stage-1.2-provider-pricing-architecture.md`

---

## 1. Security Objective & Zero-Trust Architecture

Alexvya operates under a strict **Zero-Trust Security Model**. In this paradigm:
1. **The Client Environment is Hostile:** The browser, mobile web client, and any client-side JavaScript execution context are classified as completely **UNTRUSTED**.
2. **Untrusted Inputs:** Clients can manipulate DOM states, tamper with HTTP request parameters, forge price values, spoof wallet amounts, replay captured tokens, or attempt direct unauthorized database writes.
3. **External Systems are Untrusted:** External API responses and webhooks (Paystack, VTpass, ClubKonnect, Resend) are treated as untrusted until cryptographically verified, normalized, and validated.
4. **Server Authority Invariant:** The Next.js server runtime—executing with Google Cloud service credentials via the **Firebase Admin SDK**—is the **sole authoritative entity** permitted to evaluate pricing, mutate wallet balances, append to financial journals, and finalize transaction statuses.

---

## 2. Trust Boundaries & Component Classification

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        UNTRUSTED BOUNDARY                              │
│  - Browser Client / React Components / Client-Side JavaScript          │
│  - Network Edge / Raw Inbound HTTP Requests / Intermediary Proxies     │
│  - Raw External Webhook Payloads (Prior to HMAC Verification)          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS + Firebase ID Token / HMAC
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   PARTIALLY TRUSTED BOUNDARY                           │
│  - Authenticated Customer Sessions (Restricted by Role & Status)       │
│  - Upstream Provider API Endpoints (Subject to Strict Validation)      │
│  - Firebase App Check Attestation Tokens                               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Validated Server Handler
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       FULLY TRUSTED BOUNDARY                           │
│  - Next.js Server Route Handlers / Server Actions                      │
│  - Firebase Admin SDK (Privileged Service Account Context)             │
│  - Google Cloud Secret Manager (API Secrets & Private Keys)            │
│  - Cloud Firestore Core Storage Engine                                 │
│  - Cloud Scheduler / Background Requery Cron Tasks (OIDC Authenticated)│
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Execution Permissions by Component

| Component | Client Read | Client Write | Server (Admin SDK) Read | Server (Admin SDK) Write |
|---|:---:|:---:|:---:|:---:|
| **`users/{userId}`** | Permitted (Self only) | Restricted (Safe profile fields only) | Full | Full |
| **`wallets/{userId}`** | Permitted (Self only) | **DENIED (Zero client writes)** | Full | **Full (Transactional)** |
| **`wallets/{userId}/ledger/{id}`** | Permitted (Self only) | **DENIED (Zero client writes)** | Full | **Append-Only** |
| **`transactions/{id}`** | Permitted (Self only) | **DENIED (Zero client writes)** | Full | Full |
| **`paymentAttempts/{id}`** | Permitted (Self only) | **DENIED (Zero client writes)** | Full | Full |
| **`serviceOrders/{id}`** | Permitted (Self only) | **DENIED (Zero client writes)** | Full | Full |
| **`serviceProducts/{id}`** | Permitted (Public catalog) | **DENIED (Zero client writes)** | Full | Full (Admin Gated) |
| **`providers/{id}`** | **DENIED** | **DENIED** | Full | Full (Admin Gated) |
| **`providerTransactions/{id}`** | **DENIED** | **DENIED** | Full | Append/Update (Server) |
| **`webhookEvents/{id}`** | **DENIED** | **DENIED** | Full | Append/Update (Server) |
| **`adminUsers/{userId}`** | **DENIED** | **DENIED** | Full | Super-Admin Only |
| **`auditLogs/{id}`** | **DENIED** | **DENIED** | Full | **Append-Only** |
| **`idempotencyKeys/{id}`** | **DENIED** | **DENIED** | Full | Full (Server Managed) |

---

## 3. Firebase Authentication Architecture

Firebase Authentication provides core identity management, password hashing (scrypt), and secure JSON Web Tokens (JWT).

```text
                     ┌────────────────────────────────┐
                     │          Registration          │
                     │  (Email/Password or Google)    │
                     └───────────────┬────────────────┘
                                     │
                                     ▼
                     ┌────────────────────────────────┐
                     │    Verification Email Sent     │
                     │    (Verification Gate Active)  │
                     └───────────────┬────────────────┘
                                     │
                                     ▼
                     ┌────────────────────────────────┐
                     │       Email Verified?          │
                     ├───────────────┬────────────────┤
                     │ NO            │ YES            │
                     ▼               ▼                │
         ┌───────────────────┐  ┌───────────────────┐ │
         │ Restricted State: │  │ Active Customer:  │ │
         │ - Read Profile    │  │ - Full Purchases  │ │
         │ - Browse Catalog  │  │ - Wallet Funding  │ │
         │ - BLOCKED: Funding│  │ - Bill Payments   │ │
         │ - BLOCKED: Orders │  │ - Notifications   │ │
         └───────────────────┘  └───────────────────┘ │
                                                      ▼
                                        ┌──────────────────────────┐
                                        │ High-Value Sensitive     │
                                        │ Actions (Re-auth Gate):  │
                                        │ - Password / Email Change│
                                        │ - High-Value Fundings    │
                                        └──────────────────────────┘
```

### 3.1 Verification Gating Policy
- **Unverified Accounts (`email_verified == false`):** May authenticate, inspect their profile, and browse public service product pricing. They are **strictly blocked by server route handlers** from funding wallets, initiating orders, or changing security preferences.
- **Account Status Gating:** If `users/{userId}.account_status` is set to `SUSPENDED` or `FROZEN`, all authenticated API requests fail immediately with `403 Forbidden`, regardless of JWT validity.
- **Session Revocation & Token Freshness:** Sensitive operations (password updates, email changes, admin actions) require Firebase `auth_time` to be within 5 minutes (reauthentication gate).

---

## 4. Dual-Layer Authorization Model

To eliminate privilege escalation risks, Alexvya implements a **Dual-Layer Authorization Model**:

```text
Layer 1: Firebase Custom Claims + Firestore Security Rules (Client-to-Firestore Boundary)
  ├── Fast rule-based validation on direct SDK queries (e.g. request.auth.token.role == "ADMIN")
  └── Eliminates unauthorized direct Firestore queries from the browser.

Layer 2: Database-Gated Authorization (Server-to-Admin SDK Boundary)
  ├── CRITICAL: The Firebase Admin SDK BYPASSES all Firestore Security Rules!
  ├── Therefore, server route handlers NEVER trust Custom Claims or client JWTs alone.
  └── Server handlers MUST read `adminUsers/{userId}` directly from Firestore in the same 
      transaction and verify `is_active == true` before executing any privileged action.
```

### 4.1 Authorization Roles

```typescript
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  AUDITOR = 'AUDITOR',
  SYSTEM = 'SYSTEM'
}
```

1. **`CUSTOMER`**: Default authenticated user. Access strictly isolated to documents where `user_id == request.auth.uid`.
2. **`ADMIN`**: Operational staff. Can inspect orders, manage catalog pricing, view non-sensitive webhook logs, and initiate approved refunds. **Cannot modify admin roles or access secret credentials.**
3. **`SUPER_ADMIN`**: Executive administrator. Can modify staff roles in `adminUsers`, configure provider routing policies, trigger system-wide maintenance modes, and perform high-value overrides.
4. **`AUDITOR`**: Compliance officer. Has **read-only** visibility across financial journals, transactions, audit logs, and reconciliation records. **Has zero write or mutation privileges.**
5. **`SYSTEM`**: Internal background workers and cron tasks executing with dedicated Google Cloud Service Account credentials.

---

## 5. Role Permissions Matrix

| Operational Capability | Customer | Admin | Super Admin | Auditor | System / Server |
|---|:---:|:---:|:---:|:---:|:---:|
| Read Own Profile & Wallet | ✅ | ✅ (Own) | ✅ (Own) | ✅ (Own) | ✅ |
| Update Own Permitted Profile Fields | ✅ | ✅ (Own) | ✅ (Own) | ✅ (Own) | ✅ |
| Initiate VAS Purchase Orders | ✅ | ❌ (Client SDK) | ❌ (Client SDK) | ❌ | ✅ (Server Route) |
| Initialize Wallet Funding | ✅ | ❌ (Client SDK) | ❌ (Client SDK) | ❌ | ✅ (Server Route) |
| Read Public Product Catalog | ✅ | ✅ | ✅ | ✅ | ✅ |
| Update Product Catalog & Pricing | ❌ | ✅ | ✅ | ❌ | ✅ |
| View Customer Transactions & Orders | ❌ (Others) | ✅ (Read Only) | ✅ (Read Only) | ✅ (Read Only) | ✅ |
| Trigger Manual Order Requery | ❌ | ✅ | ✅ | ❌ | ✅ |
| Issue Customer Wallet Refund | ❌ | ✅ (With Justification) | ✅ | ❌ | ✅ (Transactional) |
| Modify Provider Routing & Status | ❌ | ❌ | ✅ | ❌ | ✅ |
| Assign / Revoke Administrative Roles | ❌ | ❌ | ✅ | ❌ | ✅ |
| Read Audit Logs (`auditLogs`) | ❌ | ✅ (Operational) | ✅ (Full) | ✅ (Full) | ✅ |
| Mutate Wallet Ledger Directly | ❌ | ❌ | ❌ | ❌ | ✅ (Admin SDK Only) |

---

## 6. Firestore Security Rules Design (Specification)

> **Security Invariant:** All financial mutations (debits, credits, refunds) are handled server-side via the Firebase Admin SDK. Firestore Security Rules enforce strict read-level isolation and deny all unauthorized client writes.

### 6.1 Conceptual Security Rules Architecture

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper Functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function isAdmin() {
      return isAuthenticated() && 
        (request.auth.token.role == 'ADMIN' || request.auth.token.role == 'SUPER_ADMIN');
    }
    
    function isSuperAdmin() {
      return isAuthenticated() && request.auth.token.role == 'SUPER_ADMIN';
    }
    
    function isAuditor() {
      return isAuthenticated() && request.auth.token.role == 'AUDITOR';
    }

    // Default Deny All Catch-All
    match /{document=**} {
      allow read, write: if false;
    }

    // 1. users/{userId}
    match /users/{userId} {
      allow read: if isOwner(userId) || isAdmin() || isAuditor();
      allow create: if isOwner(userId) && request.resource.data.id == userId;
      allow update: if isOwner(userId) && 
        request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'first_name', 'last_name', 'phone_number', 'display_name', 'notification_preferences'
        ]);
      allow delete: if false; // Soft-deletes only via server
    }

    // 2. wallets/{userId}
    match /wallets/{userId} {
      allow read: if isOwner(userId) || isAdmin() || isAuditor();
      allow write: if false; // ZERO CLIENT WRITES (Server Admin SDK Only)
      
      // 3. wallets/{userId}/ledger/{ledgerId}
      match /ledger/{ledgerId} {
        allow read: if isOwner(userId) || isAdmin() || isAuditor();
        allow write: if false; // ZERO CLIENT WRITES (Immutable Server Ledger)
      }
    }

    // 4. transactions/{transactionId}
    match /transactions/{transactionId} {
      allow read: if (isAuthenticated() && resource.data.user_id == request.auth.uid) || isAdmin() || isAuditor();
      allow write: if false; // Server Admin SDK Only
    }

    // 5. paymentAttempts/{paymentAttemptId}
    match /paymentAttempts/{paymentAttemptId} {
      allow read: if (isAuthenticated() && resource.data.user_id == request.auth.uid) || isAdmin() || isAuditor();
      allow write: if false; // Server Admin SDK Only
    }

    // 6. serviceOrders/{orderId} & Sub-Orders (airtimeOrders, dataOrders, billOrders)
    match /serviceOrders/{orderId} {
      allow read: if (isAuthenticated() && resource.data.user_id == request.auth.uid) || isAdmin() || isAuditor();
      allow write: if false;
    }
    match /airtimeOrders/{orderId} {
      allow read: if (isAuthenticated() && resource.data.user_id == request.auth.uid) || isAdmin() || isAuditor();
      allow write: if false;
    }
    match /dataOrders/{orderId} {
      allow read: if (isAuthenticated() && resource.data.user_id == request.auth.uid) || isAdmin() || isAuditor();
      allow write: if false;
    }
    match /billOrders/{orderId} {
      allow read: if (isAuthenticated() && resource.data.user_id == request.auth.uid) || isAdmin() || isAuditor();
      allow write: if false;
    }

    // 7. serviceProducts/{productId}
    match /serviceProducts/{productId} {
      allow read: if resource.data.is_active == true || isAdmin() || isAuditor();
      allow write: if false; // Admin mutations mediated via Server API to log audits
    }

    // 8. providers & providerTransactions
    match /providers/{providerId} {
      allow read: if isAdmin() || isSuperAdmin() || isAuditor();
      allow write: if false;
    }
    match /providerTransactions/{providerTransactionId} {
      allow read: if isAdmin() || isAuditor();
      allow write: if false;
    }

    // 9. webhookEvents/{webhookEventId}
    match /webhookEvents/{webhookEventId} {
      allow read: if isAdmin() || isAuditor();
      allow write: if false;
    }

    // 10. notifications/{notificationId}
    match /notifications/{notificationId} {
      allow read: if isAuthenticated() && resource.data.user_id == request.auth.uid;
      allow update: if isAuthenticated() && resource.data.user_id == request.auth.uid &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['is_read']);
      allow create, delete: if false;
    }

    // 11. adminUsers/{userId}
    match /adminUsers/{userId} {
      allow read: if isOwner(userId) || isSuperAdmin() || isAuditor();
      allow write: if false; // Super-Admin changes mediated via Server API
    }

    // 12. auditLogs/{auditLogId}
    match /auditLogs/{auditLogId} {
      allow read: if isAdmin() || isSuperAdmin() || isAuditor();
      allow write: if false; // Append-only via Server Admin SDK
    }

    // 13. idempotencyKeys/{idempotencyKey}
    match /idempotencyKeys/{idempotencyKey} {
      allow read, write: if false; // 100% Server Internal
    }
  }
}
```

---

## 7. Financial & Wallet Security Invariants

1. **Zero Client-Side Calculation:** The browser submits only raw purchase intents (e.g. `{ productId: "prod_mtn_1gb", recipient: "08012345678" }`). The server calculates all debits, discounts, fees, and wholesale costs.
2. **Atomic Firestore Transactions (`runTransaction`):** All wallet debits and credits execute inside a Firestore transaction:
   - Reads current `wallets/{userId}`.
   - Verifies `available_balance_kobo >= total_charged_kobo`.
   - Verifies `account_status == "ACTIVE"`.
   - Computes new balances: $\text{new\_balance} = \text{available\_balance\_kobo} - \text{total\_charged\_kobo}$.
   - Appends atomic ledger document to `wallets/{userId}/ledger/{ledgerId}` with `balance_before_kobo` and `balance_after_kobo`.
   - Increments wallet `version` counter.
3. **Replay & Concurrency Protection:** Protected via unique `idempotencyKeys/{idempotencyKey}` holding SHA-256 request payload hashes and execution locks.

---

## 8. Webhook & Inbound Payment Security

### 8.1 Paystack Webhook Ingestion Pipeline

```text
Inbound HTTP POST /api/webhooks/paystack
   │
   ├── 1. Capture Raw Request Body Buffer (Before JSON parsing)
   │
   ├── 2. Extract X-Paystack-Signature Header
   │
   ├── 3. Compute HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)
   │
   ├── 4. Constant-Time Signature Comparison (crypto.timingSafeEqual)
   │      └── If Invalid ➔ Return 401 Unauthorized immediately
   │
   ├── 5. Compute Deterministic Event Hash: SHA256("PAYSTACK" + event_id + reference)
   │
   ├── 6. Atomically Check/Lock webhookEvents/{eventHash} in Firestore
   │      └── If already PROCESSED ➔ Return 200 OK immediately (Idempotent Deduplication)
   │
   ├── 7. Query Paystack REST API (/transaction/verify/:reference) to Re-Verify
   │      └── Verifies amount, currency (NGN), and status independently
   │
   └── 8. Execute Atomic Transaction:
          ├── Credit wallets/{userId}
          ├── Append wallets/{userId}/ledger
          ├── Mark paymentAttempts/{id} SUCCESSFUL
          └── Mark webhookEvents/{eventHash} PROCESSED
```

### 8.2 Provider Webhook & Status Callback Security (VTpass / ClubKonnect)
- **Signature / Token Verification:** Where supported, validate provider bearer tokens or query secrets against environment variables.
- **Compensating Security for Non-Signed Callbacks:** If a provider webhook lacks cryptographic signatures, the server **never mutates financial state based on the callback payload alone**. Instead, the receipt of a callback triggers an authoritative outbound status requery (`/requery`) to confirm order delivery before updating database state.

---

## 9. API Gateway & Server-Side Defense-in-Depth

Every privileged Next.js server route handler (`/api/*`) executes the following 8-step defense pipeline:

```text
1. Transport Security: Verify HTTPS & enforce TLS 1.3.
2. App Check Verification: Validate Firebase App Check Attestation Token.
3. Authentication Gate: Extract & verify Firebase Bearer ID Token; obtain `userId`.
4. Account Status Gate: Verify `users/{userId}.account_status == "ACTIVE"`.
5. Rate Limit Guard: Enforce sliding-window rate limit for `userId` and client IP.
6. Schema Validation: Parse & sanitize request body using Zod schemas; reject unknown fields.
7. Authoritative Data Resolution: Query authoritative price/cost from `serviceProducts` (Ignore client amounts).
8. Atomic Execution & Audit: Execute inside Firestore `runTransaction` with structured audit logging.
```

---

## 10. Rate Limiting & Abuse Prevention Strategy

Rate limits are enforced at the server routing layer using in-memory token buckets backed by sliding-window counters:

| Endpoint Category | Rate Limit (Per User) | Rate Limit (Per IP) | Action on Breach |
|---|---|---|---|
| **Authentication / Login** | 5 requests / 5 mins | 20 requests / 5 mins | 429 Too Many Requests + 15 min cooldown |
| **Password Reset Requests** | 2 requests / hour | 5 requests / hour | 429 Too Many Requests |
| **Wallet Funding Init** | 10 requests / hour | 30 requests / hour | 429 Too Many Requests |
| **VAS Purchases (Airtime/Data/Bills)**| 20 requests / min | 60 requests / min | 429 (Throttle) |
| **Meter/Smartcard Validation** | 15 requests / min | 45 requests / min | 429 (Anti-Scraping Guard) |
| **Webhooks Ingestion** | N/A (Provider Specific) | 300 requests / min | 429 with Exponential Backoff Headers |
| **Admin Operations** | 60 requests / min | 120 requests / min | 429 + Security Incident Alert |

---

## 11. Firebase App Check Architecture

Alexvya integrates **Firebase App Check** across all production client touchpoints:
1. **Web Client Provider:** **reCAPTCHA Enterprise** generates attestation tokens verifying requests originate from genuine Alexvya web applications.
2. **Protection Scope:**
   - Blocks automated bots, headless scrapers, and scripted API spam.
   - Protects Cloud Firestore client reads from unauthorized third-party extraction.
3. **App Check vs. Authorization Boundary:**
   > **Crucial Invariant:** App Check proves that a request came from an authentic Alexvya client binary, but **App Check is NOT an authorization mechanism**. All user identity, role permissions, and financial bounds are enforced independently via Firebase Auth, Security Rules, and server route handlers.

---

## 12. Administrative Security & Privilege Governance

1. **Zero Self-Assignment:** No user can promote themselves. Administrative role assignments require a direct write to `adminUsers/{userId}` by an existing `SUPER_ADMIN`.
2. **Two-Man Rule for High-Risk Actions:**
   - Adjusting product wholesale/retail pricing requires an explicit justification log.
   - Manual wallet credits $> \text{₦}10,000$ require two `SUPER_ADMIN` approvals.
3. **Administrative MFA:** All admin and super-admin Firebase accounts must enforce Multi-Factor Authentication (SMS / TOTP Authenticator).
4. **Session Lifetime Limits:** Administrative active session lifetimes are capped at 4 hours before requiring reauthentication.

---

## 13. Audit Logging & Non-Repudiation Architecture

The `auditLogs` collection serves as an immutable, append-only security journal:
- **Server Generated:** Audit logs are written exclusively via the Firebase Admin SDK.
- **Zero Client or Admin Deletion:** Firestore Security Rules explicitly deny all client and administrative `delete` or `update` operations on `auditLogs`.
- **Mandatory Fields:** Every audit entry contains:
  - `actor_id` (Auth UID or `"SYSTEM"`) & `actor_role`.
  - `action` (e.g. `WALLET_ADJUSTMENT`, `PRICE_UPDATE`, `ROLE_CHANGE`).
  - `target_collection` & `target_id`.
  - `before_state` & `after_state` deep JSON diffs.
  - `reason` (Mandatory human text justification).
  - `correlation_id` & `ip_address`.
  - `created_at` (Server Timestamp).

---

## 14. Secret Management & Credential Isolation

### 14.1 Native Firebase Integration vs. Application Secrets Boundary

1. **Native Google AI Studio / Firebase Integration:**
   - **Client Configuration:** The Firebase client configuration (Project ID, Auth Domain, Storage Bucket, App ID, Web API Key) is provided directly via the native Google AI Studio / Firebase platform integration. Developers are **NOT** required to manually configure or paste `NEXT_PUBLIC_FIREBASE_*` environment variables into `.env`.
   - **Server-Side Admin Authentication:** Privileged server operations utilize the official deployment- and runtime-provided Google Cloud / Firebase credentials (Application Default Credentials / managed identity) provided by the Google Cloud environment. Developers are **NEVER** asked to paste a Firebase service-account private key or JSON into the repository.
   - **Zero Hardcoded Secrets:** No Firebase Admin private keys, service account JSON files, client secrets, or OAuth secrets may be hardcoded into application source files.

2. **Application-Level 3P Provider Secret Management:**
   - Secrets for external third-party integrations (`PAYSTACK_SECRET_KEY`, `VTPASS_SECRET_KEY`, `CLUBKONNECT_API_KEY`, `RESEND_API_KEY`, webhook secrets) are securely managed via server-side environment variables / Google Cloud Secret Manager.
   - These secrets are accessible **ONLY** to trusted server-side route handlers and are strictly excluded from client JavaScript bundles.

```text
┌────────────────────────────────────────────────────────────────────────┐
│               NATIVE GOOGLE AI STUDIO / FIREBASE PLATFORM              │
│  - Firebase Client Config (Auto-linked project configuration)          │
│  - Firebase Admin SDK Access (Runtime Application Default Credentials) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Direct Cloud Runtime Auth
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   3P APPLICATION SECRETS (Server Env / Secret Mgr)     │
│  - PAYSTACK_SECRET_KEY & PAYSTACK_WEBHOOK_SECRET                       │
│  - VTPASS_API_KEY & VTPASS_SECRET_KEY                                  │
│  - CLUBKONNECT_USER_ID & CLUBKONNECT_API_KEY                           │
│  - RESEND_API_KEY                                                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Injected into Server Environment at Runtime
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Next.js Server Runtime (Node.js)                     │
│  - Accessible ONLY to Server Handlers (process.env.*)                  │
│  - STRICTLY EXCLUDED from Client Bundles (Zero NEXT_PUBLIC_ prefix)    │
│  - ZERO storage in Firestore documents                                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 15. Personal Data Protection & Privacy (NDPR Compliance)

To comply with the Nigeria Data Protection Act (NDPA) and NDPR regulations:
1. **Data Minimization:** Only operational attributes essential for VAS fulfillment (recipient phone, meter number, smartcard number) are retained.
2. **PII Masking in Client Displays:** Customer transaction feeds mask sensitive middle digits of meter numbers and MSISDNs where appropriate.
3. **No Financial Instrument Storage:** Alexvya does not store raw credit/debit card PANs, PINs, or CVVs. All card processing is tokenized and offloaded to Paystack.
4. **Right to Account Erasure:** Upon account deletion requests, PII in `users/{userId}` is scrubbed/anonymized, while immutable financial ledger entries (`wallets/{userId}/ledger`) are preserved with anonymized identifiers to satisfy 7-year statutory financial audit requirements.

---

## 16. Security Incident Handling & Kill Switches

1. **Automated Account Freezing:** If an account triggers $> 5$ rapid financial validation errors or concurrent debit collisions, its `account_status` transitions automatically to `FROZEN`.
2. **Global Platform Maintenance Kill Switch:** `SUPER_ADMIN` can set `system_status.maintenance_mode = true` in Firestore, instantly causing all client write routes to return `503 Service Unavailable`.
3. **Compromised Secret Rotation Protocol:** If a provider key is compromised, administrators update the secret in Google Cloud Secret Manager and trigger an instant rolling restart on Firebase App Hosting without database downtime.

---

## 17. Firestore Architecture Impact Review

### 17.1 UNCHANGED Collections
- `wallets`, `wallets/{userId}/ledger`, `transactions`, `paymentAttempts`, `serviceOrders`, `airtimeOrders`, `dataOrders`, `billOrders`, `providers`, `providerTransactions`, `webhookEvents`, `notifications`, `auditLogs`, `idempotencyKeys`.

### 17.2 MODIFIED Collections (Field Additions for Security Enforcement)
- **`users/{userId}`**:
  - *Added:* `account_status` (`ACTIVE`, `SUSPENDED`, `FROZEN`, `CLOSED`).
  - *Added:* `email_verified` (`boolean`).
- **`adminUsers/{userId}`**:
  - *Added:* `is_active` (`boolean`), `role` (`ADMIN`, `SUPER_ADMIN`, `AUDITOR`), `assigned_by` (`string`).

### 17.3 NEW Collections
- **None.** The Stage 1.1 collection structure fully satisfies all security requirements.

---

**STAGE 1.3 COMPLETE — PROCEED ONLY TO STAGE 1.4 UPON EXPLICIT USER INSTRUCTION.**
