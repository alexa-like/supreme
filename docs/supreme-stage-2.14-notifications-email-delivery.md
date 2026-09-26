# Supreme Digital Network — Stage 2.14 Documentation
## Production Notifications, Email Delivery & Communication Infrastructure

### Overview
Stage 2.14 establishes a server-authoritative, idempotent, failure-isolated notification and transactional email architecture for Supreme Digital Network.

### Key Architectural Highlights
1. **Financial Failure Isolation**:
   - Notification delivery failures NEVER roll back wallet funding, VAS purchases, refunds, or KYC decisions.
   - Notifications execute after authoritative financial state commitments inside non-blocking try/catch blocks.

2. **Unified Notification Orchestration (`NotificationService`)**:
   - Manages both `IN_APP` and `EMAIL` communication channels.
   - Evaluates customer notification preferences (`email_on_wallet_credit`, `email_on_purchase`).
   - Security, KYC, and Account Status alerts bypass optional marketing preferences.

3. **Resend Email Integration & Resiliency**:
   - Resend adapter (`sendTransactionalEmail`) uses server-only `RESEND_API_KEY`.
   - Missing `RESEND_API_KEY` enters `SKIPPED` state safely without crashing startup or breaking financial flows.

4. **Persistent Delivery Log & Deduplication**:
   - Standardized deduplication keys (`demp_{eventType}_{userId}_{sourceId}_{channel}`) prevent double emails on duplicate webhooks or requeries.
   - Persistent delivery logs record channel, status (`QUEUED`, `SENT`, `FAILED`, `SKIPPED`), provider message ID, attempt count, and correlation ID.

5. **Background Retry Worker**:
   - `WorkersService.runNotificationDeliveryWorker()` processes transient email failures with exponential backoff (up to 5 attempts).
   - Retry cycles strictly process notification delivery logs and NEVER re-execute financial mutations.

6. **Admin Control & Oversight**:
   - Admin Operations Console displays communication delivery logs (`GET /api/v1/admin/notifications/deliveries`).
   - `AUDITOR` role remains read-only.
