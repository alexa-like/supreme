# Alexvya — Stage 2.1: Project Implementation Audit & Environment Foundation

**Document Version:** 1.0.0  
**Status:** COMPLETE (STAGE 2.1 — PASS)  
**Project:** Alexvya Digital Services Platform  
**Target Architecture:** Next.js (App Router) / TypeScript / Tailwind CSS / Firebase Authentication / Cloud Firestore / Firebase Admin SDK / Paystack / VTpass / ClubKonnect / Resend  
**Current Stage:** Stage 2.1 (Project Implementation Audit & Environment Foundation)  
**Preceding Stages (All Locked):**  
- `docs/alexvya-stage-0-project-foundation.md`  
- `docs/alexvya-stage-1-product-blueprint.md`  
- `docs/alexvya-stage-1.1-firestore-database-architecture.md`  
- `docs/alexvya-stage-1.2-provider-pricing-architecture.md`  
- `docs/alexvya-stage-1.3-firebase-security-architecture.md`  
- `docs/alexvya-stage-1.4-api-specification.md`  
- `docs/alexvya-stage-1.5-transaction-state-machines.md`

---

## 1. Executive Summary

Stage 2.1 establishes the implementation baseline and code foundation for the Alexvya platform prior to developing core business features in Stage 2.2+. 

During this stage:
1. The existing codebase was comprehensively audited for runtime compatibility, framework configurations, and legacy database remnants.
2. An isolated client Firebase SDK singleton (`src/lib/firebase/client.ts`) was initialized using public configuration parameters exclusively.
3. A strictly server-only Firebase Admin SDK foundation (`src/server/firebase/admin.ts`) was established with runtime boundary guards that prevent browser execution.
4. Structured API foundation utilities were created: typed API response formatters (`src/lib/api/response.ts`), correlation ID generation (`src/lib/api/correlation.ts`), the Alexvya error taxonomy (`src/lib/api/errors.ts`), structured JSON logging (`src/lib/logger/logger.ts`), and server auth verification (`src/server/auth/session.ts`).
5. Common Zod validation primitives (`src/lib/validation/common.ts`) were established for integer kobo financial bounds, Nigerian MSISDNs, UUIDv4 idempotency keys, meter numbers, smartcard numbers, and provider codes.
6. Zero business logic, wallet mutations, payment gateway integrations, or provider dispatch workflows were implemented in this stage, strictly preserving stage scope.

---

## 2. Existing Project Structure

```text
/
├── .env.example                                # Environment variable documentation template
├── .gitignore                                  # Git exclusion rules (secrets, build artifacts)
├── metadata.json                               # Applet metadata and server capabilities
├── package.json                                # Project dependencies and scripts
├── tsconfig.json                               # Strict TypeScript compiler options
├── vite.config.ts                              # Vite build tool and Tailwind CSS plugin configuration
├── index.html                                  # Single-page HTML entry point
├── docs/                                       # Locked architectural specifications
│   ├── alexvya-stage-0-project-foundation.md
│   ├── alexvya-stage-1-product-blueprint.md
│   ├── alexvya-stage-1.1-firestore-database-architecture.md
│   ├── alexvya-stage-1.2-provider-pricing-architecture.md
│   ├── alexvya-stage-1.3-firebase-security-architecture.md
│   ├── alexvya-stage-1.4-api-specification.md
│   ├── alexvya-stage-1.5-transaction-state-machines.md
│   └── alexvya-stage-2.1-project-implementation-audit.md
├── public/                                     # Static public assets
│   └── assets/aistudio/
└── src/                                        # Application source directory
    ├── index.css                               # Global Tailwind CSS v4 styles
    ├── main.tsx                                # React 19 application entry point
    ├── App.tsx                                 # Foundation overview dashboard
    ├── types/
    │   └── api.ts                              # API response & user context interfaces
    ├── lib/
    │   ├── firebase/
    │   │   ├── config.ts                       # Public client configuration loader
    │   │   └── client.ts                       # Firebase Client SDK singleton (Auth, Firestore)
    │   ├── api/
    │   │   ├── correlation.ts                  # Request correlation ID generator
    │   │   ├── errors.ts                       # Alexvya error taxonomy & AlexvyaApiError class
    │   │   └── response.ts                     # Standardized API response formatters
    │   ├── logger/
    │   │   └── logger.ts                       # Server-safe structured JSON logger
    │   └── validation/
    │       └── common.ts                       # Common Zod validation schemas
    └── server/
        ├── firebase/
        │   └── admin.ts                        # Server-only Firebase Admin SDK (Auth, Firestore)
        └── auth/
            └── session.ts                      # Server-side Firebase ID token verifier
```

---

## 3. Framework & Runtime Configuration

