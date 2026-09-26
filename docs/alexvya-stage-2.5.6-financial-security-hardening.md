# Alexvya Platform — Stage 2.5.6 Financial Security & Abuse Protection

## 1. Architectural Overview & Security Invariants

Stage 2.5.6 introduces multi-layered defense-in-depth security hardening across the core financial mutation engine, identity and session verification, role-based authorization, high-value transaction approval gates, sliding-window rate limiting, immutable audit logging, API defense headers, error sanitization, and Firestore security rules.

```
                      [ Incoming HTTP Request ]
                                 │
                 ┌───────────────▼───────────────┐
                 │ 1. Defensive Headers & CORS   │ (applySecurityHeaders, applySafeCors)
                 │    - No-sniff, SAMEORIGIN     │
                 │    - Origin whitelist         │
                 │    - 100kb JSON body limit    │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ 2. Sliding-Window Rate Limiter│ (InMemoryRateLimiter / Redis-ready)
                 │    - Login: 5/5min            │
                 │    - Password Reset: 2/1hr    │
                 │    - Funding: 10/1hr          │
                 │    - VAS Purchase: 20/1min    │
                 │    - Utility Valid: 15/1min   │
                 │    - Admin Ops: 30/1min       │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ 3. Identity & Session Gate    │ (authenticateRequest)
                 │    - Firebase Token Verify    │
                 │    - 5-Min Reauth Window      │ (maxAuthAgeSeconds: 300)
                 │    - Account Status Check     │ (Blocks SUSPENDED/FROZEN/CLOSED)
                 │    - Database-Gated Admin Role│ (adminUsers/{uid} is_active: true)
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ 4. RBAC & Actor Permission    │ (assertFinancialMutationPermission)
                 │    - CUSTOMER: Personal VAS   │
                 │    - ADMIN: Ops + Adjustments │
                 │    - SUPER_ADMIN: Full Access │
                 │    - AUDITOR: Read-Only (0 mut)│
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ 5. Dual-Control / Two-Man Rule│ (validateTwoManApproval)
                 │    - Threshold: >= ₦10,000    │ (1,000,000 kobo)
                 │    - Distinct Active Admins   │
                 │    - Self-Approval Prohibited │
                 │    - Justification Required   │ (>= 10 characters)
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ 6. Core Financial Mutation    │ (creditWallet, debitWallet, refundWallet)
                 │    - Invariant: ledger = a + l│
                 │    - Version: v + 1 on change │
                 │    - Strict Idempotency Lock  │ (Isolated per UID)
                 │    - No Float Math / Safe Kobo│
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ 7. Audit & Response Sanitizer │ (recordAuditEvent, createErrorResponse)
                 │    - Sanitized Audit Log      │ (Scrub tokens, secrets, passwords)
                 │    - Non-leaking 500 Responses│ (Generic error in production)
                 └───────────────────────────────┘
```

---

## 2. Core Security Components

### 2.1 Role-Based Access Control Matrix (`src/server/auth/roles.ts`)

| Role | Financial Mutations | Personal VAS | Admin Refunds | System Settings | Provider Management | Audit Access |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **CUSTOMER** | Limited (Debit/Personal) | ✅ Yes | ❌ Blocked | ❌ Blocked | ❌ Blocked | Personal Statements Only |
| **ADMIN** | ✅ Conditional | ❌ Blocked | ✅ Dual-Control | ❌ Blocked | ✅ Yes | Full Access |
| **SUPER_ADMIN** | ✅ Full Privileges | ❌ Blocked | ✅ Dual-Control | ✅ Yes | ✅ Yes | Full Access |
| **AUDITOR** | ❌ Strictly Prohibited | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked | Read-Only Audit |
| **SYSTEM** | ✅ Service-to-Service | ❌ Blocked | ✅ Automated | ❌ Blocked | ✅ Automated | Automated Logging |

### 2.2 Reauthentication Window (5-Minute / 300s Policy)
High-risk financial operations (manual wallet adjustments, bank payouts, high-value refunds, privilege escalation) enforce `maxAuthAgeSeconds = 300`. If `token.auth_time` exceeds 300 seconds from server clock time, the request is rejected with `401 UNAUTHORIZED: Fresh authentication required`.

### 2.3 Account Status Restriction
Users whose database status is `SUSPENDED`, `FROZEN`, or `CLOSED` are blocked at the authentication gate with `403 ACCOUNT_SUSPENDED`.

### 2.4 Staff Privilege Escalation Protection
Token-claimed `role: ADMIN` or `SUPER_ADMIN` without a corresponding `is_active: true` document in `adminUsers/{uid}` is automatically downgraded to `CUSTOMER` or rejected with `403 FORBIDDEN` when administrative privileges are required.

### 2.5 Dual-Control Two-Man Rule (`src/server/security/twoManRule.ts`)
1. **Threshold:** Operations $\ge 1,000,000\text{ kobo}$ (₦10,000.00).
2. **Self-Approval Ban:** `initiatorAdminId !== approverAdminId`.
3. **Active Status Verification:** Both initiator and approver must exist and have `is_active === true` in `adminUsers`.
4. **Mandatory Justification:** Minimum 10 characters explaining the operational reason.

