# Alexvya — Stage 2.2: Firebase Client & Admin Architecture Specification

**Document Version:** 1.0.0  
**Status:** COMPLETE (STAGE 2.2 — PASS)  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** React 19 / Vite 8 / Express Full-Stack / TypeScript / Firebase Authentication / Cloud Firestore / Firebase Admin SDK  
**Current Stage:** Stage 2.2 (Firebase Client & Admin Architecture)  
**Preceding Stages (All Locked):**  
- `docs/alexvya-stage-0-project-foundation.md`  
- `docs/alexvya-stage-1-product-blueprint.md`  
- `docs/alexvya-stage-1.1-firestore-database-architecture.md`  
- `docs/alexvya-stage-1.2-provider-pricing-architecture.md`  
- `docs/alexvya-stage-1.3-firebase-security-architecture.md`  
- `docs/alexvya-stage-1.4-api-specification.md`  
- `docs/alexvya-stage-1.5-transaction-state-machines.md`  
- `docs/alexvya-stage-2.1-project-implementation-audit.md`

---

## 1. Current Framework & Server Runtime Architecture

- **Client Runtime:** React 19 SPA running on Vite 8 with TypeScript and Tailwind CSS v4.
- **Server Runtime:** Node.js with Express (`server.ts` mounting Vite middleware in development and serving static assets in production). Exposes server-authoritative API route handlers under `/api/v1/*`.
- **Architectural Boundary Mapping:**
  - Client components communicate with server endpoints via `fetch('/api/v1/*')` carrying `Authorization: Bearer <idToken>`.
  - The browser context has zero access to Firebase Admin credentials, private keys, or third-party provider secrets.
  - Server endpoints authenticate requests via the Firebase Admin SDK and execute privileged database and provider operations.

---

## 2. Firebase Client Architecture (`src/lib/firebase/`)

### 2.1 Singleton Safety & Lifecycle
- **Module:** `src/lib/firebase/client.ts`
- **Mechanism:** Initializes the Firebase Client SDK using `getApps().length === 0 ? initializeApp(config) : getApp()`.
- **Stability:** Prevents duplicate app initialization during development hot module reloads and concurrent client component mounts.

### 2.2 Configuration Invariants
- **Loader:** `src/lib/firebase/config.ts`
- **Validation:** Uses Zod (`FirebaseClientConfigSchema`) to validate required keys (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).
- **Environment Mapping:** Supports both `VITE_FIREBASE_*` and `NEXT_PUBLIC_FIREBASE_*` seamlessly.
- **Security Rule:** Contains zero private keys or server-side credentials.

---

## 3. Firebase Authentication Foundation (`src/lib/firebase/auth.ts`)

Provides clean, reusable authentication service methods with normalized error handling:
1. `signInWithGoogle()`: Popup-based Google Sign-In with account selection prompt.
2. `signInWithEmail(email, password)`: Email/password authentication.
3. `signUpWithEmail(email, password)`: User registration with automatic email verification trigger.
4. `resendVerificationEmail(user)`: Dispatches email verification message to the current user.
5. `sendPasswordReset(email)`: Triggers Firebase password reset workflow.
6. `signOutUser()`: Revokes local client session.
7. `getAuthBearerToken(forceRefresh)`: Retrieves current Firebase ID token for authenticating backend API requests.
8. `subscribeToAuthState(observer)`: Real-time listener for client auth state changes.

---

## 4. Firestore Client Foundation (`src/lib/firebase/firestore.ts`)

### 4.1 Strict Client Boundary Invariants
1. **Read-Only Scope:** Client Firestore queries are strictly limited to reading public catalogs (`serviceProducts`) and authenticated user profiles (`users/{uid}`).
2. **Prohibited Client Operations:**
   - Client-side wallet modifications (`wallets/{uid}`) are strictly prohibited.
   - Client-side ledger writes (`wallets/{uid}/ledger`) are strictly prohibited.
   - Client-side transaction writes (`transactions/{id}`) are strictly prohibited.
   - Direct third-party provider calls from the browser are strictly prohibited.

---

## 5. Firebase Admin SDK Architecture (`src/server/firebase/`)

### 5.1 Singleton Admin Module (`src/server/firebase/admin.ts`)
- **Runtime Guard:** Executes `assertServerEnvironment()` to abort immediately if imported or invoked within a browser context (`typeof window !== 'undefined'`).
- **Singleton Initialization:** Reuses existing Admin app (`getApps().length === 0 ? initializeApp(...) : getApp()`).
- **Dual Credential Mode:**
  1. *Managed Cloud Runtime (ADC):* Uses Google Cloud Application Default Credentials automatically in Cloud Run, Google App Engine, and Firebase App Hosting environments.
  2. *Explicit Service Account:* Reads `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` for isolated local development.
- **Exposed Services:** `getAdminAuth()` and `getAdminDb()`.

### 5.2 Server Configuration Validator (`src/server/firebase/config.ts`)
- Validates that required environment variables are present.
- **Sanitized Diagnostics:** Reports configuration status without logging private keys or credentials.

---

## 6. Environment Variable Architecture

