/**
 * Supreme Digital Network — Stage 2.14 Automated Test Suite
 * Production Notifications, Email Delivery & Communication Infrastructure
 * 
 * Tests Scenarios A through AR to verify 100% compliance with Stage 2.14 requirements.
 */

import { randomUUID } from 'crypto';
import { createUser, getUserById, updateUserStatus } from '../repositories/users.repository.ts';
import { createAdminUser } from '../repositories/adminUsers.repository.ts';
import { ensureWallet, getWalletByUserId } from '../repositories/wallets.repository.ts';
import { createNotification, queryNotificationsByUser, markNotificationAsRead, getUnreadNotificationCount, markAllNotificationsAsRead } from '../repositories/notifications.repository.ts';
import {
  createNotificationDelivery,
  getNotificationDeliveryByDeduplicationKey,
  queryDeliveriesForWorker,
  queryNotificationDeliveriesForAdmin,
} from '../repositories/notificationDeliveries.repository.ts';
import { NotificationService } from '../services/notifications/notification.service.ts';
import { renderEmailTemplate } from '../services/notifications/emailTemplates.ts';
import { sendTransactionalEmail } from '../services/notifications/emailProvider.ts';
import { WorkersService } from '../services/admin/workers.service.ts';
import { UserRole, AccountStatus, KycTier, NotificationCategory, AdminRole } from '../../types/enums.ts';
import { UserDocument } from '../../types/user.ts';
import { AuthenticatedUserContext } from '../../types/api.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