### 2.6 Sliding-Window Rate Limiting (`src/server/security/rateLimiter.ts`)
Implements sliding-window timestamps tracking in-memory (with Redis cluster support ready):
- **LOGIN:** 5 attempts per 5 minutes per IP.
- **PASSWORD_RESET:** 2 attempts per 1 hour per UID/email.
- **WALLET_FUNDING_INIT:** 10 attempts per 1 hour per UID.
- **VAS_PURCHASE:** 20 requests per 1 minute per UID.
- **UTILITY_VALIDATION:** 15 requests per 1 minute per UID.
- **ADMIN_OPERATIONS:** 30 requests per 1 minute per UID.

### 2.7 Mass-Assignment & Schema Hardening
- `updateProfileSchema` is marked `.strict()`. Any injection of `role`, `status`, `account_status`, `is_admin`, `is_active`, `available_balance_kobo`, or `version` causes immediate validation rejection.
- HTTP body size is constrained to a maximum of 100kb to mitigate DoS payload attacks.

### 2.8 Sensitive Data Sanitization & Audit Trails (`src/server/security/audit.ts`)
- `sanitizeAuditData` recursively scrubs `password`, `token`, `idToken`, `refreshToken`, `authorization`, `apiKey`, `secret`, `privateKey`, `paystack_secret_key`, `vtpass_secret_key`, `card_number`, `cvv`, and `pin`.
- Audit logs are written append-only to `auditLogs/{auditId}` with actor ID, role, action, resource target, correlation ID, before-state, and after-state diffs.

### 2.9 Error Response Sanitizer (`src/lib/api/response.ts`)
- In production (`NODE_ENV === 'production'`), unhandled internal errors return generic messages (`An unexpected internal error occurred.`) with `details: null` to prevent stack trace, SQL dialect, or file-system path leakage.

### 2.10 Defensive HTTP Headers & CORS (`src/server/security/headers.ts`)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 1; mode=block`
- `Cache-Control: no-store, no-cache, must-revalidate` on API endpoints
- CORS origin whitelist enforcement with no wildcard `*` for authenticated requests.

---

## 3. Verification Test Suite (`src/server/tests/financial-security.test.ts`)

The test suite validates 33 distinct security scenarios across 63 atomic assertions:
- **Scenario A:** Missing Authorization header (401 UNAUTHORIZED)
- **Scenario B:** Malformed Bearer token (401 UNAUTHORIZED)
- **Scenario C:** Invalid/forged ID token signature
- **Scenario D:** Expired / revoked token handling
- **Scenario E:** Fresh reauthentication window (5-minute auth_time requirement)
- **Scenario F:** Suspended / Frozen account access restriction
- **Scenario G:** Cross-user IDOR: Customer wallet isolation
- **Scenario H:** Cross-user IDOR: Customer ledger statement query isolation
- **Scenario I:** Cross-user IDOR: Single ledger record access isolation
- **Scenario J:** Idempotency key user isolation & replay protection
- **Scenario K:** Customer role cannot execute administrative refunds
- **Scenario L:** Auditor role strictly read-only (zero financial mutation privileges)
- **Scenario M:** Admin operation requires active admin document in adminUsers/{uid}
- **Scenario N:** Inactive / revoked admin staff blocked from admin operations
- **Scenario O:** Two-Man Rule: Self-approval strictly forbidden
- **Scenario P:** Two-Man Rule: Mandatory secondary approval for amounts >= ₦10,000 (1,000,000 kobo)
- **Scenario Q:** Two-Man Rule: Successful validation with two distinct active admins
- **Scenario R:** Mandatory justification requirement for privileged administrative actions
- **Scenario S:** Mass assignment protection: Role field injection blocked
- **Scenario T:** Mass assignment protection: Status / is_active / is_admin injection blocked
- **Scenario U:** Mass assignment protection: Balance & version field injection blocked
- **Scenario V:** Rate limiter: Login rate limiting (5 req / 5 min)
- **Scenario W:** Rate limiter: Password reset rate limiting (2 req / 1 hr)
- **Scenario X:** Rate limiter: Wallet funding initialization rate limiting (10 req / 1 hr)
- **Scenario Y:** Rate limiter: VAS purchase rate limiting (20 req / 1 min)
- **Scenario Z:** Rate limiter: Utility validation rate limiting (15 req / 1 min)
- **Scenario AA:** Rate limiter: Admin operations rate limiting (30 req / 1 min)
- **Scenario AB:** Rate limiter: Fail-safe behavior under error
- **Scenario AC:** Security audit logging & sensitive secret sanitization
- **Scenario AD:** Error response sanitizer: Non-leakage of stack traces or internal paths
- **Scenario AE:** Defensive HTTP security headers middleware
- **Scenario AF:** Origin-bounded CORS protection (no wildcard * for authenticated requests)
- **Scenario AG:** Firestore security rules client-write denial verification
