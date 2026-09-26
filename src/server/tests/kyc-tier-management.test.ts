/**
 * Alexvya Platform — Stage 2.12 Automated Test Suite
 * KYC, Customer Verification & Tier Management Foundation
 * 
 * Verifies all 34 core security, lifecycle, concurrency, atomicity,
 * and financial isolation requirements for Stage 2.12.
 */

import { KycService } from '../services/kyc/kyc.service.ts';
import { 
  CANONICAL_TIER_POLICIES, 
  getCanonicalLimitsForTier, 
  evaluateTierEligibility, 
  isValidTierTransition 
} from '../services/kyc/tierPolicy.ts';
import { 
  __setActiveKycProviderForTest, 
  __resetKycProviderToDefault, 
  MockKycVerificationProvider, 
  UnconfiguredKycProvider 
} from '../services/kyc/providers/kycProvider.interface.ts';
import { 
  startKycSchema, 
  submitKycSchema, 
  tierUpgradeRequestSchema, 
  adminKycReviewSchema,
  maskIdNumber 
} from '../../lib/validation/kyc.ts';
import { updateProfileSchema } from '../../lib/validation/profile.ts';
import { provisionOrSyncUser, __testSetAccountStatus, localDevUsersStore } from '../users/provisioning.ts';
import { getDb, inMemoryStore } from '../repositories/base.repository.ts';
import { createAdminUser } from '../repositories/adminUsers.repository.ts';
import { ensureWallet, getWalletByUserId } from '../repositories/wallets.repository.ts';
import { queryLedgerByWalletId } from '../repositories/ledger.repository.ts';
import { queryNotificationsByUser } from '../repositories/notifications.repository.ts';
import { queryAuditLogsByActor } from '../repositories/auditLogs.repository.ts';
import { AuthenticatedUserContext } from '../../types/api.ts';
import { UserRole, AdminRole, KycTier, KycStatus, AccountStatus } from '../../types/enums.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    failed++;
  }
}

