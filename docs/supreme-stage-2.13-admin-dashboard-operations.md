# Supreme Digital Network — Stage 2.13 Admin Dashboard & Operations Console

## Overview
Stage 2.13 delivers the production-grade administrative operations interface for Supreme Digital Network, built entirely on top of the locked server-authoritative backend architecture.

## Architecture & Security Boundaries
1. **Server-Authoritative Enforcement**: Frontend admin tabs and views are strictly presentation layers. Every administrative action must pass through secured `/api/v1/admin/*` endpoints verifying Firebase ID tokens, admin user status (`adminUsers/{uid}.is_active == true`), and role permissions.
2. **Role Hierarchy**:
   - `SUPER_ADMIN`: Full administrative and financial override authority (subject to Two-Man Rule).
   - `ADMIN`: Operational management (customer status, KYC reviews, manual requeries).
   - `AUDITOR`: Strictly read-only visibility into transactions, audit logs, and reconciliation reports; completely blocked from executing financial mutations or state changes.
   - `CUSTOMER`: Zero administrative access.
3. **Two-Man Rule**: Financial mutations exceeding ₦10,000 (1,000,000 kobo) require dual authorization from two distinct active administrators.
4. **Immutable Audit Trail**: All administrative actions record actor UID, role, timestamp, correlation ID, before state, and after state in append-only audit logs.
