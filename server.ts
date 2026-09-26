/**
 * Alexvya Platform — Full-Stack Server Entry Point
 * Stage 2.5.6 Hardened Financial Security Architecture
 * 
 * Runs Express server mounting /api/v1/* routes with strict security headers, CORS,
 * rate limiting, correlation tracking, and Vite middlewares in development.
 */

import express, { Request, Response, NextFunction } from 'express';
import { generateCorrelationId } from './src/lib/api/correlation.ts';
import { createSuccessResponse, createErrorResponse } from './src/lib/api/response.ts';
import { authenticateRequest } from './src/server/auth/session.ts';
import { provisionOrSyncUser, updateExistingUserProfile, getCustomerAccountSummary } from './src/server/users/provisioning.ts';
import { ensureWallet } from './src/server/repositories/wallets.repository.ts';
import { queryLedgerByWalletId, getLedgerEntry } from './src/server/repositories/ledger.repository.ts';
import { updateProfileSchema } from './src/lib/validation/profile.ts';
import { KycService } from './src/server/services/kyc/kyc.service.ts';
import { 
  startKycSchema, 
  submitKycSchema, 
  tierUpgradeRequestSchema, 
  adminKycReviewSchema 
} from './src/lib/validation/kyc.ts';
import { applySecurityHeaders, applySafeCors } from './src/server/security/headers.ts';
import { createRateLimitMiddleware, RATE_LIMIT_CONFIGS } from './src/server/security/rateLimiter.ts';
import { logger } from './src/lib/logger/logger.ts';
import { validateFirebaseAdminConfig } from './src/server/firebase/config.ts';
import { AlexvyaApiError, ErrorCodes } from './src/lib/api/errors.ts';
import {
  initializeWalletFunding,
  verifyAndSettleWalletFunding,
  processPaystackWebhook,
} from './src/server/services/paystack/paystackFunding.service.ts';
import { VerificationSource, NetworkProvider, MeterType, TransactionStatus, TransactionType } from './src/types/enums.ts';
import { VasPurchaseService } from './src/server/services/vas/vasPurchase.service.ts';
import { VasValidationService } from './src/server/services/vas/vasValidation.service.ts';
import { VasRequeryService } from './src/server/services/vas/vasRequery.service.ts';
import { getServiceOrderById } from './src/server/repositories/serviceOrders.repository.ts';
import { getTransactionById, queryTransactionsByUser } from './src/server/repositories/transactions.repository.ts';
import { ReceiptService } from './src/server/services/transactions/receipt.service.ts';
import {
  queryNotificationsByUser,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from './src/server/repositories/notifications.repository.ts';
import { queryNotificationDeliveriesForAdmin } from './src/server/repositories/notificationDeliveries.repository.ts';

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

// Defensive Payload Size Limit (100kb maximum to prevent memory exhaustion / DoS)
// Also captures rawBody buffer for HMAC-SHA512 webhook signature verification
app.use(
  express.json({
    limit: '100kb',
    verify: (req: any, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  })
);

// Security Headers & CORS Middlewares
app.use(applySecurityHeaders);
app.use(applySafeCors);

// Correlation ID & Request Logging Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  res.setHeader('x-correlation-id', correlationId);
  (req as any).correlationId = correlationId;

  if (req.path.startsWith('/api')) {
    logger.info(`[HTTP] ${req.method} ${req.path}`, undefined, correlationId);
  }
  next();
});

// General API Rate Limiting Middleware for /api/*
app.use('/api', createRateLimitMiddleware(RATE_LIMIT_CONFIGS.GENERAL_API));

// Health check endpoint
app.get('/api/v1/health', (req: Request, res: Response) => {
  const correlationId = (req as any).correlationId;
  const adminConfig = validateFirebaseAdminConfig();

  res.json(
    createSuccessResponse(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Alexvya Platform API',
        environment: process.env.NODE_ENV || 'development',
        firebase_admin: {
          configured: adminConfig.isConfigured,
          has_service_account: adminConfig.hasServiceAccount,
          has_adc: adminConfig.hasAdc,
          project_id: adminConfig.projectId,
        },
      },
      correlationId
    )
  );
});