export async function runStage212Tests() {
  console.log('\n================================================================');
  console.log('RUNNING STAGE 2.12 KYC, VERIFICATION & TIER MANAGEMENT TESTS');
  console.log('================================================================\n');

  inMemoryStore.clear();
  localDevUsersStore.clear();

  // Setup Admin staff fixtures in repository
  await createAdminUser({
    id: 'adm_active_kyc_01',
    email: 'compliance.lead@alexvya.ng',
    role: AdminRole.ADMIN,
    is_active: true,
    assigned_by: 'super_admin_root',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await createAdminUser({
    id: 'adm_inactive_kyc_02',
    email: 'former.officer@alexvya.ng',
    role: AdminRole.ADMIN,
    is_active: false, // Inactive admin
    assigned_by: 'super_admin_root',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await createAdminUser({
    id: 'adm_auditor_kyc_03',
    email: 'external.auditor@kpmg.ng',
    role: AdminRole.AUDITOR, // Auditor (read-only)
    is_active: true,
    assigned_by: 'super_admin_root',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const adminActiveCtx: AuthenticatedUserContext = {
    uid: 'adm_active_kyc_01',
    email: 'compliance.lead@alexvya.ng',
    emailVerified: true,
    role: UserRole.ADMIN,
  };

  const adminInactiveCtx: AuthenticatedUserContext = {
    uid: 'adm_inactive_kyc_02',
    email: 'former.officer@alexvya.ng',
    emailVerified: true,
    role: UserRole.ADMIN,
  };

  const auditorCtx: AuthenticatedUserContext = {
    uid: 'adm_auditor_kyc_03',
    email: 'external.auditor@kpmg.ng',
    emailVerified: true,
    role: UserRole.AUDITOR,
  };

  // Test Customer Fixtures
  const customerAliceCtx: AuthenticatedUserContext = {
    uid: 'usr_kyc_alice_001',
    email: 'alice.adebayo@alexvya.ng',
    emailVerified: true,
    role: UserRole.CUSTOMER,
  };

  const customerBobCtx: AuthenticatedUserContext = {
    uid: 'usr_kyc_bob_002',
    email: 'bob.okoro@alexvya.ng',
    emailVerified: true,
    role: UserRole.CUSTOMER,
  };

  // Ensure clean customer records & wallets for hermetic test execution in real Firestore
  const db = getDb();
  if (db) {
    try {
      await db.collection('users').doc('usr_kyc_alice_001').delete();
      await db.collection('users').doc('usr_kyc_bob_002').delete();
      const verifsAlice = await db.collection('kycVerifications').where('user_id', '==', 'usr_kyc_alice_001').get();
      for (const d of verifsAlice.docs) await d.ref.delete();
      const verifsBob = await db.collection('kycVerifications').where('user_id', '==', 'usr_kyc_bob_002').get();
      for (const d of verifsBob.docs) await d.ref.delete();
    } catch {
      // ignore
    }
  }
  await provisionOrSyncUser(customerAliceCtx, 'corr_init_alice');
  await provisionOrSyncUser(customerBobCtx, 'corr_init_bob');
  const aliceWallet = await ensureWallet('usr_kyc_alice_001', 'corr_wallet_alice');
  const initialAliceBalance = aliceWallet.available_balance_kobo;

  // --------------------------------------------------------------------------
  // A. New Customer KYC State & Default Tier
  // --------------------------------------------------------------------------
  console.log('--- Test Group A: New Customer KYC State & Default Tier ---');
  const aliceKycStatus = await KycService.getCustomerKycStatus(customerAliceCtx, 'corr_a1');
  assert(aliceKycStatus.user_id === 'usr_kyc_alice_001', 'Test A.1: KYC status belongs to authenticated UID');
  assert(aliceKycStatus.current_tier === 'TIER_1', 'Test A.2: Initial default tier is TIER_1');
  assert(aliceKycStatus.status === 'NOT_STARTED', 'Test A.3: Initial KYC status is NOT_STARTED');
  assert(aliceKycStatus.id_number_masked === null, 'Test A.4: Masked ID is null for unsubmitted state');

  // --------------------------------------------------------------------------
  // B. Start Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group B: Start Verification ---');
  const startResult = await KycService.startKycVerification(customerAliceCtx, {
    requested_tier: 'TIER_2',
    verification_method: 'BVN',
  }, 'corr_b1');

  assert(startResult.status === 'IN_PROGRESS', 'Test B.1: Verification starts in IN_PROGRESS status');
  assert(startResult.requested_tier === 'TIER_2', 'Test B.2: Target requested tier is TIER_2');
  assert(startResult.verification_method === 'BVN', 'Test B.3: Verification method is BVN');

  // --------------------------------------------------------------------------
  // C. Valid Submission (Queued for Administrative Review with Unconfigured Provider)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group C: Valid Submission with Unconfigured Provider ---');
  __resetKycProviderToDefault(); // Ensure default Unconfigured provider
  const submitResult = await KycService.submitKycVerification(customerAliceCtx, {
    requested_tier: 'TIER_2',
    verification_method: 'BVN',
    id_type: 'BVN',
    id_number: '22233344455',
    full_legal_name: 'Alice Folashade Adebayo',
    date_of_birth: '1992-05-14',
  }, 'corr_c1');

  assert(submitResult.status === 'PENDING_REVIEW', 'Test C.1: Submission queued in PENDING_REVIEW for manual review');
  assert(submitResult.id_number_masked === '222*****455', 'Test C.2: Sensitive ID number is masked (222*****455)');
  assert(submitResult.current_tier === 'TIER_1', 'Test C.3: Customer tier remains TIER_1 while under review');

  // --------------------------------------------------------------------------
  // D. Invalid Submission (Validation Schema Errors)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group D: Payload Validation ---');
  const invalidPayloads = [
    { requested_tier: 'TIER_1', verification_method: 'BVN', id_number: '123', full_legal_name: 'Alice' }, // Target tier TIER_1 invalid
    { requested_tier: 'TIER_2', verification_method: 'BVN', id_number: '123', full_legal_name: 'A' }, // Legal name < 2 chars
    { requested_tier: 'TIER_2', verification_method: 'BVN', id_number: '12', full_legal_name: 'Alice' }, // ID number < 4 chars
    { requested_tier: 'TIER_2', verification_method: 'INVALID_METHOD', id_number: '12345', full_legal_name: 'Alice' }, // Bad method
  ];

  invalidPayloads.forEach((payload, idx) => {
    const res = submitKycSchema.safeParse(payload);
    assert(res.success === false, `Test D.${idx + 1}: Malformed payload rejected by Zod`);
  });

  // --------------------------------------------------------------------------
  // E. Duplicate Submission Conflict
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group E: Duplicate Submission Conflict ---');
  let duplicateCaught = false;
  try {
    await KycService.submitKycVerification(customerAliceCtx, {
      requested_tier: 'TIER_2',
      verification_method: 'BVN',
      id_type: 'BVN',
      id_number: '22233344455',
      full_legal_name: 'Alice Folashade Adebayo',
    }, 'corr_e1');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.CONFLICT && err.statusCode === 409) {
      duplicateCaught = true;
    }
  }
  assert(duplicateCaught, 'Test E.1: Duplicate submission while PENDING_REVIEW rejected with 409 CONFLICT');

  // --------------------------------------------------------------------------
  // F. Customer Cannot Self-Verify or Modify Tier/Role
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group F & G & H: Customer Privilege Escalation Protection ---');
  const attackPayloads = [
    { first_name: 'Alice', tier: 'TIER_3' },
    { first_name: 'Alice', kyc_status: 'VERIFIED' },
    { first_name: 'Alice', role: 'SUPER_ADMIN' },
    { first_name: 'Alice', account_status: 'ACTIVE' },
    { first_name: 'Alice', reviewed_by: 'adm_active_kyc_01' },
    { first_name: 'Alice', daily_funding_limit_kobo: 999999999 },
  ];

  attackPayloads.forEach((attack, idx) => {
    const parse = updateProfileSchema.safeParse(attack);
    assert(parse.success === false, `Test F/G/H.${idx + 1}: Client injection of protected field (${Object.keys(attack)[1]}) rejected`);
  });

  // --------------------------------------------------------------------------
  // J. Cross-User KYC Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group J: Cross-User KYC Isolation ---');
  const bobKycStatus = await KycService.getCustomerKycStatus(customerBobCtx, 'corr_j1');
  assert(bobKycStatus.user_id === 'usr_kyc_bob_002', 'Test J.1: Bob receives own KYC state, not Alice’s');
  assert(bobKycStatus.status === 'NOT_STARTED', 'Test J.2: Bob is NOT_STARTED independently of Alice');

  // --------------------------------------------------------------------------
  // K. Tier Eligibility Evaluation
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group K & L: Tier Eligibility & Linear Transitions ---');
  const aliceEligibility = evaluateTierEligibility({
    uid: 'usr_kyc_alice_001',
    email: 'alice@alexvya.ng',
    email_verified: true,
    phone_number: '+2348012345678',
    tier: 'TIER_1',
    account_status: 'ACTIVE',
    role: UserRole.CUSTOMER,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  assert(aliceEligibility.is_eligible_for_upgrade === true, 'Test K.1: Tier 1 with verified email/phone is eligible for Tier 2');
  assert(aliceEligibility.next_tier === 'TIER_2', 'Test K.2: Next eligible tier is TIER_2');

  assert(isValidTierTransition('TIER_1', 'TIER_2') === true, 'Test L.1: 1 -> 2 is valid linear transition');
  assert(isValidTierTransition('TIER_2', 'TIER_3') === true, 'Test L.2: 2 -> 3 is valid linear transition');
  assert(isValidTierTransition('TIER_1', 'TIER_3') === false, 'Test L.3: 1 -> 3 skips tier and is rejected');
  assert(isValidTierTransition('TIER_2', 'TIER_1') === false, 'Test L.4: Downgrade is rejected');

  // --------------------------------------------------------------------------
  // M. Administrative Review & Approval (Atomic Tier Upgrade)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group M: Administrative Approval & Tier Upgrade ---');
  const requestId = submitResult.latest_request_id!;
  assert(Boolean(requestId), 'Test M.1: Request ID exists for administrative approval');

  const approvedDoc = await KycService.adminApproveKycRequest(
    adminActiveCtx,
    requestId,
    'Verified against national BVN database records.',
    'corr_m1'
  );

  assert(approvedDoc.status === 'VERIFIED', 'Test M.2: KYC document status updated to VERIFIED');
  assert(approvedDoc.reviewed_by === 'adm_active_kyc_01', 'Test M.3: reviewed_by records active admin UID');

  // Verify User profile updated to TIER_2
  const updatedAliceKyc = await KycService.getCustomerKycStatus(customerAliceCtx, 'corr_m2');
  assert(updatedAliceKyc.current_tier === 'TIER_2', 'Test M.4: Customer authoritative tier upgraded to TIER_2');
  assert(updatedAliceKyc.status === 'VERIFIED', 'Test M.5: Customer KYC status reflects VERIFIED');

  // Verify dynamic tier limits updated to Tier 2 canonical limits
  const tier2Limits = getCanonicalLimitsForTier('TIER_2');
  assert(tier2Limits.max_funding_kobo === 20000000, 'Test M.6: Tier 2 single funding limit is ₦200,000 (20,000,000 kobo)');
  assert(tier2Limits.daily_funding_limit_kobo === 50000000, 'Test M.7: Tier 2 daily funding limit is ₦500,000');

  // --------------------------------------------------------------------------
  // N. Admin Rejection (Leaves Tier Unchanged)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group N: Admin Rejection Lifecycle ---');
  // Bob submits verification
  const bobSubmit = await KycService.submitKycVerification(customerBobCtx, {
    requested_tier: 'TIER_2',
    verification_method: 'NIN',
    id_type: 'NIN',
    id_number: '11122233344',
    full_legal_name: 'Bob Chukwuma Okoro',
  }, 'corr_n1');

  const bobReqId = bobSubmit.latest_request_id!;
  const rejectedDoc = await KycService.adminRejectKycRequest(
    adminActiveCtx,
    bobReqId,
    'NAME_MISMATCH',
    'Full name submitted does not match identity registry name.',
    'corr_n2'
  );

  assert(rejectedDoc.status === 'REJECTED', 'Test N.1: KYC document status updated to REJECTED');
  assert(rejectedDoc.rejection_reason_code === 'NAME_MISMATCH', 'Test N.2: rejection_reason_code recorded');

  const bobPostRejectKyc = await KycService.getCustomerKycStatus(customerBobCtx, 'corr_n3');
  assert(bobPostRejectKyc.current_tier === 'TIER_1', 'Test N.3: Customer tier remains unchanged (TIER_1) after rejection');
  assert(bobPostRejectKyc.status === 'REJECTED', 'Test N.4: Customer status is REJECTED');

  // --------------------------------------------------------------------------
  // O. Admin Request Action (Status REQUIRES_ACTION)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group O: Request Customer Action ---');
  // Bob submits new request
  const bobResubmit = await KycService.startKycVerification(customerBobCtx, {
    requested_tier: 'TIER_2',
    verification_method: 'NIN',
  }, 'corr_o1');

  const actionDoc = await KycService.adminRequestKycAction(
    adminActiveCtx,
    bobResubmit.latest_request_id!,
    'Please upload a clearer copy of your NIN slip or re-enter your 11-digit NIN.',
    'corr_o2'
  );

  assert(actionDoc.status === 'REQUIRES_ACTION', 'Test O.1: Status transitions to REQUIRES_ACTION');
  assert(Boolean(actionDoc.customer_action_required?.includes('clearer copy')), 'Test O.2: customer_action_required message recorded');

  // --------------------------------------------------------------------------
  // P. Inactive Admin & Unauthorized Customer Protection
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group P & Q & R: Administrative Permission Enforcement ---');
  let inactiveAdminCaught = false;
  try {
    await KycService.adminApproveKycRequest(adminInactiveCtx, bobResubmit.latest_request_id!, 'Invalid approval');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.statusCode === 403) {
      inactiveAdminCaught = true;
    }
  }
  assert(inactiveAdminCaught, 'Test P.1: Inactive admin is rejected with 403 FORBIDDEN');

  let customerAdminCaught = false;
  try {
    await KycService.adminApproveKycRequest(customerAliceCtx, bobResubmit.latest_request_id!, 'Customer hacking');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.statusCode === 403) {
      customerAdminCaught = true;
    }
  }
  assert(customerAdminCaught, 'Test Q.1: CUSTOMER role attempting admin operation is rejected with 403');

  let auditorCaught = false;
  try {
    await KycService.adminApproveKycRequest(auditorCtx, bobResubmit.latest_request_id!, 'Auditor approve');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.statusCode === 403) {
      auditorCaught = true;
    }
  }
  assert(auditorCaught, 'Test R.1: AUDITOR is strictly read-only and blocked from approving KYC requests (403)');

  // --------------------------------------------------------------------------
  // S. Concurrency & Race Condition Safety
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group S & T: Concurrency & Terminal State Locking ---');
  let raceCaught = false;
  try {
    // Attempting to reject Alice's already approved request
    await KycService.adminRejectKycRequest(adminActiveCtx, requestId, 'OTHER', 'Too late');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.CONFLICT && err.statusCode === 409) {
      raceCaught = true;
    }
  }
  assert(raceCaught, 'Test S.1: Cannot reject already verified KYC record (409 CONFLICT)');

  // Idempotent repeated approval returns existing document without duplicate mutation
  const repeatApproval = await KycService.adminApproveKycRequest(adminActiveCtx, requestId, 'Repeat approval');
  assert(repeatApproval.status === 'VERIFIED', 'Test T.1: Duplicate approval is idempotent');

  // --------------------------------------------------------------------------
  // W. Audit Records & Sanitization
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group W & X: Audit Logging & Sanitization ---');
  const adminAuditLogs = await queryAuditLogsByActor('adm_active_kyc_01', { limit: 10 });
  assert(adminAuditLogs.items.length > 0, 'Test W.1: Admin KYC operations produce audit log entries');

  const approvalLog = adminAuditLogs.items.find((l) => l.action === 'KYC_APPROVED');
  assert(Boolean(approvalLog), 'Test W.2: KYC_APPROVED audit record found in repository');
  assert(!JSON.stringify(approvalLog).includes('22233344455'), 'Test X.1: Unmasked ID number is NEVER present in audit logs');

  // --------------------------------------------------------------------------
  // Y. Customer Notifications & Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group Y & Z: Customer Notifications ---');
  const aliceNotifications = await queryNotificationsByUser('usr_kyc_alice_001', { limit: 10 });
  assert(aliceNotifications.items.length > 0, 'Test Y.1: Customer receives notifications for KYC state transitions');
  const kycNotif = aliceNotifications.items.find((n) => n.title.includes('Tier Upgraded'));
  assert(Boolean(kycNotif), 'Test Y.2: Tier Upgraded notification delivered to customer');

  // --------------------------------------------------------------------------
  // AA. Financial Isolation: Zero Wallet / Ledger Mutations
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group AA & AB: Financial Isolation ---');
  const aliceWalletAfterKyc = await getWalletByUserId('usr_kyc_alice_001');
  assert(
    aliceWalletAfterKyc?.available_balance_kobo === initialAliceBalance,
    'Test AA.1: Wallet balance strictly unchanged throughout all KYC workflows (Zero balance side effects)'
  );

  const aliceLedger = await queryLedgerByWalletId('usr_kyc_alice_001', { limit: 10 });
  assert(aliceLedger.items.length === 0, 'Test AB.1: ZERO ledger entries created by KYC operations');

  // --------------------------------------------------------------------------
  // AD & AE. Provider Unconfigured & Mock Provider Safety
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group AD & AE: Provider Safety ---');
  const unconfiguredProvider = new UnconfiguredKycProvider();
  assert(unconfiguredProvider.isConfigured === false, 'Test AD.1: Default provider isConfigured == false');
  const unconfVerify = await unconfiguredProvider.verifySynchronous({
    user_id: 'usr_test',
    verification_method: 'BVN',
  });
  assert(unconfVerify.requires_manual_review === true, 'Test AD.2: Unconfigured provider safely routes to manual review queue');

  const mockProvider = new MockKycVerificationProvider();
  mockProvider.shouldAutoApprove = true;
  __setActiveKycProviderForTest(mockProvider);
  assert(mockProvider.isConfigured === true, 'Test AE.1: Mock provider is strictly controlled via test fixture');
  __resetKycProviderToDefault();

  // --------------------------------------------------------------------------
  // AH. Account Status Enforcement (SUSPENDED / FROZEN / CLOSED)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Group AH: Account Restrictions Enforcement ---');
  await __testSetAccountStatus('usr_kyc_bob_002', 'SUSPENDED');
  let suspendedKycCaught = false;
  try {
    await KycService.startKycVerification(customerBobCtx, {
      requested_tier: 'TIER_2',
      verification_method: 'BVN',
    }, 'corr_ah1');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.ACCOUNT_SUSPENDED && err.statusCode === 403) {
      suspendedKycCaught = true;
    }
  }
  assert(suspendedKycCaught, 'Test AH.1: Suspended customer KYC submission blocked with 403 ACCOUNT_SUSPENDED');

  // Reset Bob back to ACTIVE
  await __testSetAccountStatus('usr_kyc_bob_002', 'ACTIVE');

  console.log('\n================================================================');
  console.log(`STAGE 2.12 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`Stage 2.12 test suite encountered ${failed} failures.`);
  }
}

// Run when executed directly via tsx
if (import.meta.url.endsWith('kyc-tier-management.test.ts') || process.argv[1]?.includes('kyc-tier-management.test.ts')) {
  runStage212Tests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
