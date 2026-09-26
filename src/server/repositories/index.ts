/**
 * Alexvya Platform — Server Repositories Barrel Export
 * Stage 2.4 Firestore Repositories + Validation
 * 
 * Central data-access layer for all 17 locked Firestore collections.
 * STRICT INVARIANT: Server-only! Never import from browser bundles.
 */

export * from './base.repository.ts';
export * as usersRepository from './users.repository.ts';
export * as walletsRepository from './wallets.repository.ts';
export * as ledgerRepository from './ledger.repository.ts';
export * as transactionsRepository from './transactions.repository.ts';
export * as paymentAttemptsRepository from './paymentAttempts.repository.ts';
export * as serviceOrdersRepository from './serviceOrders.repository.ts';
export * as serviceProductsRepository from './serviceProducts.repository.ts';
export * as providersRepository from './providers.repository.ts';
export * as providerTransactionsRepository from './providerTransactions.repository.ts';
export * as webhookEventsRepository from './webhookEvents.repository.ts';
export * as notificationsRepository from './notifications.repository.ts';
export * as adminUsersRepository from './adminUsers.repository.ts';
export * as auditLogsRepository from './auditLogs.repository.ts';
export * as idempotencyKeysRepository from './idempotencyKeys.repository.ts';