// Auth token verification endpoint
app.get('/api/v1/auth/verify', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    res.json(
      createSuccessResponse(
        {
          authenticated: true,
          user: {
            uid: userContext.uid,
            email: userContext.email,
            email_verified: userContext.emailVerified,
            role: userContext.role,
          },
        },
        correlationId
      )
    );
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// GET /api/v1/user/profile — Retrieves or provisions/syncs authenticated user profile
app.get('/api/v1/user/profile', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const profile = await provisionOrSyncUser(userContext, correlationId);

    res.json(createSuccessResponse(profile, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// GET /api/v1/user/account-summary — Retrieves authoritative customer summary, limits, and status info
app.get(['/api/v1/user/account-summary', '/api/v1/user/limits'], async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const summary = await getCustomerAccountSummary(userContext, correlationId);

    res.json(createSuccessResponse(summary, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// PATCH /api/v1/user/profile — Updates allowed personal profile fields
app.patch('/api/v1/user/profile', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.flatten();
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid profile update payload. Only permitted personal profile fields may be modified.',
        422,
        { validation_errors: errorDetails, correlation_id: correlationId }
      );
    }

    const updatedProfile = await updateExistingUserProfile(
      userContext.uid,
      parseResult.data,
      correlationId
    );

    res.json(createSuccessResponse(updatedProfile, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// ============================================================================
// CUSTOMER KYC & TIER VERIFICATION ENDPOINTS (Stage 2.12)
// ============================================================================

// GET /api/v1/user/kyc — Safe KYC status for authenticated customer
app.get('/api/v1/user/kyc', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const kycStatus = await KycService.getCustomerKycStatus(userContext, correlationId);
    res.json(createSuccessResponse(kycStatus, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// GET /api/v1/user/tier-eligibility — Evaluates tier progression eligibility
app.get('/api/v1/user/tier-eligibility', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const eligibility = await KycService.getCustomerTierEligibility(userContext, correlationId);
    res.json(createSuccessResponse(eligibility, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// POST /api/v1/user/kyc/start — Initiates KYC verification workflow
app.post('/api/v1/user/kyc/start', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const parseResult = startKycSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid KYC initialization payload.',
        422,
        { validation_errors: parseResult.error.flatten(), correlation_id: correlationId }
      );
    }

    const result = await KycService.startKycVerification(userContext, parseResult.data, correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// POST /api/v1/user/kyc/submit — Submits identity data for evaluation
app.post('/api/v1/user/kyc/submit', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const parseResult = submitKycSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid KYC submission payload. Please check all required fields.',
        422,
        { validation_errors: parseResult.error.flatten(), correlation_id: correlationId }
      );
    }

    const result = await KycService.submitKycVerification(userContext, parseResult.data, correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// POST /api/v1/user/tier-upgrade/request — Submits tier upgrade request directly
app.post('/api/v1/user/tier-upgrade/request', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const parseResult = tierUpgradeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid tier upgrade request payload.',
        422,
        { validation_errors: parseResult.error.flatten(), correlation_id: correlationId }
      );
    }

    const result = await KycService.requestTierUpgrade(userContext, parseResult.data, correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// GET /api/v1/wallet & /api/v1/wallet/balance — Retrieves authoritative wallet state for authenticated customer
app.get(['/api/v1/wallet', '/api/v1/wallet/balance'], async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    
    // Authoritative customer UID from verified session token ONLY
    const wallet = await ensureWallet(userContext.uid, correlationId);

    res.json(
      createSuccessResponse(
        {
          id: wallet.id,
          currency: wallet.currency,
          available_balance_kobo: wallet.available_balance_kobo,
          ledger_balance_kobo: wallet.ledger_balance_kobo,
          locked_balance_kobo: wallet.locked_balance_kobo,
          status: wallet.status,
          version: wallet.version,
          updated_at: wallet.updated_at,
        },
        correlationId
      )
    );
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// GET /api/v1/wallet/ledger — Query paginated immutable ledger statement
app.get('/api/v1/wallet/ledger', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursorParam = req.query.cursor ? String(req.query.cursor) : undefined;
    const entryTypeParam = req.query.entry_type ? (req.query.entry_type as any) : undefined;

    const result = await queryLedgerByWalletId(
      userContext.uid,
      {
        limit: limitParam,
        cursor: cursorParam,
        entry_type: entryTypeParam,
      },
      correlationId
    );

    res.json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// GET /api/v1/wallet/ledger/:ledgerId — Retrieve single immutable ledger record
app.get('/api/v1/wallet/ledger/:ledgerId', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const ledgerId = req.params.ledgerId;
    const entry = await getLedgerEntry(userContext.uid, ledgerId, correlationId);

    if (!entry) {
      throw new AlexvyaApiError(
        ErrorCodes.LEDGER_ENTRY_NOT_FOUND,
        `Ledger record '${ledgerId}' was not found.`,
        404,
        { ledger_id: ledgerId, correlation_id: correlationId }
      );
    }

    res.json(createSuccessResponse(entry, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// ============================================================================
// PAYSTACK WALLET FUNDING ROUTES (Stage 2.6)
// ============================================================================

// POST /api/v1/wallet/fund/initialize — Initialize Paystack funding checkout
app.post('/api/v1/wallet/fund/initialize', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body?.idempotency_key as string);
    const amountKobo = req.body?.amount_kobo;
    const callbackUrl = req.body?.callback_url;
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip;

    const result = await initializeWalletFunding({
      userId: userContext.uid,
      amountKobo,
      idempotencyKey,
      ipAddress,
      callbackUrl,
      correlationId,
    });

    res.json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// GET /api/v1/wallet/fund/verify/:reference — Authoritatively verify & settle Paystack funding
app.get('/api/v1/wallet/fund/verify/:reference', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const reference = req.params.reference;

    const result = await verifyAndSettleWalletFunding({
      reference,
      userId: userContext.uid,
      verificationSource: VerificationSource.CLIENT_CALLBACK_VERIFY,
      correlationId,
    });

    res.json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// POST /api/v1/webhooks/paystack — Public Webhook endpoint with HMAC-SHA512 raw body verification
app.post('/api/v1/webhooks/paystack', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const signature = req.headers['x-paystack-signature'] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    const result = await processPaystackWebhook({
      rawBody,
      signature,
      correlationId,
    });

    res.status(200).json(result);
  } catch (err: any) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// ============================================================================
// VAS SERVICE PURCHASE & REQUERY ROUTES (Stage 2.7)
// ============================================================================

// POST /api/v1/services/airtime/purchase — Airtime VTU purchase
app.post(
  '/api/v1/services/airtime/purchase',
  createRateLimitMiddleware(RATE_LIMIT_CONFIGS.VAS_PURCHASE),
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req as any).correlationId;

    try {
      const authHeader = req.headers.authorization;
      const userContext = await authenticateRequest(authHeader, { correlationId });

      const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body?.idempotency_key as string);
      if (!idempotencyKey) {
        throw new AlexvyaApiError(
          ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
          'Idempotency-Key header is required for VAS service purchases.',
          400
        );
      }

      const { network, phone_number, amount_kobo } = req.body;
      const result = await VasPurchaseService.purchaseAirtime({
        userId: userContext.uid,
        network: network as NetworkProvider,
        phoneNumber: phone_number,
        amountKobo: amount_kobo,
        idempotencyKey,
        correlationId,
      });

      res.status(200).json(createSuccessResponse(result, correlationId));
    } catch (err) {
      const { response, statusCode } = createErrorResponse(err, correlationId);
      res.status(statusCode).json(response);
    }
  }
);

// POST /api/v1/services/data/purchase — Data Bundle purchase
app.post(
  '/api/v1/services/data/purchase',
  createRateLimitMiddleware(RATE_LIMIT_CONFIGS.VAS_PURCHASE),
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req as any).correlationId;

    try {
      const authHeader = req.headers.authorization;
      const userContext = await authenticateRequest(authHeader, { correlationId });

      const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body?.idempotency_key as string);
      if (!idempotencyKey) {
        throw new AlexvyaApiError(
          ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
          'Idempotency-Key header is required for VAS service purchases.',
          400
        );
      }

      const { product_id, phone_number } = req.body;
      const result = await VasPurchaseService.purchaseData({
        userId: userContext.uid,
        productId: product_id,
        phoneNumber: phone_number,
        idempotencyKey,
        correlationId,
      });

      res.status(200).json(createSuccessResponse(result, correlationId));
    } catch (err) {
      const { response, statusCode } = createErrorResponse(err, correlationId);
      res.status(statusCode).json(response);
    }
  }
);

// POST /api/v1/services/electricity/validate-meter — Meter Pre-Purchase Validation
app.post(
  '/api/v1/services/electricity/validate-meter',
  createRateLimitMiddleware(RATE_LIMIT_CONFIGS.UTILITY_VALIDATION),
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req as any).correlationId;

    try {
      const authHeader = req.headers.authorization;
      await authenticateRequest(authHeader, { correlationId });

      const { disco, meter_number, meter_type } = req.body;
      const result = await VasValidationService.validateMeter({
        disco,
        meterNumber: meter_number,
        meterType: meter_type as MeterType,
        correlationId,
      });

      res.status(200).json(createSuccessResponse(result, correlationId));
    } catch (err) {
      const { response, statusCode } = createErrorResponse(err, correlationId);
      res.status(statusCode).json(response);
    }
  }
);

// POST /api/v1/services/electricity/purchase — Electricity Token Purchase
app.post(
  '/api/v1/services/electricity/purchase',
  createRateLimitMiddleware(RATE_LIMIT_CONFIGS.VAS_PURCHASE),
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req as any).correlationId;

    try {
      const authHeader = req.headers.authorization;
      const userContext = await authenticateRequest(authHeader, { correlationId });

      const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body?.idempotency_key as string);
      if (!idempotencyKey) {
        throw new AlexvyaApiError(
          ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
          'Idempotency-Key header is required for VAS service purchases.',
          400
        );
      }

      const { disco, meter_number, meter_type, amount_kobo, customer_name, customer_address } = req.body;
      const result = await VasPurchaseService.purchaseElectricity({
        userId: userContext.uid,
        disco,
        meterNumber: meter_number,
        meterType: meter_type as MeterType,
        amountKobo: amount_kobo,
        customerName: customer_name,
        customerAddress: customer_address,
        idempotencyKey,
        correlationId,
      });

      res.status(200).json(createSuccessResponse(result, correlationId));
    } catch (err) {
      const { response, statusCode } = createErrorResponse(err, correlationId);
      res.status(statusCode).json(response);
    }
  }
);

// POST /api/v1/services/cable-tv/validate-smartcard — Smartcard Pre-Purchase Validation
app.post(
  '/api/v1/services/cable-tv/validate-smartcard',
  createRateLimitMiddleware(RATE_LIMIT_CONFIGS.UTILITY_VALIDATION),
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req as any).correlationId;

    try {
      const authHeader = req.headers.authorization;
      await authenticateRequest(authHeader, { correlationId });

      const { operator, smartcard_number } = req.body;
      const result = await VasValidationService.validateSmartcard({
        operator,
        smartcardNumber: smartcard_number,
        correlationId,
      });

      res.status(200).json(createSuccessResponse(result, correlationId));
    } catch (err) {
      const { response, statusCode } = createErrorResponse(err, correlationId);
      res.status(statusCode).json(response);
    }
  }
);

// POST /api/v1/services/cable-tv/purchase — Cable TV Subscription Purchase
app.post(
  '/api/v1/services/cable-tv/purchase',
  createRateLimitMiddleware(RATE_LIMIT_CONFIGS.VAS_PURCHASE),
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req as any).correlationId;

    try {
      const authHeader = req.headers.authorization;
      const userContext = await authenticateRequest(authHeader, { correlationId });

      const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body?.idempotency_key as string);
      if (!idempotencyKey) {
        throw new AlexvyaApiError(
          ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
          'Idempotency-Key header is required for VAS service purchases.',
          400
        );
      }

      const { product_id, smartcard_number, customer_name } = req.body;
      const result = await VasPurchaseService.purchaseCableTv({
        userId: userContext.uid,
        productId: product_id,
        smartcardNumber: smartcard_number,
        customerName: customer_name,
        idempotencyKey,
        correlationId,
      });

      res.status(200).json(createSuccessResponse(result, correlationId));
    } catch (err) {
      const { response, statusCode } = createErrorResponse(err, correlationId);
      res.status(statusCode).json(response);
    }
  }
);

// POST /api/v1/services/orders/:orderId/requery — Requery & Reconcile Order Status
app.post('/api/v1/services/orders/:orderId/requery', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const orderId = req.params.orderId;

    const order = await getServiceOrderById(orderId);
    if (!order) {
      throw new AlexvyaApiError(ErrorCodes.ORDER_NOT_FOUND, `Order '${orderId}' not found.`, 404);
    }

    if (order.user_id !== userContext.uid && userContext.role !== 'SUPER_ADMIN' && userContext.role !== 'ADMIN') {
      throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, 'Cross-user order access is forbidden.', 403);
    }

    const result = await VasRequeryService.requeryOrder(orderId, correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// GET /api/v1/services/orders/:orderId — Retrieve Order Status & Details
app.get('/api/v1/services/orders/:orderId', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const orderId = req.params.orderId;

    const order = await getServiceOrderById(orderId);
    if (!order) {
      throw new AlexvyaApiError(ErrorCodes.ORDER_NOT_FOUND, `Order '${orderId}' not found.`, 404);
    }

    if (order.user_id !== userContext.uid && userContext.role !== 'SUPER_ADMIN' && userContext.role !== 'ADMIN') {
      throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, 'Cross-user order access is forbidden.', 403);
    }

    const transaction = await getTransactionById(order.id);

    res.status(200).json(
      createSuccessResponse(
        {
          id: order.id,
          transaction_reference: order.transaction_reference,
          service_category: order.service_category,
          status: order.status,
          product_name: order.product_name_snapshot,
          recipient_identifier: order.recipient_identifier,
          face_value_kobo: order.face_value_kobo,
          amount_debited_kobo: order.amount_debited_kobo,
          created_at: order.created_at,
          updated_at: order.updated_at,
          transaction_status: transaction?.status || 'UNKNOWN',
        },
        correlationId
      )
    );
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// ============================================================================
// CUSTOMER TRANSACTIONS, RECEIPTS & NOTIFICATIONS (Stage 2.10)
// ============================================================================

// 1. GET /api/v1/transactions — List customer's paginated transactions
app.get('/api/v1/transactions', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursorParam = req.query.cursor ? String(req.query.cursor) : undefined;
    const statusParam = req.query.status ? (req.query.status as TransactionStatus) : undefined;
    const typeParam = req.query.type ? (req.query.type as TransactionType) : undefined;

    const result = await queryTransactionsByUser(
      userContext.uid,
      {
        limit: limitParam,
        cursor: cursorParam,
        status: statusParam,
        type: typeParam,
      }
    );

    // Map each transaction into customer-safe summary (stripping internal provider cost / gross profit)
    const sanitizedItems = result.items.map((tx) => ({
      id: tx.id,
      reference: tx.reference,
      type: tx.type,
      category: (tx.service_details?.category as string) || (tx.service_details?.service_category as string) || null,
      amount_kobo: tx.amount_kobo,
      charged_amount_kobo: tx.total_charged_kobo ?? tx.amount_kobo,
      discount_kobo: tx.discount_kobo ?? tx.original_economics?.discount_kobo ?? 0,
      service_fee_kobo: tx.fee_kobo ?? 0,
      refund_amount_kobo: tx.settlement_economics?.refund_amount_kobo ?? (tx.status === TransactionStatus.REFUNDED ? tx.amount_kobo : null),
      status: tx.status,
      recipient_identifier: (tx.service_details?.recipient as string) || (tx.service_details?.phone_number as string) || (tx.service_details?.customer_identifier as string) || null,
      product_name: (tx.service_details?.product_name as string) || (tx.service_details?.description as string) || null,
      description: (tx.service_details?.description as string) || null,
      created_at: tx.created_at,
      settled_at: tx.completed_at || null,
    }));

    res.status(200).json(
      createSuccessResponse(
        {
          items: sanitizedItems,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          total: result.total,
        },
        correlationId
      )
    );
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 2. GET /api/v1/transactions/:id — Retrieve single customer transaction
app.get('/api/v1/transactions/:id', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const transactionId = req.params.id;

    const receipt = await ReceiptService.generateReceipt(
      transactionId,
      userContext.uid,
      userContext.role,
      correlationId
    );

    res.status(200).json(createSuccessResponse(receipt, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 3. GET /api/v1/transactions/:id/receipt — Retrieve authoritative receipt details
app.get('/api/v1/transactions/:id/receipt', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const transactionId = req.params.id;

    const receipt = await ReceiptService.generateReceipt(
      transactionId,
      userContext.uid,
      userContext.role,
      correlationId
    );

    res.status(200).json(createSuccessResponse(receipt, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 4. GET /api/v1/notifications — List customer notifications
app.get('/api/v1/notifications', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursorParam = req.query.cursor ? String(req.query.cursor) : undefined;
    const isReadParam = req.query.is_read !== undefined ? req.query.is_read === 'true' : undefined;

    const result = await queryNotificationsByUser(userContext.uid, {
      limit: limitParam,
      cursor: cursorParam,
      is_read: isReadParam,
    });

    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 5. GET /api/v1/notifications/unread-count — Get customer unread notifications count
app.get('/api/v1/notifications/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const count = await getUnreadNotificationCount(userContext.uid);
    res.status(200).json(createSuccessResponse({ unread_count: count }, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 6. PATCH /api/v1/notifications/:id/read — Mark single notification as read
app.patch('/api/v1/notifications/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });
    const notificationId = req.params.id;

    const updated = await markNotificationAsRead(userContext.uid, notificationId);
    res.status(200).json(createSuccessResponse(updated, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 7. POST /api/v1/notifications/mark-all-read — Mark all customer notifications as read
app.post('/api/v1/notifications/mark-all-read', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;

  try {
    const authHeader = req.headers.authorization;
    const userContext = await authenticateRequest(authHeader, { correlationId });

    const updatedCount = await markAllNotificationsAsRead(userContext.uid);
    res.status(200).json(createSuccessResponse({ success: true, updated_count: updatedCount }, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// ============================================================================
// CATALOG ENDPOINTS (Stage 2.9)
// ============================================================================

import { queryActiveProductsByCategory } from './src/server/repositories/serviceProducts.repository.ts';
import { VasPricingService } from './src/server/services/vas/vasPricing.service.ts';
import { ServiceCategory } from './src/types/enums.ts';

// 1. GET /api/v1/catalog/services
app.get('/api/v1/catalog/services', async (req: Request, res: Response) => {
  const correlationId = (req as any).correlationId;
  try {
    const services = [
      { id: 'airtime', name: 'Airtime Recharge', category: ServiceCategory.AIRTIME },
      { id: 'data', name: 'Mobile Data Bundle', category: ServiceCategory.DATA },
      { id: 'electricity', name: 'Electricity Bills', category: ServiceCategory.ELECTRICITY },
      { id: 'cable-tv', name: 'Cable TV Subscription', category: ServiceCategory.CABLE_TV },
    ];
    res.status(200).json(createSuccessResponse(services, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 2. GET /api/v1/catalog/airtime
app.get('/api/v1/catalog/airtime', async (req: Request, res: Response) => {
  const correlationId = (req as any).correlationId;
  try {
    await VasPricingService.seedDefaultProducts();
    const result = await queryActiveProductsByCategory(ServiceCategory.AIRTIME);
    res.status(200).json(createSuccessResponse(result.items, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 3. GET /api/v1/catalog/data
app.get('/api/v1/catalog/data', async (req: Request, res: Response) => {
  const correlationId = (req as any).correlationId;
  try {
    await VasPricingService.seedDefaultProducts();
    const result = await queryActiveProductsByCategory(ServiceCategory.DATA);
    res.status(200).json(createSuccessResponse(result.items, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 4. GET /api/v1/catalog/electricity
app.get('/api/v1/catalog/electricity', async (req: Request, res: Response) => {
  const correlationId = (req as any).correlationId;
  try {
    await VasPricingService.seedDefaultProducts();
    const result = await queryActiveProductsByCategory(ServiceCategory.ELECTRICITY);
    res.status(200).json(createSuccessResponse(result.items, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 5. GET /api/v1/catalog/cable-tv
app.get('/api/v1/catalog/cable-tv', async (req: Request, res: Response) => {
  const correlationId = (req as any).correlationId;
  try {
    await VasPricingService.seedDefaultProducts();
    const result = await queryActiveProductsByCategory(ServiceCategory.CABLE_TV);
    res.status(200).json(createSuccessResponse(result.items, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});


// ============================================================================
// STAGE 2.8: ADMIN OPERATIONS & REQUERY AUTOMATION WORKER ROUTES
// ============================================================================

import { authorizeAdminRequest, authenticateWorkerRequest } from './src/server/services/admin/adminAuth.service.ts';
import { AdminOperationsService } from './src/server/services/admin/adminOperations.service.ts';
import { WorkersService } from './src/server/services/admin/workers.service.ts';
import { queryAuditLogsByAction } from './src/server/repositories/auditLogs.repository.ts';

// 1. GET /api/v1/admin/users — List Platform Users
app.get('/api/v1/admin/users', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authorizeAdminRequest(authHeader, {}, correlationId);

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const cursor = (req.query.cursor as string) || undefined;
    const status = (req.query.status as string) || undefined;

    const result = await AdminOperationsService.listUsers({ limit, cursor, status });
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 2. GET /api/v1/admin/users/:userId — Get User Detail & Ledger
app.get('/api/v1/admin/users/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    await authorizeAdminRequest(authHeader, {}, correlationId);

    const userId = req.params.userId;
    const result = await AdminOperationsService.getUserDetail(userId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 3. GET /api/v1/admin/transactions — Operational Transaction Search
app.get('/api/v1/admin/transactions', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    await authorizeAdminRequest(authHeader, {}, correlationId);

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const cursor = (req.query.cursor as string) || undefined;
    const status = (req.query.status as string) || undefined;
    const userId = (req.query.user_id as string) || undefined;
    const reference = (req.query.reference as string) || undefined;

    const result = await AdminOperationsService.searchTransactions({ limit, cursor, status: status as any, userId, reference });
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 4. GET /api/v1/admin/transactions/:id — Consolidated Transaction Investigation
app.get('/api/v1/admin/transactions/:id', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    await authorizeAdminRequest(authHeader, {}, correlationId);

    const transactionId = req.params.id;
    const result = await AdminOperationsService.investigateTransaction(transactionId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 5. POST /api/v1/admin/transactions/:id/requery — Manual Requery
app.post('/api/v1/admin/transactions/:id/requery', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authorizeAdminRequest(authHeader, {}, correlationId);

    const transactionId = req.params.id;
    const result = await AdminOperationsService.manualRequery(transactionId, adminCtx.uid, correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 6. POST /api/v1/admin/transactions/:id/refund — Manual Refund (with Two-Man Rule Support)
app.post('/api/v1/admin/transactions/:id/refund', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authorizeAdminRequest(authHeader, {}, correlationId);

    if (adminCtx.role === 'AUDITOR') {
      throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, 'Auditor role is strictly read-only and cannot execute refunds.', 403);
    }

    const transactionId = req.params.id;
    const { reason, approver_id } = req.body;

    const result = await AdminOperationsService.manualRefund(
      transactionId,
      reason,
      { uid: adminCtx.uid, role: adminCtx.role },
      approver_id,
      correlationId
    );
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 7. POST /api/v1/admin/transactions/:id/reverse — Manual Reversal
app.post('/api/v1/admin/transactions/:id/reverse', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authorizeAdminRequest(authHeader, {}, correlationId);

    if (adminCtx.role === 'AUDITOR') {
      throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, 'Auditor role is strictly read-only and cannot execute reversals.', 403);
    }

    const transactionId = req.params.id;
    const { reason } = req.body;

    const result = await AdminOperationsService.manualReverse(
      transactionId,
      reason,
      { uid: adminCtx.uid, role: adminCtx.role },
      correlationId
    );
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 8. GET /api/v1/admin/providers — List Providers
app.get('/api/v1/admin/providers', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    await authorizeAdminRequest(authHeader, {}, correlationId);

    const result = await AdminOperationsService.listProvidersStatus();
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 9. GET /api/v1/admin/providers/:providerId — Get Provider Detail
app.get('/api/v1/admin/providers/:providerId', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    await authorizeAdminRequest(authHeader, {}, correlationId);

    const providerId = req.params.providerId;
    const providers = await AdminOperationsService.listProvidersStatus();
    const provider = providers.find((p: any) => p.id === providerId);
    if (!provider) {
      throw new AlexvyaApiError(ErrorCodes.RESOURCE_NOT_FOUND, `Provider '${providerId}' not found.`, 404);
    }
    res.status(200).json(createSuccessResponse(provider, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 10. POST /api/v1/admin/providers/:providerId/circuit-breaker — Circuit Breaker Control
app.post('/api/v1/admin/providers/:providerId/circuit-breaker', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authorizeAdminRequest(authHeader, {}, correlationId);

    if (adminCtx.role === 'AUDITOR') {
      throw new AlexvyaApiError(ErrorCodes.FORBIDDEN, 'Auditor role cannot modify circuit breaker state.', 403);
    }

    const providerId = req.params.providerId;
    const { action, reason } = req.body;

    const result = await AdminOperationsService.setCircuitBreakerState(
      providerId,
      action,
      reason,
      { uid: adminCtx.uid, role: adminCtx.role },
      correlationId
    );
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 11. GET /api/v1/admin/audit-logs — Audit Logs
app.get('/api/v1/admin/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    await authorizeAdminRequest(authHeader, {}, correlationId);

    const actionQuery = (req.query.action as any) || undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const result = await queryAuditLogsByAction(actionQuery, { limit });
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 12. GET /api/v1/admin/reconciliation — Reconciliation Report
app.get('/api/v1/admin/reconciliation', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    await authorizeAdminRequest(authHeader, {}, correlationId);

    const report = await AdminOperationsService.getReconciliationReport();
    res.status(200).json(createSuccessResponse(report, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 13. POST /api/v1/workers/requery-pending — Automated Requery Worker Endpoint
app.post('/api/v1/workers/requery-pending', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    await authenticateWorkerRequest(req, correlationId);
    const result = await WorkersService.runRequeryWorker(correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 14. POST /api/v1/workers/health-check — Automated Health-Check Worker Endpoint
app.post('/api/v1/workers/health-check', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    await authenticateWorkerRequest(req, correlationId);
    const result = await WorkersService.runHealthCheckWorker(correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 14b. POST /api/v1/workers/notification-delivery — Automated Notification Retry Worker
app.post('/api/v1/workers/notification-delivery', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    await authenticateWorkerRequest(req, correlationId);
    const result = await WorkersService.runNotificationDeliveryWorker(correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 14c. GET /api/v1/admin/notifications/deliveries — Admin Notification Delivery Log Investigation
app.get('/api/v1/admin/notifications/deliveries', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    await authorizeAdminRequest(authHeader, {}, correlationId);

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const cursor = (req.query.cursor as string) || undefined;
    const status = (req.query.status as any) || undefined;
    const userId = (req.query.user_id as string) || undefined;
    const eventType = (req.query.event_type as string) || undefined;

    const result = await queryNotificationDeliveriesForAdmin({
      limit,
      cursor,
      status,
      userId,
      eventType,
    });
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 15. GET /api/v1/admin/kyc/requests — List KYC Verification Queue
app.get('/api/v1/admin/kyc/requests', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authenticateRequest(authHeader, { correlationId });

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const cursor = (req.query.cursor as string) || undefined;
    const status = (req.query.status as any) || undefined;
    const userId = (req.query.user_id as string) || undefined;

    const result = await KycService.adminListKycRequests(
      adminCtx,
      { status, userId },
      { limit, cursor },
      correlationId
    );
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 16. GET /api/v1/admin/kyc/requests/:id — Inspect single KYC Verification Request
app.get('/api/v1/admin/kyc/requests/:id', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authenticateRequest(authHeader, { correlationId });
    const requestId = req.params.id;

    const result = await KycService.adminGetKycRequest(adminCtx, requestId, correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 17. POST /api/v1/admin/kyc/requests/:id/approve — Approve KYC Request & Apply Tier Upgrade
app.post('/api/v1/admin/kyc/requests/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authenticateRequest(authHeader, { correlationId });
    const requestId = req.params.id;
    const justification = req.body?.justification;

    const result = await KycService.adminApproveKycRequest(adminCtx, requestId, justification, correlationId);
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 18. POST /api/v1/admin/kyc/requests/:id/reject — Reject KYC Verification Request
app.post('/api/v1/admin/kyc/requests/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authenticateRequest(authHeader, { correlationId });
    const requestId = req.params.id;
    const { rejection_reason_code, rejection_notes } = req.body;

    if (!rejection_reason_code) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'rejection_reason_code is required when rejecting a KYC request.',
        422,
        { correlation_id: correlationId }
      );
    }

    const result = await KycService.adminRejectKycRequest(
      adminCtx,
      requestId,
      rejection_reason_code,
      rejection_notes,
      correlationId
    );
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

// 19. POST /api/v1/admin/kyc/requests/:id/request-action — Request Customer Action
app.post('/api/v1/admin/kyc/requests/:id/request-action', async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req as any).correlationId;
  try {
    const authHeader = req.headers.authorization;
    const adminCtx = await authenticateRequest(authHeader, { correlationId });
    const requestId = req.params.id;
    const { customer_action_required } = req.body;

    if (!customer_action_required || !customer_action_required.trim()) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        'customer_action_required description is required.',
        422,
        { correlation_id: correlationId }
      );
    }

    const result = await KycService.adminRequestKycAction(
      adminCtx,
      requestId,
      customer_action_required.trim(),
      correlationId
    );
    res.status(200).json(createSuccessResponse(result, correlationId));
  } catch (err) {
    const { response, statusCode } = createErrorResponse(err, correlationId);
    res.status(statusCode).json(response);
  }
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const correlationId = (req as any).correlationId || generateCorrelationId();
  const { response, statusCode } = createErrorResponse(err, correlationId);
  res.status(statusCode).json(response);
});

// Dev vs Prod Vite Integration
async function startServer() {
  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, () => {
    logger.info(`Alexvya Server running on port ${PORT} [Mode: ${isDev ? 'development' : 'production'}]`);
  });
}

startServer();