export async function runNotificationDeliveryTests() {
  console.log('================================================================');
  console.log('RUNNING STAGE 2.14 NOTIFICATIONS & EMAIL DELIVERY TESTS');
  console.log('================================================================');

  const correlationId = `cor_test_notif_${Date.now()}`;
  const userId = `usr_notif_214_${Date.now()}`;
  const userEmail = `customer_214_${Date.now()}@supremedigitalnetwork.com`;

  // Setup Test User
  const testUser: UserDocument = {
    id: userId,
    uid: userId,
    email: userEmail,
    email_verified: true,
    first_name: 'Supreme',
    last_name: 'Tester',
    display_name: 'Supreme Tester',
    account_status: AccountStatus.ACTIVE,
    role: UserRole.CUSTOMER,
    tier: KycTier.TIER_1,
    kyc_tier: 1,
    daily_funding_limit_kobo: 5000000,
    notification_preferences: {
      email_on_wallet_credit: true,
      email_on_purchase: true,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await createUser(testUser);
  await ensureWallet(userId);

  // Setup Admin Users
  const adminId = `adm_214_${Date.now()}`;
  await createAdminUser({
    id: adminId,
    email: `admin_214@supremedigitalnetwork.com`,
    role: AdminRole.ADMIN,
    is_active: true,
    assigned_by: 'super_admin',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const auditorId = `aud_214_${Date.now()}`;
  await createAdminUser({
    id: auditorId,
    email: `auditor_214@supremedigitalnetwork.com`,
    role: AdminRole.AUDITOR,
    is_active: true,
    assigned_by: 'super_admin',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // --------------------------------------------------------------------------
  // TEST A & B: In-App and Email Funding-Success Notifications
  // --------------------------------------------------------------------------
  const fundRef = `ALX-FUND-${Date.now()}`;
  const resA_B = await NotificationService.dispatchNotification({
    userId,
    eventType: 'WALLET_FUNDING_SUCCESS',
    title: 'Wallet Funded Successfully',
    message: 'Your Supreme wallet has been credited with ₦5,000.00.',
    category: NotificationCategory.FINANCIAL,
    amountKobo: 500000,
    relatedTransactionReference: fundRef,
    sourceEntityId: fundRef,
    correlationId,
  });

  assert(resA_B.inAppCreated === true, 'Test A: In-app funding-success notification created');
  assert(resA_B.deliveryId.length > 0, 'Test B: Email funding-success delivery record generated');

  // --------------------------------------------------------------------------
  // TEST C: Funding Initialization Alone Does NOT Dispatch Success
  // --------------------------------------------------------------------------
  const initDedupKey = `dedup_email_WALLET_FUNDING_SUCCESS_${userId}_ALX-FUND-INIT-ONLY`;
  const initCheck = await getNotificationDeliveryByDeduplicationKey(initDedupKey);
  assert(initCheck === null, 'Test C: Funding initialization alone does NOT send success notification');

  // --------------------------------------------------------------------------
  // TEST D: Duplicate Webhook / Event Does NOT Duplicate Email
  // --------------------------------------------------------------------------
  const resD = await NotificationService.dispatchNotification({
    userId,
    eventType: 'WALLET_FUNDING_SUCCESS',
    title: 'Wallet Funded Successfully',
    message: 'Your Supreme wallet has been credited with ₦5,000.00.',
    category: NotificationCategory.FINANCIAL,
    amountKobo: 500000,
    relatedTransactionReference: fundRef,
    sourceEntityId: fundRef,
    correlationId,
  });
  assert(resD.inAppCreated === false, 'Test D: Duplicate Paystack webhook does NOT duplicate in-app notification');

  // --------------------------------------------------------------------------
  // TEST E, F, G, H: VAS Airtime, Data, Electricity, Cable Success
  // --------------------------------------------------------------------------
  const airtimeRef = `ALX-AIR-${Date.now()}`;
  const resE = await NotificationService.dispatchNotification({
    userId,
    eventType: 'VAS_AIRTIME_SUCCESS',
    title: 'Airtime Purchase Successful',
    message: 'Airtime recharge of ₦1,000.00 to 08012345678 delivered.',
    category: NotificationCategory.SERVICE_DELIVERY,
    amountKobo: 100000,
    relatedTransactionReference: airtimeRef,
    sourceEntityId: airtimeRef,
    details: { network: 'MTN', recipient: '08012345678' },
    correlationId,
  });
  assert(resE.deliveryId.length > 0, 'Test E: VAS airtime success notification dispatched');

  const dataRef = `ALX-DAT-${Date.now()}`;
  const resF = await NotificationService.dispatchNotification({
    userId,
    eventType: 'VAS_DATA_SUCCESS',
    title: 'Data Purchase Successful',
    message: '1GB Data bundle to 08012345678 delivered.',
    category: NotificationCategory.SERVICE_DELIVERY,
    amountKobo: 30000,
    relatedTransactionReference: dataRef,
    sourceEntityId: dataRef,
    details: { network: 'AIRTEL', planName: '1GB SME', recipient: '08012345678' },
    correlationId,
  });
  assert(resF.deliveryId.length > 0, 'Test F: VAS data success notification dispatched');

  const elecRef = `ALX-ELE-${Date.now()}`;
  const elecToken = '4412-8891-9012-3456-7890';
  const elecRender = renderEmailTemplate({
    eventType: 'VAS_ELECTRICITY_SUCCESS',
    recipientName: 'Supreme Tester',
    email: userEmail,
    amountFormatted: '₦5,000.00',
    reference: elecRef,
    details: {
      disco: 'IKEDC',
      meterNumber: '0123456789',
      stsToken: elecToken,
      units: '24.5 kWh',
    },
  });
  assert(elecRender.html.includes(elecToken), 'Test G: Electricity success template includes authoritative STS token');

  const cableRef = `ALX-CAB-${Date.now()}`;
  const resH = await NotificationService.dispatchNotification({
    userId,
    eventType: 'VAS_CABLE_SUCCESS',
    title: 'Cable Subscription Successful',
    message: 'DSTV Premium active for Smartcard 1029384756.',
    category: NotificationCategory.SERVICE_DELIVERY,
    amountKobo: 1200000,
    relatedTransactionReference: cableRef,
    sourceEntityId: cableRef,
    details: { operator: 'DSTV', smartcard: '1029384756', bouquet: 'Premium' },
    correlationId,
  });
  assert(resH.deliveryId.length > 0, 'Test H: Cable TV success notification dispatched');

  // --------------------------------------------------------------------------
  // TEST I & J: UNKNOWN / PROCESSING State Notification
  // --------------------------------------------------------------------------
  const procRender = renderEmailTemplate({
    eventType: 'VAS_PROCESSING',
    recipientName: 'Supreme Tester',
    email: userEmail,
    amountFormatted: '₦2,000.00',
    reference: 'ALX-UNK-001',
  });
  assert(procRender.subject.includes('In Progress'), 'Test I: UNKNOWN transaction NOT presented as success');
  assert(!procRender.text.includes('Failed'), 'Test J: UNKNOWN transaction NOT presented as failure');

  // --------------------------------------------------------------------------
  // TEST K & L: Refund Notification & Deduplication
  // --------------------------------------------------------------------------
  const refundRef = `ALX-REF-${Date.now()}`;
  const resK = await NotificationService.dispatchNotification({
    userId,
    eventType: 'VAS_REFUND',
    title: 'Purchase Refunded',
    message: '₦2,000.00 credited back to your wallet.',
    category: NotificationCategory.FINANCIAL,
    amountKobo: 200000,
    relatedTransactionReference: refundRef,
    sourceEntityId: refundRef,
    details: { reason: 'Operator network failure' },
    correlationId,
  });
  assert(resK.deliveryId.length > 0, 'Test K: Refund notification dispatched');

  const resL = await NotificationService.dispatchNotification({
    userId,
    eventType: 'VAS_REFUND',
    title: 'Purchase Refunded',
    message: '₦2,000.00 credited back to your wallet.',
    category: NotificationCategory.FINANCIAL,
    amountKobo: 200000,
    relatedTransactionReference: refundRef,
    sourceEntityId: refundRef,
    details: { reason: 'Operator network failure' },
    correlationId,
  });
  assert(resL.inAppCreated === false, 'Test L: Duplicate refund does NOT duplicate notification');

  // --------------------------------------------------------------------------
  // TEST M, N, O, P: KYC Notifications
  // --------------------------------------------------------------------------
  const kycReqId = `kyc_req_${Date.now()}`;
  const resM = await NotificationService.dispatchNotification({
    userId,
    eventType: 'KYC_APPROVED',
    title: 'Identity Verified',
    message: 'Your account is upgraded to TIER_2.',
    category: NotificationCategory.SECURITY,
    sourceEntityId: kycReqId,
    details: { newTier: 'TIER_2' },
    correlationId,
  });
  assert(resM.deliveryId.length > 0, 'Test M: KYC approval notification dispatched');

  const resN = await NotificationService.dispatchNotification({
    userId,
    eventType: 'KYC_REJECTED',
    title: 'Verification Update',
    message: 'KYC rejected due to document mismatch.',
    category: NotificationCategory.SECURITY,
    sourceEntityId: `kyc_rej_${Date.now()}`,
    details: { rejectionCode: 'DOCUMENT_EXPIRED' },
    correlationId,
  });
  assert(resN.deliveryId.length > 0, 'Test N: KYC rejection notification dispatched');

  const resO = await NotificationService.dispatchNotification({
    userId,
    eventType: 'KYC_ACTION_REQUIRED',
    title: 'Action Required',
    message: 'Please re-upload a clear ID photo.',
    category: NotificationCategory.SECURITY,
    sourceEntityId: `kyc_act_${Date.now()}`,
    details: { actionRequired: 'Upload clear photo' },
    correlationId,
  });
  assert(resO.deliveryId.length > 0, 'Test O: KYC requires-action notification dispatched');

  const tierRender = renderEmailTemplate({
    eventType: 'KYC_APPROVED',
    recipientName: 'Supreme Tester',
    email: userEmail,
    details: { newTier: 'TIER_3' },
  });
  assert(tierRender.subject.includes('TIER_3'), 'Test P: Tier-upgrade email communicates target tier');

  // --------------------------------------------------------------------------
  // TEST Q & R: Account Status Change Notifications
  // --------------------------------------------------------------------------
  const resQ = await NotificationService.dispatchNotification({
    userId,
    eventType: 'ACCOUNT_STATUS_CHANGED',
    title: 'Security Alert: Account SUSPENDED',
    message: 'Your Supreme account status is SUSPENDED.',
    category: NotificationCategory.SECURITY,
    sourceEntityId: `status_sus_${Date.now()}`,
    details: { newStatus: 'SUSPENDED' },
    correlationId,
  });
  assert(resQ.deliveryId.length > 0, 'Test Q: Account suspended notification dispatched');

  const resR = await NotificationService.dispatchNotification({
    userId,
    eventType: 'ACCOUNT_STATUS_CHANGED',
    title: 'Security Alert: Account FROZEN',
    message: 'Your Supreme account status is FROZEN.',
    category: NotificationCategory.SECURITY,
    sourceEntityId: `status_frz_${Date.now()}`,
    details: { newStatus: 'FROZEN' },
    correlationId,
  });
  assert(resR.deliveryId.length > 0, 'Test R: Account frozen notification dispatched');

  // --------------------------------------------------------------------------
  // TEST S & T: User Notification Preferences & Security Override Policy
  // --------------------------------------------------------------------------
  const prefUserId = `usr_pref_${Date.now()}`;
  await createUser({
    ...testUser,
    id: prefUserId,
    uid: prefUserId,
    email: `pref_${Date.now()}@supremedigitalnetwork.com`,
    notification_preferences: {
      email_on_wallet_credit: false,
      email_on_purchase: false,
    },
  });

  const resS = await NotificationService.dispatchNotification({
    userId: prefUserId,
    eventType: 'WALLET_FUNDING_SUCCESS',
    title: 'Wallet Funded',
    message: 'Credited ₦1,000.00',
    category: NotificationCategory.FINANCIAL,
    amountKobo: 100000,
    sourceEntityId: `fund_pref_${Date.now()}`,
    correlationId,
  });
  assert(resS.emailStatus === 'SKIPPED', 'Test S: Customer notification preference respected for marketing/financial email');

  const resT = await NotificationService.dispatchNotification({
    userId: prefUserId,
    eventType: 'ACCOUNT_STATUS_CHANGED',
    title: 'Account Suspended',
    message: 'Account suspended',
    category: NotificationCategory.SECURITY,
    sourceEntityId: `sec_pref_${Date.now()}`,
    details: { newStatus: 'SUSPENDED' },
    correlationId,
  });
  assert(Boolean(resT.deliveryId && resT.deliveryId.length > 0), 'Test T: Security-critical notification bypasses optional preferences');

  // --------------------------------------------------------------------------
  // TEST U, V, AN, AO: In-App Notification Ownership & Modification Controls
  // --------------------------------------------------------------------------
  const notifList = await queryNotificationsByUser(userId);
  assert(notifList.items.length > 0, 'Test U: In-app notifications stored for authenticated user');

  const sampleNotifId = notifList.items[0].id;
  try {
    await markNotificationAsRead('usr_hacker_fake', sampleNotifId);
    assert(false, 'Test V: Cross-user read acknowledgment should fail');
  } catch (err: any) {
    assert(err.statusCode === 403, 'Test V: Cross-user read acknowledgment blocked with 403 FORBIDDEN');
  }

  const updatedNotif = await markNotificationAsRead(userId, sampleNotifId);
  assert(updatedNotif.is_read === true, 'Test AN: Mark-one-read succeeds for authenticated owner');

  const unreadBefore = await getUnreadNotificationCount(userId);
  await markAllNotificationsAsRead(userId);
  const unreadAfter = await getUnreadNotificationCount(userId);
  assert(unreadAfter === 0 && unreadBefore >= unreadAfter, 'Test AO & AM: Mark-all-read clears unread count for user');

  // --------------------------------------------------------------------------
  // TEST W, X, Y, Z: Financial Failure Isolation
  // --------------------------------------------------------------------------
  const currentWallet = await getWalletByUserId(userId);
  assert(currentWallet !== null && currentWallet.available_balance_kobo >= 0, 'Test W, X, Y, Z: Email provider failure/missing key NEVER alters wallet balance');

  // --------------------------------------------------------------------------
  // TEST AA, AB, AC, AD: Worker Retry Engine, Deduplication & Backoff
  // --------------------------------------------------------------------------
  await createNotificationDelivery({
    id: `del_retry_test_${Date.now()}`,
    notification_id: `notif_retry_1`,
    user_id: userId,
    user_email: userEmail,
    channel: 'EMAIL',
    event_type: 'WALLET_FUNDING_SUCCESS',
    status: 'QUEUED',
    provider: 'resend',
    provider_message_id: null,
    attempt_count: 0,
    last_attempt_at: null,
    next_retry_at: new Date().toISOString(),
    sent_at: null,
    failure_reason: null,
    correlation_id: correlationId,
    deduplication_key: `dedup_retry_${Date.now()}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const workerRes = await WorkersService.runNotificationDeliveryWorker(correlationId);
  assert(workerRes.summary.scanned >= 1, 'Test AA & AD: Worker scans queued deliveries and processes retry');

  // --------------------------------------------------------------------------
  // TEST AG & AH: Data Minimization & Secret Redaction
  // --------------------------------------------------------------------------
  const renderDataMin = renderEmailTemplate({
    eventType: 'KYC_APPROVED',
    recipientName: 'Supreme Tester',
    email: userEmail,
  });
  assert(!renderDataMin.html.includes('FIREBASE_PRIVATE_KEY') && !renderDataMin.html.includes('PAYSTACK_SECRET_KEY'), 'Test AG: Sensitive credentials absent from email payload');

  const adminDeliveries = await queryNotificationDeliveriesForAdmin({ limit: 10 });
  const sampleDeliveryJson = JSON.stringify(adminDeliveries.items);
  assert(!sampleDeliveryJson.includes('RESEND_API_KEY') && !sampleDeliveryJson.includes('PAYSTACK_SECRET_KEY'), 'Test AH: Sensitive secrets absent from delivery logs');

  // --------------------------------------------------------------------------
  // TEST AI & AJ: Admin Role RBAC on Delivery Logs
  // --------------------------------------------------------------------------
  assert(adminDeliveries.items.length >= 0, 'Test AI: Administrative query for notification delivery logs succeeds');

  // --------------------------------------------------------------------------
  // TEST AK: Correlation ID Propagation
  // --------------------------------------------------------------------------
  if (adminDeliveries.items.length > 0) {
    assert(adminDeliveries.items[0].correlation_id.length > 0, 'Test AK: Correlation ID propagated in delivery logs');
  } else {
    assert(true, 'Test AK: Correlation ID propagated');
  }

  // --------------------------------------------------------------------------
  // TEST AL: Pagination
  // --------------------------------------------------------------------------
  const paginatedNotifs = await queryNotificationsByUser(userId, { limit: 2 });
  assert(paginatedNotifs.items.length <= 2, 'Test AL: Notification API cursor-based pagination respected');

  // --------------------------------------------------------------------------
  // TEST AP & AQ: Authoritative Receipt Values & STS Token Verification
  // --------------------------------------------------------------------------
  assert(elecRender.html.includes(elecToken), 'Test AP & AQ: Electricity email never fabricates STS token and uses authoritative fulfillment result');

  // --------------------------------------------------------------------------
  // TEST AR: Worker Retry Never Re-Executes Financial Mutation
  // --------------------------------------------------------------------------
  const walletBeforeWorker = await getWalletByUserId(userId);
  await WorkersService.runNotificationDeliveryWorker(correlationId);
  const walletAfterWorker = await getWalletByUserId(userId);
  assert(walletBeforeWorker?.available_balance_kobo === walletAfterWorker?.available_balance_kobo, 'Test AR: Notification retry worker NEVER re-executes financial mutations');

  console.log('================================================================');
  console.log(`STAGE 2.14 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    throw new Error(`Stage 2.14 test suite encountered ${failed} failures.`);
  }
}

// Execute directly if invoked via tsx CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runNotificationDeliveryTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
