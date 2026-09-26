/**
 * Alexvya Platform — Stage 2.3 Automated Test Suite
 * Tests: User Provisioning, Token Verification, Account Status & Profile Security
 */

import { provisionOrSyncUser, updateExistingUserProfile, __testSetAccountStatus } from '../users/provisioning.ts';
import { updateProfileSchema } from '../../lib/validation/profile.ts';
import { AuthenticatedUserContext } from '../../types/api.ts';
import { UserRole } from '../../types/enums.ts';
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

export async function runStage23Tests() {
  console.log('\n==================================================');
  console.log('RUNNING STAGE 2.3 AUTHENTICATION & PROVISIONING TESTS');
  console.log('==================================================\n');

  // Test 1: New Email User Provisioning
  const mockEmailUser: AuthenticatedUserContext = {
    uid: 'usr_test_email_001',
    email: 'testuser@alexvya.ng',
    emailVerified: false,
    role: UserRole.CUSTOMER,
  };

  const newProfile = await provisionOrSyncUser(mockEmailUser, 'corr_test_001');
  assert(newProfile.uid === 'usr_test_email_001', 'Test 1.1: Document ID matches Firebase UID');
  assert(newProfile.email === 'testuser@alexvya.ng', 'Test 1.2: Email is mapped correctly');
  assert(newProfile.account_status === 'ACTIVE', 'Test 1.3: Default account status is ACTIVE');
  assert(newProfile.role === 'CUSTOMER', 'Test 1.4: Default role is CUSTOMER');
  assert(newProfile.tier === 'TIER_1', 'Test 1.5: Default tier is TIER_1');
  assert(newProfile.email_verified === false, 'Test 1.6: Email verified state preserved');

  // Test 2: Idempotent Re-provisioning / Existing User Sync
  const reSyncContext: AuthenticatedUserContext = {
    uid: 'usr_test_email_001',
    email: 'testuser@alexvya.ng',
    emailVerified: true, // User verified email since last login
    role: UserRole.CUSTOMER,
  };

  const syncedProfile = await provisionOrSyncUser(reSyncContext, 'corr_test_002');
  assert(syncedProfile.uid === 'usr_test_email_001', 'Test 2.1: UID preserved on repeated sync');
  assert(syncedProfile.email_verified === true, 'Test 2.2: Email verified status synchronized');
  assert(syncedProfile.account_status === 'ACTIVE', 'Test 2.3: Account status not overwritten');

  // Test 3: Google User Provisioning
  const mockGoogleUser: AuthenticatedUserContext = {
    uid: 'usr_test_google_002',
    email: 'googleuser@gmail.com',
    emailVerified: true,
    role: UserRole.CUSTOMER,
  };

  const googleProfile = await provisionOrSyncUser(mockGoogleUser, 'corr_test_003');
  assert(googleProfile.uid === 'usr_test_google_002', 'Test 3.1: Google user provisioned with Firebase UID');
  assert(googleProfile.email_verified === true, 'Test 3.2: Google email_verified is true');

  // Test 4: Account Status Enforcement — SUSPENDED
  await __testSetAccountStatus('usr_test_email_001', 'SUSPENDED');
  let suspendedCaught = false;
  try {
    await provisionOrSyncUser(reSyncContext, 'corr_test_004');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.ACCOUNT_SUSPENDED && err.statusCode === 403) {
      suspendedCaught = true;
    }
  }
  assert(suspendedCaught, 'Test 4: SUSPENDED account access rejected with 403 ACCOUNT_SUSPENDED');

  // Test 5: Account Status Enforcement — FROZEN & CLOSED
  await __testSetAccountStatus('usr_test_email_001', 'FROZEN');
  let frozenCaught = false;
  try {
    await provisionOrSyncUser(reSyncContext, 'corr_test_005');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.statusCode === 403) {
      frozenCaught = true;
    }
  }
  assert(frozenCaught, 'Test 5.1: FROZEN account access rejected with 403 FORBIDDEN');

  await __testSetAccountStatus('usr_test_email_001', 'CLOSED');
  let closedCaught = false;
  try {
    await provisionOrSyncUser(reSyncContext, 'corr_test_006');
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.statusCode === 403) {
      closedCaught = true;
    }
  }
  assert(closedCaught, 'Test 5.2: CLOSED account access rejected with 403 FORBIDDEN');

  // Reset to ACTIVE for update tests
  await __testSetAccountStatus('usr_test_email_001', 'ACTIVE');

  // Test 6: Profile Update with Allowed Fields
  const allowedUpdatePayload = {
    first_name: 'Babajide',
    last_name: 'Sanwo',
    display_name: 'Babajide S.',
    phone_number: '+2348012345678',
  };

  const parsedAllowed = updateProfileSchema.safeParse(allowedUpdatePayload);
  assert(parsedAllowed.success === true, 'Test 6.1: Allowed profile fields pass validation');

  const updatedProfile = await updateExistingUserProfile(
    'usr_test_email_001',
    allowedUpdatePayload,
    'corr_test_007'
  );
  assert(updatedProfile.first_name === 'Babajide', 'Test 6.2: first_name updated');
  assert(updatedProfile.last_name === 'Sanwo', 'Test 6.3: last_name updated');
  assert(updatedProfile.phone_number === '+2348012345678', 'Test 6.4: phone_number updated');

  // Test 7: Profile Update Rejecting Protected Fields
  const illicitUpdatePayload = {
    first_name: 'Babajide',
    role: 'SUPER_ADMIN', // FORBIDDEN
    account_status: 'ACTIVE', // FORBIDDEN
    wallet: { balance: 999999999 }, // FORBIDDEN
  };

  const illicitParse = updateProfileSchema.safeParse(illicitUpdatePayload);
  assert(illicitParse.success === false, 'Test 7: Illicit modification of protected fields rejected by schema');

  console.log('\n==================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    throw new Error(`Stage 2.3 test suite encountered ${failed} failures.`);
  }
}

// Run when executed directly via tsx
if (import.meta.url.endsWith('auth-provisioning.test.ts') || process.argv[1]?.includes('auth-provisioning.test.ts')) {
  runStage23Tests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