| Variable Name | Context | Exposure | Purpose |
|---|---|:---:|---|
| `VITE_APP_ENV` / `NEXT_PUBLIC_APP_ENV` | Client / Server | Public | Environment indicator (`development` / `production`) |
| `VITE_APP_URL` / `NEXT_PUBLIC_APP_URL` | Client / Server | Public | Canonical web base URL |
| `VITE_FIREBASE_API_KEY` / `NEXT_PUBLIC_FIREBASE_API_KEY` | Client | Public | Firebase Web API Key |
| `VITE_FIREBASE_AUTH_DOMAIN` / `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Client | Public | Firebase Auth Domain |
| `VITE_FIREBASE_PROJECT_ID` / `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Client | Public | Firebase Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` / `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Client | Public | Firebase Storage Bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` / `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Client | Public | Firebase Cloud Messaging Sender ID |
| `VITE_FIREBASE_APP_ID` / `NEXT_PUBLIC_FIREBASE_APP_ID` | Client | Public | Firebase Web App ID |
| `VITE_PAYSTACK_PUBLIC_KEY` / `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Client | Public | Paystack Popup Checkout Key |
| `FIREBASE_PROJECT_ID` | Server | **SECRET** | Google Cloud Project ID |
| `FIREBASE_CLIENT_EMAIL` | Server | **SECRET** | Service Account Email |
| `FIREBASE_PRIVATE_KEY` | Server | **SECRET** | Service Account RSA Private Key |
| `PAYSTACK_SECRET_KEY` | Server | **SECRET** | Paystack Secret API Key |
| `PAYSTACK_WEBHOOK_SECRET` | Server | **SECRET** | HMAC-SHA512 Webhook Verification Secret |
| `VTPASS_API_KEY` & `VTPASS_SECRET_KEY` | Server | **SECRET** | VTpass Aggregator Credentials |
| `CLUBKONNECT_USER_ID` & `CLUBKONNECT_API_KEY` | Server | **SECRET** | ClubKonnect Aggregator Credentials |
| `RESEND_API_KEY` | Server | **SECRET** | Transactional Email API Key |

---

## 7. Server Auth Verification Layer (`src/server/auth/session.ts`)

```text
Incoming HTTP Request (Authorization: Bearer <Firebase_ID_Token>)
       │
       ▼
 1. Extract Bearer Token from Header
    ├── Missing / Malformed ➔ Reject 401 UNAUTHORIZED
    └── Present ➔ Continue
       │
       ▼
 2. Verify Token via Firebase Admin Auth (verifyIdToken(idToken, checkRevoked: true))
    ├── Token Expired / Invalid / Revoked ➔ Reject 401 UNAUTHORIZED
    └── Token Valid ➔ Extract Authoritative Claims:
          - uid: decodedToken.uid (AUTHORITATIVE)
          - email: decodedToken.email
          - emailVerified: decodedToken.email_verified
          - role: decodedToken.role || 'USER'
       │
       ▼
 3. Validate Verification & Role Constraints (if required)
    ├── requireEmailVerified == true AND emailVerified == false ➔ Reject 403 EMAIL_NOT_VERIFIED
    ├── requiredRole specified AND role != requiredRole ➔ Reject 403 FORBIDDEN
    └── Constraints Met ➔ Return AuthenticatedUserContext to Route Handler
```

---

## 8. Error Normalization & Security Controls

### 8.1 Client-Side Error Normalization (`src/lib/firebase/errors.ts`)
Maps raw Firebase Auth error codes (e.g. `auth/invalid-credential`, `auth/email-already-in-use`, `auth/too-many-requests`) to user-friendly messages without exposing technical stack traces.

### 8.2 Server-Side Error Normalization (`src/server/firebase/errors.ts`)
Translates Firebase Admin exceptions into standardized `AlexvyaApiError` instances with appropriate HTTP status codes (401, 403, 500) and attached correlation IDs.

---

## 9. Correlation IDs & Observability

- Correlation IDs are generated for each incoming HTTP request (`generateCorrelationId()`) and returned in the `x-correlation-id` response header.
- The correlation ID is passed through structured log entries (`src/lib/logger/logger.ts`) and embedded in API response metadata (`meta.correlation_id`).

---

## 10. Verification & Build Results

- **TypeScript Typecheck (`npm run lint`):** `tsc --noEmit` **PASSED** with 0 errors.
- **Applet Compilation (`compile_applet`):** **BUILD SUCCEEDED**.

---

## 11. Stage 2.2 Acceptance Checklist

- [x] Documented actual React 19 / Vite 8 / Express full-stack architecture.
- [x] Implemented singleton Firebase Client SDK initializer with public configuration only.
- [x] Implemented reusable Firebase Auth service (Google, Email/Password, Password Reset, Auth listener).
- [x] Implemented read-only client Firestore service with zero balance/financial write capabilities.
- [x] Implemented server-only Firebase Admin SDK singleton supporting ADC and Service Account modes.
- [x] Implemented server auth verification layer (`authenticateRequest`) enforcing authoritative token claims.
- [x] Centralized configuration validation for client and server without secret leakage.
- [x] Created normalized client and server error handling utilities.
- [x] Integrated request correlation IDs with structured logging.
- [x] Full-stack Express server (`server.ts`) created with health and auth verification test routes.
- [x] Zero financial mutations, wallet writes, or provider integrations implemented (strict scope control).

---

## 12. Final Status

# STAGE 2.2 — PASS
