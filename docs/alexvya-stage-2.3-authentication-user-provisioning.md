# Alexvya — Stage 2.3: Authentication & User Provisioning Specification

**Document Version:** 1.0.0  
**Status:** COMPLETE (STAGE 2.3 — PASS)  
**Project:** Alexvya Digital Services Platform  
**Target Infrastructure:** React 19 / Vite 8 / Express Full-Stack / TypeScript / Firebase Authentication / Cloud Firestore / Firebase Admin SDK  
**Current Stage:** Stage 2.3 (Authentication & User Provisioning)  
**Preceding Stages (All Locked):**  
- `docs/alexvya-stage-0-project-foundation.md`  
- `docs/alexvya-stage-1-product-blueprint.md`  
- `docs/alexvya-stage-1.1-firestore-database-architecture.md`  
- `docs/alexvya-stage-1.2-provider-pricing-architecture.md`  
- `docs/alexvya-stage-1.3-firebase-security-architecture.md`  
- `docs/alexvya-stage-1.4-api-specification.md`  
- `docs/alexvya-stage-1.5-transaction-state-machines.md`  
- `docs/alexvya-stage-2.1-project-implementation-audit.md`  
- `docs/alexvya-stage-2.2-firebase-client-admin-architecture.md`

---

## 1. Authentication Architecture