- **Framework / Runtime:** React 19 / Vite 6 (SPA with full-stack Node.js / Express capabilities via `@types/express`, `tsx`, and server routes).
- **TypeScript:** Strict compilation (`target: "ES2022"`, `moduleResolution: "bundler"`, `isolatedModules: true`, path alias `@/*` mapped to `./src/*`).
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite` and `@import "tailwindcss";` in `src/index.css`.
- **Package Manager:** npm / bun package lock.

---

## 4. Firebase Client Architecture

The browser Firebase Client SDK is initialized via `src/lib/firebase/client.ts`.

### 4.1 Client Invariants
- **Public Values Only:** Uses configuration loaded from `src/lib/firebase/config.ts` (API Key, Auth Domain, Project ID, Storage Bucket, Messaging Sender ID, App ID).
- **Zero Secrets:** Contains no service account credentials, private keys, or third-party provider secrets.
- **Singleton Guard:** Uses `getApps().length === 0 ? initializeApp(...) : getApp()` to prevent duplicate initialization during client rendering and hot reloads.
- **Exposed Services:** Exports browser-safe `app` (FirebaseApp), `auth` (Auth), and `db` (Firestore).

---

## 5. Firebase Admin Architecture

The server Firebase Admin SDK is initialized via `src/server/firebase/admin.ts`.

### 5.1 Admin Invariants
- **Server Execution Guard:** Includes `assertServerEnvironment()` which throws a critical error if `window` is defined.
- **Dual Credential Mode:**
  1. *Managed Cloud Runtime (ADC):* Automatically initializes using Application Default Credentials (ADC) in Google Cloud / Firebase App Hosting environments.
  2. *Explicit Service Account:* Supports `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` for development/staging environments when ADC is not available.
- **Singleton Guard:** Ensures only a single Firebase Admin instance exists across server lifecycles.
- **Exposed Services:** Exports lazy accessors `getAdminAuth()` and `getAdminDb()`.

---

## 6. Environment Variable Architecture

### 6.1 Public Client Variables (`NEXT_PUBLIC_*` / `VITE_*`)
These variables are exposed to the browser and MUST NOT contain secrets:
- `NEXT_PUBLIC_APP_ENV`: Application environment (`development` | `staging` | `production`).
- `NEXT_PUBLIC_APP_URL`: Base URL of the web application.
- `NEXT_PUBLIC_FIREBASE_API_KEY`: Firebase Web API key.
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`: Firebase Auth domain.
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: Firebase project identifier.
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`: Firebase storage bucket.
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`: Firebase messaging sender ID.
- `NEXT_PUBLIC_FIREBASE_APP_ID`: Firebase application ID.
- `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`: Paystack client key for inline checkout popup.

### 6.2 Server-Only Variables (Secret Management)
These variables are accessible **ONLY** to server-side code and are strictly excluded from client builds:
- `FIREBASE_PROJECT_ID`: Google Cloud project ID for Admin SDK.
- `FIREBASE_CLIENT_EMAIL`: Service account email.
- `FIREBASE_PRIVATE_KEY`: Service account RSA private key.
- `PAYSTACK_SECRET_KEY`: Paystack secret authorization key.
- `PAYSTACK_WEBHOOK_SECRET`: Secret key for HMAC-SHA512 webhook signature verification.
- `VTPASS_API_KEY`: VTpass merchant API key.
- `VTPASS_SECRET_KEY`: VTpass merchant secret key.
- `VTPASS_PUBLIC_KEY`: VTpass public identifier.
- `CLUBKONNECT_USER_ID`: ClubKonnect customer ID.
- `CLUBKONNECT_API_KEY`: ClubKonnect API secret key.
- `RESEND_API_KEY`: Resend transactional email API key.
- `SYSTEM_EMAIL_SENDER`: Default system sender (`Alexvya <noreply@alexvya.com>`).

---

