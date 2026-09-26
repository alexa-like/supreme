/**
 * Alexvya Platform — Stage 2.11 Automated Test Suite
 * Tests: Customer Account, Profile, Security, Limits & Settings Experience
 */

import { 
  provisionOrSyncUser, 
  updateExistingUserProfile, 
  getCustomerAccountSummary,
  getCustomerAccountStatusInfo,
  __testSetAccountStatus 
} from '../users/provisioning.ts';
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

export async function runStage211Tests() {
  console.log('\n==================================================');
  console.log('RUNNING STAGE 2.11 CUSTOMER ACCOUNT & PROFILE TESTS');
  console.log('==================================================\n');

  // Test 1: User Profile Provisioning & Structure
  const mockUser: AuthenticatedUserContext = {
    uid: 'usr_cust_stage211_001',
    email: 'chinedu.okafor@alexvya.ng',
    emailVerified: true,
    role: UserRole.CUSTOMER,
  };

  const profile = await provisionOrSyncUser(mockUser, 'corr_test_211_1');
  assert(profile.uid === 'usr_cust_stage211_001', 'Test 1.1: Document ID equals Firebase UID');
  assert(profile.email === 'chinedu.okafor@alexvya.ng', 'Test 1.2: Email is mapped correctly');
  assert(profile.account_status === 'ACTIVE', 'Test 1.3: Default status is ACTIVE');
  assert(profile.role === 'CUSTOMER', 'Test 1.4: Default role is CUSTOMER');
  assert(profile.tier === 'TIER_1', 'Test 1.5: Default tier is TIER_1');

  // Test 2: Authoritative Account Summary & Limits
  const summary = await getCustomerAccountSummary(mockUser, 'corr_test_211_2');
  assert(summary.profile.uid === 'usr_cust_stage211_001', 'Test 2.1: Summary includes safe profile');
  assert(summary.email_verified === true, 'Test 2.2: Summary includes email verification status');
  assert(summary.limits.tier === 'TIER_1', 'Test 2.3: Summary reflects KYC Tier 1');
  assert(summary.limits.min_funding_kobo === 5000, 'Test 2.4: Authoritative min funding is ₦50 (5,000 kobo)');
  assert(summary.limits.max_funding_kobo === 5000000, 'Test 2.5: Authoritative max funding is ₦50,000 (5,000,000 kobo)');
  assert(summary.limits.max_wallet_balance_kobo === 1000000000, 'Test 2.6: Authoritative max wallet balance is ₦10,000,000');
  assert(summary.limits.min_vas_purchase_kobo === 5000, 'Test 2.7: Authoritative min VAS purchase is ₦50');
  assert(summary.limits.max_vas_purchase_kobo === 10000000, 'Test 2.8: Authoritative max VAS purchase is ₦100,000');
  assert(summary.account_status_info.status === 'ACTIVE', 'Test 2.9: Status info is ACTIVE');
  assert(summary.account_status_info.is_restricted === false, 'Test 2.10: Active account is not restricted');

  // Test 3: Account Status Explanations
  const activeInfo = getCustomerAccountStatusInfo('ACTIVE');
  assert(activeInfo.message === 'Your account is active.', 'Test 3.1: Active status message');
  assert(activeInfo.is_restricted === false, 'Test 3.2: Active status is unrestricted');

  const suspendedInfo = getCustomerAccountStatusInfo('SUSPENDED');
  assert(suspendedInfo.is_restricted === true, 'Test 3.3: Suspended status is restricted');
  assert(suspendedInfo.message.includes('suspended'), 'Test 3.4: Safe suspended message');

  const frozenInfo = getCustomerAccountStatusInfo('FROZEN');
  assert(frozenInfo.is_restricted === true, 'Test 3.5: Frozen status is restricted');
  assert(frozenInfo.message.includes('restricted'), 'Test 3.6: Safe frozen message');

  const closedInfo = getCustomerAccountStatusInfo('CLOSED');
  assert(closedInfo.is_restricted === true, 'Test 3.7: Closed status is restricted');

  // Test 4: Profile Editing — Permitted Fields Update
  const validUpdatePayload = {
    first_name: 'Chinedu',
    last_name: 'Okafor',
    display_name: 'Chinedu O.',
    phone_number: '+2348031234567',
    notification_preferences: {
      email_on_wallet_credit: true,
      email_on_purchase: false,
    },
  };

  const schemaValidation = updateProfileSchema.safeParse(validUpdatePayload);
  assert(schemaValidation.success === true, 'Test 4.1: Valid profile payload passes Zod validation');

  const updatedProfile = await updateExistingUserProfile(
    'usr_cust_stage211_001',
    validUpdatePayload,
    'corr_test_211_4'
  );
  assert(updatedProfile.first_name === 'Chinedu', 'Test 4.2: First name successfully updated');
  assert(updatedProfile.last_name === 'Okafor', 'Test 4.3: Last name successfully updated');
  assert(updatedProfile.display_name === 'Chinedu O.', 'Test 4.4: Display name successfully updated');
  assert(updatedProfile.phone_number === '+2348031234567', 'Test 4.5: Phone number successfully updated');
  assert(updatedProfile.notification_preferences?.email_on_purchase === false, 'Test 4.6: Notification preferences updated');

  // Test 5: Strict Whitelist & Illicit Field Rejection
  const forbiddenPayloads = [
    { first_name: 'Chinedu', role: 'SUPER_ADMIN' },
    { first_name: 'Chinedu', tier: 'TIER_3' },
    { first_name: 'Chinedu', account_status: 'ACTIVE' },
    { first_name: 'Chinedu', uid: 'usr_hacked_uid' },
    { first_name: 'Chinedu', available_balance_kobo: 999999999 },
    { first_name: 'Chinedu', wallet: { balance: 1000000 } },
    { first_name: 'Chinedu', email_verified: true },
    { first_name: 'Chinedu', daily_funding_limit_kobo: 999999999 },
  ];

  forbiddenPayloads.forEach((payload, idx) => {
    const result = updateProfileSchema.safeParse(payload);
    assert(result.success === false, `Test 5.${idx + 1}: Illicit field modification (${Object.keys(payload)[1]}) strictly rejected`);
  });

  // Test 6: Strict Phone Number Format Validation
  const validPhones = ['+2348012345678', '+2347098765432', '08012345678', '09012345678', '08123456789'];
  validPhones.forEach((phone, idx) => {
    const result = updateProfileSchema.safeParse({ phone_number: phone });
    assert(result.success === true, `Test 6.${idx + 1}: Valid phone ${phone} accepted`);
  });

  const invalidPhones = ['123456', '+15551234567', '080123', 'invalid_phone', '+2341234567890123'];
  invalidPhones.forEach((phone, idx) => {
    const result = updateProfileSchema.safeParse({ phone_number: phone });
    assert(result.success === false, `Test 6.${validPhones.length + idx + 1}: Invalid phone ${phone} rejected`);
  });

  // Test 7: Enforce Account Restrictions on Updates
  await __testSetAccountStatus('usr_cust_stage211_001', 'SUSPENDED');
  let suspendedUpdateCaught = false;
  try {
    await updateExistingUserProfile(
      'usr_cust_stage211_001',
      { first_name: 'Malicious' },
      'corr_test_211_7'
    );
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.ACCOUNT_SUSPENDED && err.statusCode === 403) {
      suspendedUpdateCaught = true;
    }
  }
  assert(suspendedUpdateCaught, 'Test 7.1: Suspended account profile update rejected with 403 ACCOUNT_SUSPENDED');

  // Reset back to ACTIVE
  await __testSetAccountStatus('usr_cust_stage211_001', 'ACTIVE');

  // Test 8: Non-Existent User Error Handling
  let missingUserCaught = false;
  try {
    await updateExistingUserProfile(
      'usr_non_existent_uid_999',
      { first_name: 'Ghost' },
      'corr_test_211_8'
    );
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.statusCode === 404) {
      missingUserCaught = true;
    }
  }
  assert(missingUserCaught, 'Test 8: Non-existent user profile update returns 404 error');

  console.log('\n==================================================');
  console.log(`STAGE 2.11 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    throw new Error(`Stage 2.11 test suite encountered ${failed} failures.`);
  }
}

// Run when executed directly via tsx
if (import.meta.url.endsWith('customer-account-profile.test.ts') || process.argv[1]?.includes('customer-account-profile.test.ts')) {
  runStage211Tests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