The Alexvya authentication architecture separates client-side credential negotiation from authoritative server-side user provisioning and profile management:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   BROWSER / CLIENT (Untrusted Context)                 │
│  - Firebase Auth Client SDK (`signInWithEmail`, `signInWithGoogle`)    │
│  - Acquire Firebase ID Token (`getIdToken()`)                          │
│  - React AuthProvider (`src/lib/auth/AuthContext.tsx`)                 │
│  - ZERO direct Firestore write permissions for user state or profile   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (Authorization: Bearer <ID_Token>)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              SERVER LAYER (/api/v1/* Express API Routes)               │
│  - `authenticateRequest()`: Verifies Firebase ID token with Admin SDK   │
│  - `provisionOrSyncUser()`: Authoritative user provisioning & sync     │
│  - `enforceAccountStatus()`: ACTIVE / SUSPENDED / FROZEN / CLOSED      │
│  - `updateExistingUserProfile()`: Strict whitelist profile patch       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Server-Side Admin Privileges
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       CLOUD FIRESTORE (Database)                       │
│  - Collection: `users/{uid}` (Document ID == Firebase Auth UID)        │
│  - Owner-readable, Server-writable                                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Authentication Flows Implemented

### 2.1 Email & Password Registration (`signUpWithEmail`)
1. User provides email and password.
2. Firebase Auth creates the credential record.
3. Automatic verification email is dispatched to the user (`sendEmailVerification`).
4. Client acquires Firebase ID token and requests `/api/v1/user/profile`.
5. Server verifies token, extracts UID, and creates initial `users/{uid}` with default `account_status: 'ACTIVE'`, `role: 'USER'`, `tier: 'TIER_1'`, `email_verified: false`.

### 2.2 Email & Password Sign-In (`signInWithEmail`)
1. User provides email and password.
2. Firebase Auth authenticates credentials.
3. Client acquires ID token and contacts `/api/v1/user/profile`.
4. Server verifies token and synchronizes `last_login_at` and `email_verified` status.
5. Server verifies account status is `ACTIVE` before returning profile.

### 2.3 Google Sign-In (`signInWithGoogle`)
1. User signs in via Google OAuth popup.
2. Firebase Auth authenticates identity and automatically marks email as verified (`email_verified: true`).
3. Client contacts `/api/v1/user/profile`.
4. Server creates or syncs `users/{uid}` with `email_verified: true` and `auth_provider: 'google.com'`.

### 2.4 Password Reset (`sendPasswordReset`)
1. User supplies email.
2. Firebase Auth dispatches password recovery email.
3. User receives a generic confirmation to prevent account enumeration.

### 2.5 Email Verification Resend (`resendVerificationEmail`)
1. Authenticated user with unverified email clicks "Resend Verification Email".
2. Verification message is dispatched by Firebase Auth.

### 2.6 Sign Out (`signOutUser`)
1. Local client session is cleared and tokens wiped from memory.

---

## 3. Firestore `users/{uid}` Document Schema

All user records strictly conform to the locked Stage 1.1 specification:

| Field Name | Type | Invariant / Rule |
|---|---|---|
| `uid` | string | Document ID matching Firebase Auth UID (immutable) |
| `email` | string | Normalized user email address |
| `phone_number` | string \| null | Nigerian MSISDN (+234...) |
| `first_name` | string | User first name |
| `last_name` | string | User last name |
| `display_name` | string \| null | Public display name |
| `photo_url` | string \| null | Profile avatar URL |
| `account_status` | string | `'ACTIVE'` \| `'SUSPENDED'` \| `'FROZEN'` \| `'CLOSED'` (Server-only) |
| `role` | string | `'USER'` \| `'ADMIN'` \| `'SUPER_ADMIN'` \| `'SUPPORT'` (Server-only) |
| `tier` | string | `'TIER_1'` \| `'TIER_2'` \| `'TIER_3'` (Server-only) |
| `email_verified` | boolean | Synchronized with Firebase Auth |
| `phone_verified` | boolean | SMS OTP verification state |
| `two_factor_enabled` | boolean | Mandatory for admin roles |
| `auth_provider` | string | Identity provider tag (`password`, `google.com`) |
| `created_at` | string (ISO) | Initial account timestamp |
| `updated_at` | string (ISO) | Last modification timestamp |
| `last_login_at` | string (ISO) | Last successful authentication timestamp |

---

## 4. Account Status Enforcement

The server authorization layer enforces account state on all requests:

- **`ACTIVE`:** Normal authenticated access.
- **`SUSPENDED`:** Rejects request immediately with HTTP 403 `ACCOUNT_SUSPENDED`.
- **`FROZEN`:** Rejects request immediately with HTTP 403 `FORBIDDEN` (Account frozen under security review).
- **`CLOSED`:** Rejects request immediately with HTTP 403 `FORBIDDEN` (Account closed).

Clients cannot alter `account_status`.

---

## 5. User Profile API Endpoints

### 5.1 `GET /api/v1/user/profile`
- **Authentication:** `Authorization: Bearer <Firebase_ID_Token>`
- **Logic:** Decodes token via Firebase Admin Auth, calls `provisionOrSyncUser()`, enforces account status, and returns sanitized `SafeUserProfile` (excluding internal metadata).
- **Response:**
  ```json
  {
    "success": true,
    "data": {
      "uid": "user_firebase_uid",
      "email": "user@example.com",
      "first_name": "First",
      "last_name": "Last",
      "display_name": "First Last",
      "phone_number": null,
      "photo_url": null,
      "account_status": "ACTIVE",
      "role": "USER",
      "tier": "TIER_1",
      "email_verified": true,
      "phone_verified": false,
      "two_factor_enabled": false,
      "auth_provider": "google.com",
      "created_at": "2026-09-23T19:50:00.000Z",
      "updated_at": "2026-09-23T19:50:00.000Z",
      "last_login_at": "2026-09-23T19:50:00.000Z"
    },
    "meta": {
      "correlation_id": "req_...",
      "timestamp": "2026-09-23T19:50:00.000Z"
    }
  }
  ```

### 5.2 `PATCH /api/v1/user/profile`
- **Authentication:** `Authorization: Bearer <Firebase_ID_Token>`
- **Validation:** Strict Zod schema (`updateProfileSchema`). Permits **ONLY**: `first_name`, `last_name`, `display_name`, `phone_number`.
- **Protected Fields:** Any payload containing `uid`, `account_status`, `role`, `tier`, `wallet`, `balance`, `ledger`, `email_verified`, `created_at`, etc. is rejected with HTTP 422 `INVALID_INPUT`.

---

## 6. Security Boundaries & Invariants

1. **Zero Client Trust:** Identity is proven strictly by cryptographic Firebase ID token verification on the server.
2. **UID Immutability:** `req.body.uid` and `req.query.uid` are completely ignored; the decoded token UID is authoritative.
3. **No Password Storage in Database:** Firebase Authentication handles password hashing; no passwords exist in Firestore.
4. **No Sensitive Information Logging:** Passwords, tokens, and private keys are never logged.

---

## 7. Automated Test Suite Results

Automated tests executed via `npx tsx src/server/tests/auth-provisioning.test.ts`:

| Test Case | Description | Result |
|---|---|:---:|
| **Test 1.1–1.6** | New Email User Provisioning (Doc ID, defaults, verification state) | ✅ PASS |
| **Test 2.1–2.3** | Idempotent Re-provisioning & Identity Synchronization | ✅ PASS |
| **Test 3.1–3.2** | Google User Provisioning (Verified email mapping) | ✅ PASS |
| **Test 4** | Account Status Enforcement — SUSPENDED (403 `ACCOUNT_SUSPENDED`) | ✅ PASS |
| **Test 5.1** | Account Status Enforcement — FROZEN (403 `FORBIDDEN`) | ✅ PASS |
| **Test 5.2** | Account Status Enforcement — CLOSED (403 `FORBIDDEN`) | ✅ PASS |
| **Test 6.1–6.4** | Profile Update with Allowed Fields (`first_name`, `last_name`, `phone_number`) | ✅ PASS |
| **Test 7** | Profile Update Rejecting Protected Fields (`role`, `tier`, `wallet`, `status`) | ✅ PASS |

**Total Tests:** 19 Passed, 0 Failed.

---

## 8. Build & Typecheck Verification

- **TypeScript Typecheck (`npm run lint`):** `tsc --noEmit` **PASSED** (0 errors).
- **Applet Compilation (`compile_applet`):** **BUILD SUCCEEDED**.

---

## 9. Stage 2.3 Acceptance Checklist

- [x] Firestore `users/{uid}` collection mapping implemented according to locked Stage 1.1 schema.
- [x] Server-authoritative user provisioning created (`src/server/users/provisioning.ts`).
- [x] Idempotency verified: repeated sign-ins do not create duplicate users or overwrite protected fields.
- [x] Account status enforcement verified (`ACTIVE`, `SUSPENDED`, `FROZEN`, `CLOSED`).
- [x] Email verification flow integrated.
- [x] Email/password signup, sign-in, and Google sign-in services implemented.
- [x] Password reset with account enumeration protections implemented.
- [x] Sign-out and session restoration handlers implemented.
- [x] React AuthProvider and useAuth hook created (`src/lib/auth/AuthContext.tsx`).
- [x] `GET /api/v1/user/profile` and `PATCH /api/v1/user/profile` route handlers implemented in Express.
- [x] Strict Zod profile update validation rejecting protected field tampering implemented.
- [x] Interactive UI authentication modal (`src/components/auth/AuthModal.tsx`) and Identity dashboard integrated into `src/App.tsx`.
- [x] Zero financial operations, wallet mutations, or provider calls implemented.

---

## 10. Final Status

# STAGE 2.3 — PASS