## 7. Next.js / Server-Client Boundary

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   BROWSER CLIENT (Untrusted Context)                   │
│  - React 19 UI Components                                              │
│  - Firebase Client SDK (Auth state, read-only UI streams)              │
│  - Zero financial logic, zero secrets, zero direct writes to wallets   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS Bearer Token / API Requests
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              SERVER API LAYER (/api/v1/* Route Handlers)               │
│  - authenticateRequest (Token verification via Firebase Admin)         │
│  - Zod Input Validation                                                │
│  - Structured JSON Logging with Correlation IDs                        │
│  - Standardized JSON Responses (createSuccessResponse / AlexvyaError)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Authorized Server Execution
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               AUTHORITATIVE BACKEND & PROVIDER ADAPTERS                │
│  - Firebase Admin SDK (Firestore atomic transactions)                  │
│  - Paystack REST API & HMAC Webhook Verifier                           │
│  - VTpass & ClubKonnect Aggregators                                    │
│  - Resend Email Dispatcher                                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 8. API & Validation Foundation

### 8.1 Standardized API Utilities
- **Correlation IDs:** Generated via `generateCorrelationId()` (`req_timestamp_random`).
- **Standardized Success Responses:** Format conforming to Stage 1.4:
  `{ success: true, data: T, meta: { correlation_id, timestamp } }`.
- **Standardized Error Responses:** Handled via `createErrorResponse()` and `AlexvyaApiError` taxonomy.
- **Structured Logging:** `logger.info()`, `logger.warn()`, `logger.error()` producing structured JSON output.

### 8.2 Validation Foundation (Zod)
- `koboAmountSchema`: Validates integer amounts in kobo within strict min/max constraints.
- `nigerianMsisdnSchema`: Strict regex validation for Nigerian mobile phone numbers (`+234...` / `070...` / `080...` / `090...` / `081...` / `091...`).
- `idempotencyKeySchema`: Strict UUIDv4 validation for mutation request deduplication headers.
- `meterNumberSchema`, `meterTypeSchema`, `smartcardNumberSchema`, `discoCodeSchema`, `cableTvProviderSchema`: Strict schemas for VAS service parameters.

---

## 9. Security Foundation Audit

| Security Domain | Verification Status | Details |
|---|:---:|---|
| **Secret Isolation** | ✅ VERIFIED | Zero secrets in `.env.example`, `index.html`, or client bundles. |
| **Admin SDK Isolation** | ✅ VERIFIED | `src/server/firebase/admin.ts` guarded against browser invocation. |
| **Client Firebase Safety** | ✅ VERIFIED | Client config contains only public Firebase identifiers. |
| **Git Protection** | ✅ VERIFIED | `.gitignore` excludes `.env*`, `*.pem`, `*.key`, and `service-account*.json`. |
| **Financial Arithmetic** | ✅ VERIFIED | Integer kobo primitives established; no float currency types. |

---

## 10. Legacy Architecture Audit Findings

- **Supabase / PostgreSQL / Prisma / Neon:** Complete codebase scan confirmed **ZERO** legacy SQL/PostgreSQL or Supabase dependencies, tables, or client files exist.
- **Terminology Alignment:** Outdated references to "double-entry ledger" in `src/App.tsx` were updated to *"Immutable Single-Account Wallet Balance Journal with Running Balance Snapshots"*.

---

## 11. Changes Made in Stage 2.1

1. Installed required baseline packages: `firebase` (Client SDK), `firebase-admin` (Server Admin SDK), `zod` (Validation library).
2. Created `src/types/api.ts` defining standard API envelope interfaces and user contexts.
3. Created `src/lib/firebase/config.ts` and `src/lib/firebase/client.ts` implementing a browser-safe singleton Firebase Client module.
4. Created `src/server/firebase/admin.ts` implementing a server-only Firebase Admin SDK module supporting both ADC and service account credentials.
5. Created `src/lib/api/correlation.ts`, `src/lib/api/errors.ts`, `src/lib/api/response.ts` establishing the Stage 1.4 API foundation.
6. Created `src/lib/logger/logger.ts` implementing structured JSON logging.
7. Created `src/lib/validation/common.ts` implementing common Zod validation schemas.
8. Created `src/server/auth/session.ts` implementing server-side ID token verification.
9. Updated `src/App.tsx` stage markers and UI descriptions.

---

## 12. Remaining Configuration Requirements & Firestore Region

- **Firestore Region:** Explicitly recorded as: *"Firestore region remains an explicit deployment decision and is not being changed during Stage 2.1."*
- **Provider API Keys:** Paystack, VTpass, ClubKonnect, and Resend live credentials will be supplied in their respective dedicated integration stages.

---

## 13. Stage 2.1 Acceptance Checklist

- [x] Full audit of runtime framework and directory structure completed.
- [x] Confirmed zero remnants of Supabase, PostgreSQL, Prisma, or Neon.
- [x] Browser-safe Firebase Client SDK initialized with public values only.
- [x] Server-only Firebase Admin SDK initialized with environment guards.
- [x] Environment variable template audited and separated into public vs. secret.
- [x] Server/client boundary architectural model established.
- [x] API foundation created (correlation IDs, error taxonomy, standardized envelopes).
- [x] Validation foundation created with Zod primitives.
- [x] Security controls verified (no hardcoded secrets, `.gitignore` validated).
- [x] Zero business logic, wallet mutations, or provider integrations implemented (strict scope control).
- [x] Project builds and compiles with zero TypeScript or bundling errors.

---

## 14. Explicit Stage Status

**STAGE 2.1 — PASS**
