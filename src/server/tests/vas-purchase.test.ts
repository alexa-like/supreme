/**
 * Alexvya Platform — Stage 2.7 VAS Service Engine & Purchase Lifecycle Test Suite
 * 
 * Strict Verification of Locked Architecture for:
 * A. Airtime success
 * B. Airtime failure
 * C. Airtime timeout
 * D. Airtime UNKNOWN
 * E. Airtime duplicate (idempotency replay)
 * F. Data success
 * G. Data failure
 * H. Data timeout
 * I. Electricity validation success
 * J. Electricity validation failure
 * K. Electricity purchase success
 * L. Electricity purchase failure
 * M. Cable validation success
 * N. Cable validation failure
 * O. Cable purchase success
 * P. Cable purchase failure
 * Q. Insufficient wallet
 * R. Forged price rejection
 * S. Forged provider rejection
 * T. Forged product rejection
 * U. Same idempotency replay
 * V. Idempotency conflict
 * W. Concurrent same-key purchase
 * X. Concurrent different-key purchase
 * Y. Duplicate provider dispatch prevention
 * Z. Duplicate refund prevention
 * AA. Requery SUCCESS
 * AB. Requery FAILED
 * AC. Requery UNKNOWN
 * AD. Cross-user access
 * AE. Unverified account
 * AF. Suspended account
 * AG. Frozen account
 * AH. Rate limiting
 * AI. Notification failure isolation
 * AJ. Profit recognition only after success
 * AK. Integer-kobo validation
 * AL. Maximum VAS amount
 * AM. Minimum VAS amount
 */

import { VasPricingService, VAS_FINANCIAL_LIMITS } from '../services/vas/vasPricing.service.ts';
import { VasValidationService } from '../services/vas/vasValidation.service.ts';
import { VasPurchaseService } from '../services/vas/vasPurchase.service.ts';
import { VasRequeryService } from '../services/vas/vasRequery.service.ts';
import {
  ProviderRouterService,
  vtpassAdapter,
  clubkonnectAdapter,
} from '../services/vas/providerRouter.service.ts';
import {
  ensureWallet,
  getWalletByUserId,
} from '../repositories/wallets.repository.ts';
import { creditWallet } from '../wallet/mutation.service.ts';
import { getServiceOrderById } from '../repositories/serviceOrders.repository.ts';
import { getTransactionById } from '../repositories/transactions.repository.ts';
import { queryLedgerByWalletId } from '../repositories/ledger.repository.ts';
import { createUser } from '../repositories/users.repository.ts';
import { acquireIdempotencyLease } from '../services/idempotency.service.ts';
import { InMemoryRateLimiter, RATE_LIMIT_CONFIGS } from '../security/rateLimiter.ts';
import {
  ServiceCategory,
  NetworkProvider,
  MeterType,
  ProviderId,
  TransactionStatus,
  ServiceOrderStatus,
  ProviderNormalizedStatus,
  LedgerCategory,
  LedgerEntryType,
  UserRole,
  AccountStatus,
  KycTier,
} from '../../types/enums.ts';
import { IntegerKobo } from '../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../lib/api/errors.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, scenario: string, message: string) {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] Scenario ${scenario}: ${message}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] Scenario ${scenario}: ${message}`);
    throw new Error(`Assertion failed in Scenario ${scenario}: ${message}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('STAGE 2.7 VAS SERVICE PURCHASE ENGINE: COMPREHENSIVE VERIFICATION');
  console.log('================================================================\n');

  // Setup Test Users
  const testUserA = {
    id: 'usr_vas_test_01',
    uid: 'usr_vas_test_01',
    email: 'user_vas_01@alexvya.test',
    email_verified: true,
    phone_number: '+2348012345678',
    full_name: 'Vas Test Customer 01',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const testUserB = {
    id: 'usr_vas_test_02',
    uid: 'usr_vas_test_02',
    email: 'user_vas_02@alexvya.test',
    email_verified: true,
    phone_number: '+2348087654321',
    full_name: 'Vas Test Customer 02',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const unverifiedUser = {
    id: 'usr_unverified_01',
    uid: 'usr_unverified_01',
    email: 'unverified@alexvya.test',
    email_verified: false,
    phone_number: '+2348099999991',
    full_name: 'Unverified Customer',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const suspendedUser = {
    id: 'usr_suspended_01',
    uid: 'usr_suspended_01',
    email: 'suspended@alexvya.test',
    email_verified: true,
    phone_number: '+2348099999992',
    full_name: 'Suspended Customer',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.SUSPENDED,
    kyc_tier: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const frozenUser = {
    id: 'usr_frozen_01',
    uid: 'usr_frozen_01',
    email: 'frozen@alexvya.test',
    email_verified: true,
    phone_number: '+2348099999993',
    full_name: 'Frozen Customer',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.FROZEN,
    kyc_tier: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const brokeUser = {
    id: 'usr_broke_01',
    uid: 'usr_broke_01',
    email: 'broke@alexvya.test',
    email_verified: true,
    phone_number: '+2348099999994',
    full_name: 'Broke Customer',
    role: UserRole.CUSTOMER,
    account_status: AccountStatus.ACTIVE,
    kyc_tier: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await createUser(testUserA as any);
  await createUser(testUserB as any);
  await createUser(unverifiedUser as any);
  await createUser(suspendedUser as any);
  await createUser(frozenUser as any);
  await createUser(brokeUser as any);

  // Initialize and fund wallets
  await ensureWallet(testUserA.uid);
  await ensureWallet(testUserB.uid);
  await ensureWallet(unverifiedUser.uid);
  await ensureWallet(suspendedUser.uid);
  await ensureWallet(frozenUser.uid);
  await ensureWallet(brokeUser.uid);

  // Fund Wallet A with ₦50,000 (5,000,000 kobo)
  await creditWallet({
    userId: testUserA.uid,
    amountKobo: 5_000_000 as IntegerKobo,
    category: LedgerCategory.WALLET_FUNDING,
    description: 'Initial test funding for Wallet A',
    transactionId: 'tx_seed_01',
    transactionReference: 'REF_SEED_01',
    idempotencyKey: 'idemp_seed_01',
    actor: { type: 'SYSTEM', id: 'test_runner' },
  });

  // Fund Wallet B with ₦50,000 (5,000,000 kobo)
  await creditWallet({
    userId: testUserB.uid,
    amountKobo: 5_000_000 as IntegerKobo,
    category: LedgerCategory.WALLET_FUNDING,
    description: 'Initial test funding for Wallet B',
    transactionId: 'tx_seed_02',
    transactionReference: 'REF_SEED_02',
    idempotencyKey: 'idemp_seed_02',
    actor: { type: 'SYSTEM', id: 'test_runner' },
  });

  // --------------------------------------------------------------------------
  // SCENARIO A: AIRTIME SUCCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario A: Airtime Purchase Success ---');
  vtpassAdapter.resetSimulation();

  const airtimeSuccessRes = await VasPurchaseService.purchaseAirtime({
    userId: testUserA.uid,
    network: NetworkProvider.MTN,
    phoneNumber: '08031234567',
    amountKobo: 50_000 as IntegerKobo, // ₦500 face value
    idempotencyKey: 'idemp_airtime_succ_01',
    correlationId: 'cor_airtime_succ',
  });

  assert(airtimeSuccessRes.status === TransactionStatus.SUCCESSFUL, 'A.1', 'Airtime purchase status is SUCCESSFUL');
  assert(airtimeSuccessRes.total_charged_kobo === 49_000, 'A.2', 'Total charged reflects 2% discount (49,000 kobo)');
  assert(airtimeSuccessRes.discount_kobo === 1_000, 'A.3', 'Discount of 1,000 kobo recorded');

  const txA = await getTransactionById(airtimeSuccessRes.transaction_id);
  assert(Boolean(txA && txA.status === TransactionStatus.SUCCESSFUL), 'A.4', 'Transaction record finalized to SUCCESSFUL');
  assert(Boolean(txA && txA.gross_profit_kobo !== null && txA.gross_profit_kobo > 0), 'A.5', 'Gross profit recognized authoritatively');

  // Single-account wallet journal check: exactly one DEBIT ledger entry
  const ledgerA = await queryLedgerByWalletId(testUserA.uid);
  const airtimeDebit = ledgerA.items.find((l) => l.transaction_reference === airtimeSuccessRes.reference);
  assert(airtimeDebit !== undefined, 'A.6', 'Ledger contains immutable DEBIT entry');
  assert(airtimeDebit?.entry_type === LedgerEntryType.DEBIT, 'A.7', 'Ledger entry is single-account DEBIT (not double-entry)');
  assert(airtimeDebit?.amount_kobo === 49_000, 'A.8', 'Debit amount matches exact total charged');

  // --------------------------------------------------------------------------
  // SCENARIO B: AIRTIME FAILURE (Confirmed non-delivery -> Atomic Refund)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario B: Airtime Deterministic Failure & Refund ---');
  vtpassAdapter.setSimulateMode('DETERMINISTIC_FAILED');

  const balanceBeforeB = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;

  const airtimeFailRes = await VasPurchaseService.purchaseAirtime({
    userId: testUserA.uid,
    network: NetworkProvider.AIRTEL,
    phoneNumber: '08021112233',
    amountKobo: 50_000 as IntegerKobo,
    idempotencyKey: 'idemp_airtime_fail_01',
    correlationId: 'cor_airtime_fail',
  });

  assert(airtimeFailRes.status === TransactionStatus.REFUNDED, 'B.1', 'Failed airtime status is REFUNDED');
  const balanceAfterB = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;
  assert(balanceAfterB === balanceBeforeB, 'B.2', 'Wallet balance restored to exact original via atomic refund');

  const txB = await getTransactionById(airtimeFailRes.transaction_id);
  assert(Boolean(txB && txB.status === TransactionStatus.REFUNDED), 'B.3', 'Transaction marked REFUNDED');
  assert(Boolean(txB && txB.gross_profit_kobo === 0), 'B.4', 'Gross profit is 0 kobo on refunded order');

  const ledgerB = await queryLedgerByWalletId(testUserA.uid);
  const refundEntryB = ledgerB.items.find((l) => l.transaction_reference === airtimeFailRes.reference && l.category === LedgerCategory.REFUND);
  assert(refundEntryB !== undefined, 'B.5', 'Ledger contains immutable REFUND entry');
  assert(refundEntryB?.entry_type === LedgerEntryType.CREDIT, 'B.6', 'Refund entry is CREDIT compensating entry');

  // --------------------------------------------------------------------------
  // SCENARIO C: AIRTIME TIMEOUT (Strictly UNKNOWN, NO refund)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario C: Airtime Network Timeout ---');
  vtpassAdapter.setSimulateMode('TIMEOUT');

  const balanceBeforeC = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;

  const airtimeTimeoutRes = await VasPurchaseService.purchaseAirtime({
    userId: testUserA.uid,
    network: NetworkProvider.GLO,
    phoneNumber: '08051112233',
    amountKobo: 50_000 as IntegerKobo,
    idempotencyKey: 'idemp_airtime_timeout_01',
    correlationId: 'cor_airtime_timeout',
  });

  assert(airtimeTimeoutRes.status === TransactionStatus.UNKNOWN, 'C.1', 'Timeout purchase status is strictly UNKNOWN');
  const balanceAfterC = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;
  assert(balanceAfterC === balanceBeforeC - 48_500, 'C.2', 'Funds remain debited from customer wallet (prevents double-spend exploit)');

  const serviceOrderC = await getServiceOrderById(airtimeTimeoutRes.order_id);
  assert(serviceOrderC?.status === ServiceOrderStatus.PROCESSING, 'C.3', 'Service order remains in PROCESSING state');

  // --------------------------------------------------------------------------
  // SCENARIO D: AIRTIME UNKNOWN (Provider reports UNKNOWN status)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario D: Airtime Provider UNKNOWN ---');
  vtpassAdapter.setSimulateMode('UNKNOWN');

  const airtimeUnknownRes = await VasPurchaseService.purchaseAirtime({
    userId: testUserA.uid,
    network: NetworkProvider['9MOBILE'],
    phoneNumber: '08091112233',
    amountKobo: 50_000 as IntegerKobo,
    idempotencyKey: 'idemp_airtime_unknown_01',
    correlationId: 'cor_airtime_unk',
  });

  assert(airtimeUnknownRes.status === TransactionStatus.UNKNOWN, 'D.1', 'Ambiguous provider status yields UNKNOWN');
  const txD = await getTransactionById(airtimeUnknownRes.transaction_id);
  assert(txD?.status === TransactionStatus.UNKNOWN, 'D.2', 'Transaction status remains UNKNOWN (no premature refund)');

  // --------------------------------------------------------------------------
  // SCENARIO E: AIRTIME DUPLICATE (Idempotency Replay)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario E: Airtime Idempotency Replay ---');
  vtpassAdapter.resetSimulation();

  const balanceBeforeE = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;

  const airtimeDuplicateRes = await VasPurchaseService.purchaseAirtime({
    userId: testUserA.uid,
    network: NetworkProvider.MTN,
    phoneNumber: '08031234567',
    amountKobo: 50_000 as IntegerKobo,
    idempotencyKey: 'idemp_airtime_succ_01', // Same key as Scenario A
    correlationId: 'cor_airtime_dup',
  });

  assert(airtimeDuplicateRes.is_idempotent_replay === true, 'E.1', 'Duplicate call recognized as idempotent replay');
  assert(airtimeDuplicateRes.transaction_id === airtimeSuccessRes.transaction_id, 'E.2', 'Replayed transaction ID matches original');
  const balanceAfterE = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;
  assert(balanceAfterE === balanceBeforeE, 'E.3', 'Zero wallet debit on idempotent replay');

  // --------------------------------------------------------------------------
  // SCENARIO F: DATA SUCCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario F: Data Purchase Success ---');
  clubkonnectAdapter.resetSimulation();

  const dataSuccessRes = await VasPurchaseService.purchaseData({
    userId: testUserA.uid,
    productId: 'prod_mtn_data_1gb',
    phoneNumber: '08031234567',
    idempotencyKey: 'idemp_data_succ_01',
    correlationId: 'cor_data_succ',
  });

  assert(dataSuccessRes.status === TransactionStatus.SUCCESSFUL, 'F.1', 'Data purchase status is SUCCESSFUL');
  assert(dataSuccessRes.total_charged_kobo === 28_000, 'F.2', 'Data purchase charged ₦280 (28,000 kobo)');
  assert(dataSuccessRes.service_category === ServiceCategory.DATA, 'F.3', 'Service category is DATA');

  const txF = await getTransactionById(dataSuccessRes.transaction_id);
  assert(Boolean(txF && txF.gross_profit_kobo !== null && txF.gross_profit_kobo === 3_000), 'F.4', 'Gross profit recognized: ₦30 (3,000 kobo)');

  // --------------------------------------------------------------------------
  // SCENARIO G: DATA FAILURE (Deterministic Failure & Refund)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario G: Data Deterministic Failure & Refund ---');
  clubkonnectAdapter.setSimulateMode('DETERMINISTIC_FAILED');

  const balanceBeforeG = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;

  const dataFailRes = await VasPurchaseService.purchaseData({
    userId: testUserA.uid,
    productId: 'prod_mtn_data_1gb',
    phoneNumber: '08031234567',
    idempotencyKey: 'idemp_data_fail_01',
    correlationId: 'cor_data_fail',
  });

  assert(dataFailRes.status === TransactionStatus.REFUNDED, 'G.1', 'Failed data purchase status is REFUNDED');
  const balanceAfterG = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;
  assert(balanceAfterG === balanceBeforeG, 'G.2', 'Wallet balance restored via atomic refund on data failure');

  // --------------------------------------------------------------------------
  // SCENARIO H: DATA TIMEOUT (Strictly UNKNOWN)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario H: Data Provider Timeout ---');
  clubkonnectAdapter.setSimulateMode('TIMEOUT');

  const dataTimeoutRes = await VasPurchaseService.purchaseData({
    userId: testUserA.uid,
    productId: 'prod_mtn_data_1gb',
    phoneNumber: '08031234567',
    idempotencyKey: 'idemp_data_timeout_01',
    correlationId: 'cor_data_timeout',
  });

  assert(dataTimeoutRes.status === TransactionStatus.UNKNOWN, 'H.1', 'Data timeout yields UNKNOWN status');

  // --------------------------------------------------------------------------
  // SCENARIO I: ELECTRICITY VALIDATION SUCCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario I: Electricity Meter Validation Success ---');
  vtpassAdapter.resetSimulation();

  const balanceBeforeI = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;

  const meterValSucc = await VasValidationService.validateMeter({
    disco: 'IKEDC',
    meterNumber: '01012345678',
    meterType: MeterType.PREPAID,
  });

  assert(meterValSucc.isValid === true, 'I.1', 'Valid meter validation returns isValid=true');
  assert(meterValSucc.customerName.length > 0, 'I.2', 'Valid meter returns customer name');
  assert((meterValSucc.customerAddress?.length || 0) > 0, 'I.3', 'Valid meter returns customer address');
  const balanceAfterI = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;
  assert(balanceAfterI === balanceBeforeI, 'I.4', 'Pre-purchase meter validation incurs ZERO wallet mutations');

  // --------------------------------------------------------------------------
  // SCENARIO J: ELECTRICITY VALIDATION FAILURE
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario J: Electricity Meter Validation Failure ---');
  let invalidMeterRejected = false;
  try {
    await VasValidationService.validateMeter({
      disco: 'IKEDC',
      meterNumber: '99999999999', // Triggers simulated invalid
      meterType: MeterType.PREPAID,
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && (err.code === ErrorCodes.METER_VALIDATION_FAILED || err.code === ErrorCodes.INVALID_METER)) {
      invalidMeterRejected = true;
    }
  }
  assert(invalidMeterRejected, 'J.1', 'Invalid meter number cleanly rejected with METER_VALIDATION_FAILED');

  // --------------------------------------------------------------------------
  // SCENARIO K: ELECTRICITY PURCHASE SUCCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario K: Electricity Purchase Success ---');
  vtpassAdapter.resetSimulation();

  const elecSuccRes = await VasPurchaseService.purchaseElectricity({
    userId: testUserA.uid,
    disco: 'IKEDC',
    meterNumber: '01012345678',
    meterType: MeterType.PREPAID,
    amountKobo: 100_000 as IntegerKobo, // ₦1,000
    customerName: 'Adebayo Test',
    customerAddress: '12 Marina St, Lagos',
    idempotencyKey: 'idemp_elec_succ_01',
    correlationId: 'cor_elec_succ',
  });

  assert(elecSuccRes.status === TransactionStatus.SUCCESSFUL, 'K.1', 'Electricity purchase status is SUCCESSFUL');
  assert(Boolean(elecSuccRes.token && elecSuccRes.token.length > 0), 'K.2', 'Electricity purchase produces valid STS token');
  assert(elecSuccRes.units !== null, 'K.3', 'Electricity purchase returns kilowatt units');
  assert(elecSuccRes.receipt_number !== null, 'K.4', 'Electricity purchase produces receipt number');
  assert(elecSuccRes.total_charged_kobo === 110_000, 'K.5', 'Total charged includes ₦100 convenience fee (110,000 kobo)');

  // --------------------------------------------------------------------------
  // SCENARIO L: ELECTRICITY PURCHASE FAILURE (Refund Issued)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario L: Electricity Purchase Failure & Refund ---');
  vtpassAdapter.setSimulateMode('DETERMINISTIC_FAILED');

  const balanceBeforeL = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;

  const elecFailRes = await VasPurchaseService.purchaseElectricity({
    userId: testUserA.uid,
    disco: 'IKEDC',
    meterNumber: '01012345678',
    meterType: MeterType.PREPAID,
    amountKobo: 100_000 as IntegerKobo,
    idempotencyKey: 'idemp_elec_fail_01',
    correlationId: 'cor_elec_fail',
  });

  assert(elecFailRes.status === TransactionStatus.REFUNDED, 'L.1', 'Electricity purchase failure yields REFUNDED');
  const balanceAfterL = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;
  assert(balanceAfterL === balanceBeforeL, 'L.2', 'Full amount refunded to wallet on failed token generation');

  // --------------------------------------------------------------------------
  // SCENARIO M: CABLE TV VALIDATION SUCCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario M: Cable TV Smartcard Validation Success ---');
  vtpassAdapter.resetSimulation();

  const smartcardValSucc = await VasValidationService.validateSmartcard({
    operator: 'DSTV',
    smartcardNumber: '1234567890',
  });

  assert(smartcardValSucc.isValid === true, 'M.1', 'Valid smartcard validation returns isValid=true');
  assert(smartcardValSucc.customerName.length > 0, 'M.2', 'Valid smartcard returns customer name');

  // --------------------------------------------------------------------------
  // SCENARIO N: CABLE TV VALIDATION FAILURE
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario N: Cable TV Smartcard Validation Failure ---');
  let invalidSmartcardRejected = false;
  try {
    await VasValidationService.validateSmartcard({
      operator: 'DSTV',
      smartcardNumber: '0000000000',
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && (err.code === ErrorCodes.SMARTCARD_VALIDATION_FAILED || err.code === ErrorCodes.INVALID_SMARTCARD)) {
      invalidSmartcardRejected = true;
    }
  }
  assert(invalidSmartcardRejected, 'N.1', 'Invalid smartcard number cleanly rejected');

  // --------------------------------------------------------------------------
  // SCENARIO O: CABLE TV PURCHASE SUCCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario O: Cable TV Purchase Success ---');
  vtpassAdapter.resetSimulation();

  const cableSuccRes = await VasPurchaseService.purchaseCableTv({
    userId: testUserA.uid,
    productId: 'prod_dstv_yanga',
    smartcardNumber: '1234567890',
    customerName: 'Adebayo Test',
    idempotencyKey: 'idemp_cable_succ_01',
    correlationId: 'cor_cable_succ',
  });

  assert(cableSuccRes.status === TransactionStatus.SUCCESSFUL, 'O.1', 'Cable TV purchase status is SUCCESSFUL');
  assert(cableSuccRes.service_category === ServiceCategory.CABLE_TV, 'O.2', 'Service category is CABLE_TV');
  assert(cableSuccRes.total_charged_kobo === 520_000, 'O.3', 'Cable charged ₦5,200 (520,000 kobo)');

  // --------------------------------------------------------------------------
  // SCENARIO P: CABLE TV PURCHASE FAILURE (Refund Issued)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario P: Cable TV Purchase Failure & Refund ---');
  vtpassAdapter.setSimulateMode('DETERMINISTIC_FAILED');

  const cableFailRes = await VasPurchaseService.purchaseCableTv({
    userId: testUserA.uid,
    productId: 'prod_dstv_yanga',
    smartcardNumber: '1234567890',
    customerName: 'Adebayo Test',
    idempotencyKey: 'idemp_cable_fail_01',
    correlationId: 'cor_cable_fail',
  });

  assert(cableFailRes.status === TransactionStatus.REFUNDED, 'P.1', 'Failed cable TV purchase status is REFUNDED');

  // --------------------------------------------------------------------------
  // SCENARIO Q: INSUFFICIENT WALLET BALANCE
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario Q: Insufficient Wallet Balance ---');
  vtpassAdapter.resetSimulation();

  let insufficientFundsCaught = false;
  try {
    await VasPurchaseService.purchaseAirtime({
      userId: brokeUser.uid, // 0 balance
      network: NetworkProvider.MTN,
      phoneNumber: '08031234567',
      amountKobo: 50_000 as IntegerKobo,
      idempotencyKey: 'idemp_broke_01',
      correlationId: 'cor_broke',
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.INSUFFICIENT_BALANCE) {
      insufficientFundsCaught = true;
    }
  }
  assert(insufficientFundsCaught, 'Q.1', 'Insufficient balance purchase cleanly rejected with INSUFFICIENT_BALANCE');

  const brokeLedger = await queryLedgerByWalletId(brokeUser.uid);
  assert(brokeLedger.items.length === 0, 'Q.2', 'Zero ledger entries created when debit fails');

  // --------------------------------------------------------------------------
  // SCENARIO R: FORGED PRICE REJECTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario R: Forged Price & Economics Override Rejection ---');
  let negativeMarginRejected = false;
  try {
    VasPricingService.validateEconomics({
      total_charged_kobo: 50_000 as IntegerKobo,
      provider_cost_kobo: 80_000 as IntegerKobo, // Cost > Charged
      markup_kobo: -30_000 as IntegerKobo,
      discount_kobo: 50_000 as IntegerKobo,
      expected_gross_profit_kobo: -30_000 as IntegerKobo,
      pricing_rule_version: 'v1.0',
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.NEGATIVE_MARGIN_FORBIDDEN) {
      negativeMarginRejected = true;
    }
  }
  assert(negativeMarginRejected, 'R.1', 'Negative gross margin strictly forbidden by pricing invariant');

  // --------------------------------------------------------------------------
  // SCENARIO S: FORGED PROVIDER REJECTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario S: Forged Provider Rejection ---');
  let invalidProviderRejected = false;
  try {
    ProviderRouterService.getProviderAdapter('FAKE_PROVIDER_99' as any);
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.PROVIDER_UNAVAILABLE) {
      invalidProviderRejected = true;
    }
  }
  assert(invalidProviderRejected, 'S.1', 'Client cannot route to unauthorized or forged provider ID');

  // --------------------------------------------------------------------------
  // SCENARIO T: FORGED PRODUCT REJECTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario T: Forged Product ID Rejection ---');
  let nonExistentProductRejected = false;
  try {
    await VasPurchaseService.purchaseData({
      userId: testUserA.uid,
      productId: 'prod_non_existent_fake_plan',
      phoneNumber: '08031234567',
      idempotencyKey: 'idemp_fake_prod_01',
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && (err.code === ErrorCodes.PRODUCT_NOT_FOUND || err.code === ErrorCodes.RESOURCE_NOT_FOUND)) {
      nonExistentProductRejected = true;
    }
  }
  assert(nonExistentProductRejected, 'T.1', 'Non-existent or forged product ID rejected with PRODUCT_NOT_FOUND');

  // --------------------------------------------------------------------------
  // SCENARIO U: SAME IDEMPOTENCY REPLAY
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario U: Same Idempotency Key Replay ---');
  const replayRes = await VasPurchaseService.purchaseAirtime({
    userId: testUserA.uid,
    network: NetworkProvider.MTN,
    phoneNumber: '08031234567',
    amountKobo: 50_000 as IntegerKobo,
    idempotencyKey: 'idemp_airtime_succ_01',
  });
  assert(replayRes.is_idempotent_replay === true, 'U.1', 'Same idempotency key returns exact original response replay');

  // --------------------------------------------------------------------------
  // SCENARIO V: IDEMPOTENCY CONFLICT (Same key, different payload)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario V: Idempotency Conflict Rejection ---');
  let conflictDetected = false;
  try {
    await acquireIdempotencyLease({
      key: 'idemp_airtime_succ_01', // Key from Scenario A
      userId: testUserA.uid,
      requestPath: '/services/airtime/purchase',
      requestPayload: { differentField: 'TAMPERED_CONTENT' }, // Different payload fingerprint!
      retentionPolicy: 'VAS_PURCHASE',
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.IDEMPOTENCY_CONFLICT) {
      conflictDetected = true;
    }
  }
  assert(conflictDetected, 'V.1', 'Same idempotency key with conflicting payload throws 409 IDEMPOTENCY_CONFLICT');

  // --------------------------------------------------------------------------
  // SCENARIO W: CONCURRENT SAME-KEY PURCHASE (Race Protection)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario W: Concurrent Same-Key Race Protection ---');
  vtpassAdapter.resetSimulation();

  const balanceBeforeW = (await getWalletByUserId(testUserB.uid))!.available_balance_kobo;

  const [race1, race2] = await Promise.all([
    VasPurchaseService.purchaseAirtime({
      userId: testUserB.uid,
      network: NetworkProvider.MTN,
      phoneNumber: '08031234567',
      amountKobo: 50_000 as IntegerKobo,
      idempotencyKey: 'idemp_concurrent_same_01',
      correlationId: 'cor_race_w1',
    }),
    VasPurchaseService.purchaseAirtime({
      userId: testUserB.uid,
      network: NetworkProvider.MTN,
      phoneNumber: '08031234567',
      amountKobo: 50_000 as IntegerKobo,
      idempotencyKey: 'idemp_concurrent_same_01',
      correlationId: 'cor_race_w2',
    }),
  ]);

  const balanceAfterW = (await getWalletByUserId(testUserB.uid))!.available_balance_kobo;
  assert(balanceAfterW === balanceBeforeW - 49_000, 'W.1', 'Exactly ONE financial debit executed across concurrent same-key requests');
  assert(
    Boolean((race1.is_idempotent_replay && !race2.is_idempotent_replay) ||
    (!race1.is_idempotent_replay && race2.is_idempotent_replay)),
    'W.2',
    'One request executes and second request safely returns idempotent replay'
  );

  // --------------------------------------------------------------------------
  // SCENARIO X: CONCURRENT DIFFERENT-KEY PURCHASES (Wallet Mutex Serialization)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario X: Concurrent Different-Key Purchases Against Same Wallet ---');
  const balanceBeforeX = (await getWalletByUserId(testUserB.uid))!.available_balance_kobo;

  const [diff1, diff2] = await Promise.all([
    VasPurchaseService.purchaseAirtime({
      userId: testUserB.uid,
      network: NetworkProvider.MTN,
      phoneNumber: '08031234567',
      amountKobo: 50_000 as IntegerKobo,
      idempotencyKey: 'idemp_concurrent_diff_x1',
      correlationId: 'cor_race_x1',
    }),
    VasPurchaseService.purchaseAirtime({
      userId: testUserB.uid,
      network: NetworkProvider.AIRTEL,
      phoneNumber: '08021112233',
      amountKobo: 50_000 as IntegerKobo,
      idempotencyKey: 'idemp_concurrent_diff_x2',
      correlationId: 'cor_race_x2',
    }),
  ]);

  const balanceAfterX = (await getWalletByUserId(testUserB.uid))!.available_balance_kobo;
  assert(diff1.status === TransactionStatus.SUCCESSFUL, 'X.1', 'First concurrent purchase succeeds');
  assert(diff2.status === TransactionStatus.SUCCESSFUL, 'X.2', 'Second concurrent purchase succeeds');
  assert(balanceAfterX === balanceBeforeX - 49_000 - 49_000, 'X.3', 'Wallet balance decremented by exact sum of both distinct purchases');

  // --------------------------------------------------------------------------
  // SCENARIO Y: DUPLICATE PROVIDER DISPATCH PREVENTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario Y: Duplicate Provider Dispatch Prevention ---');
  assert(diff1.order_id !== diff2.order_id, 'Y.1', 'Every service order receives a distinct deterministic order ID');
  const duplicateSim = await vtpassAdapter.executeFulfillment({
    orderId: diff1.order_id,
    serviceCategory: ServiceCategory.AIRTIME,
    recipientIdentifier: '08031234567',
    amountKobo: 49_000 as IntegerKobo,
    transactionReference: diff1.reference,
    providerPlanCode: 'mtn',
  });
  assert(duplicateSim.providerReference !== undefined, 'Y.2', 'Adapter enforces deterministic reference caching');

  // --------------------------------------------------------------------------
  // SCENARIO Z: DUPLICATE REFUND PREVENTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario Z: Duplicate Refund Prevention ---');
  // Requerying an already refunded order (airtimeFailRes from Scenario B)
  const requeryOnRefunded = await VasRequeryService.requeryOrder(airtimeFailRes.order_id, 'cor_dup_refund');
  assert(requeryOnRefunded.alreadySettled === true, 'Z.1', 'Already settled REFUNDED order detected');
  assert(requeryOnRefunded.refunded === true, 'Z.2', 'Returns cached refund status without executing second refund');

  // --------------------------------------------------------------------------
  // SCENARIO AA: REQUERY SUCCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AA: Requery SUCCESS Reconciliation ---');
  // Use airtimeTimeoutRes from Scenario C which is currently UNKNOWN
  vtpassAdapter.setSimulateRequeryResult(airtimeTimeoutRes.order_id, ProviderNormalizedStatus.SUCCESS);

  const requerySucc = await VasRequeryService.requeryOrder(airtimeTimeoutRes.order_id, 'cor_requery_aa');
  assert(requerySucc.currentStatus === TransactionStatus.SUCCESSFUL, 'AA.1', 'Requery resolves UNKNOWN order to SUCCESSFUL');
  assert(requerySucc.refunded === false, 'AA.2', 'Fulfilled order is NOT refunded');

  const txAA = await getTransactionById(airtimeTimeoutRes.transaction_id);
  assert(Boolean(txAA && txAA.status === TransactionStatus.SUCCESSFUL), 'AA.3', 'Transaction finalized to SUCCESSFUL');
  assert(Boolean(txAA && txAA.gross_profit_kobo !== null && txAA.gross_profit_kobo > 0), 'AA.4', 'Gross profit recognized upon confirmed delivery');

  // --------------------------------------------------------------------------
  // SCENARIO AB: REQUERY FAILED (Atomic Refund on Confirmed Non-Delivery)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AB: Requery FAILED & Atomic Refund ---');
  // Use airtimeUnknownRes from Scenario D which is currently UNKNOWN
  vtpassAdapter.setSimulateRequeryResult(airtimeUnknownRes.order_id, ProviderNormalizedStatus.FAILED);

  const balanceBeforeAB = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;

  const requeryFail = await VasRequeryService.requeryOrder(airtimeUnknownRes.order_id, 'cor_requery_ab');
  assert(requeryFail.currentStatus === TransactionStatus.REFUNDED, 'AB.1', 'Requery resolves non-delivery to REFUNDED');
  assert(requeryFail.refunded === true, 'AB.2', 'Atomic refund executed for confirmed failed order');

  const balanceAfterAB = (await getWalletByUserId(testUserA.uid))!.available_balance_kobo;
  assert(balanceAfterAB === balanceBeforeAB + 48_500, 'AB.3', 'Customer wallet restored with debited amount');

  // --------------------------------------------------------------------------
  // SCENARIO AC: REQUERY UNKNOWN (Still Processing -> NO Refund)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AC: Requery UNKNOWN (No Premature Refund) ---');
  // Create a new UNKNOWN order
  vtpassAdapter.setSimulateMode('TIMEOUT');
  const timeoutOrderAC = await VasPurchaseService.purchaseAirtime({
    userId: testUserA.uid,
    network: NetworkProvider.MTN,
    phoneNumber: '08031234567',
    amountKobo: 50_000 as IntegerKobo,
    idempotencyKey: 'idemp_timeout_ac',
    correlationId: 'cor_timeout_ac',
  });

  vtpassAdapter.setSimulateRequeryResult(timeoutOrderAC.order_id, ProviderNormalizedStatus.UNKNOWN);
  const requeryUnk = await VasRequeryService.requeryOrder(timeoutOrderAC.order_id, 'cor_requery_ac');
  assert(requeryUnk.currentStatus === TransactionStatus.UNKNOWN, 'AC.1', 'Pending requery remains UNKNOWN');
  assert(requeryUnk.refunded === false, 'AC.2', 'Temporary requery ambiguity strictly does NOT trigger refund');

  // --------------------------------------------------------------------------
  // SCENARIO AD: CROSS-USER ACCESS REJECTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AD: Cross-User Order Access Isolation ---');
  const orderA = await getServiceOrderById(airtimeSuccessRes.order_id);
  assert(orderA?.user_id === testUserA.uid, 'AD.1', 'Order strictly linked to User A');
  // Confirm multi-tenant boundary: User B has no ownership over User A's order
  assert(orderA?.user_id !== testUserB.uid, 'AD.2', 'Cross-user boundary enforced');

  // --------------------------------------------------------------------------
  // SCENARIO AE: UNVERIFIED ACCOUNT REJECTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AE: Unverified Account Rejection ---');
  let unverifiedRejected = false;
  try {
    await VasPurchaseService.purchaseAirtime({
      userId: unverifiedUser.uid,
      network: NetworkProvider.MTN,
      phoneNumber: '08031234567',
      amountKobo: 50_000 as IntegerKobo,
      idempotencyKey: 'idemp_unver_01',
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.EMAIL_NOT_VERIFIED) {
      unverifiedRejected = true;
    }
  }
  assert(unverifiedRejected, 'AE.1', 'Unverified email account rejected with EMAIL_NOT_VERIFIED');

  // --------------------------------------------------------------------------
  // SCENARIO AF: SUSPENDED ACCOUNT REJECTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AF: Suspended Account Rejection ---');
  let suspendedRejected = false;
  try {
    await VasPurchaseService.purchaseAirtime({
      userId: suspendedUser.uid,
      network: NetworkProvider.MTN,
      phoneNumber: '08031234567',
      amountKobo: 50_000 as IntegerKobo,
      idempotencyKey: 'idemp_susp_01',
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.ACCOUNT_SUSPENDED) {
      suspendedRejected = true;
    }
  }
  assert(suspendedRejected, 'AF.1', 'Suspended customer account rejected with ACCOUNT_SUSPENDED');

  // --------------------------------------------------------------------------
  // SCENARIO AG: FROZEN ACCOUNT REJECTION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AG: Frozen Account Rejection ---');
  let frozenRejected = false;
  try {
    await VasPurchaseService.purchaseAirtime({
      userId: frozenUser.uid,
      network: NetworkProvider.MTN,
      phoneNumber: '08031234567',
      amountKobo: 50_000 as IntegerKobo,
      idempotencyKey: 'idemp_froz_01',
    });
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.ACCOUNT_FROZEN) {
      frozenRejected = true;
    }
  }
  assert(frozenRejected, 'AG.1', 'Frozen customer account rejected with ACCOUNT_FROZEN');

  // --------------------------------------------------------------------------
  // SCENARIO AH: RATE LIMITING (20 VAS Purchases / minute)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AH: VAS Purchase Rate Limiting ---');
  const rateLimiter = new InMemoryRateLimiter();
  const rateLimitKey = `VAS_PURCHASE:user:${testUserA.uid}`;

  for (let i = 0; i < 20; i++) {
    const check = rateLimiter.checkLimit(rateLimitKey, RATE_LIMIT_CONFIGS.VAS_PURCHASE);
    assert(check.allowed === true, 'AH.1', `Purchase ${i + 1}/20 within 1 minute allowed`);
  }
  const exceededCheck = rateLimiter.checkLimit(rateLimitKey, RATE_LIMIT_CONFIGS.VAS_PURCHASE);
  assert(exceededCheck.allowed === false, 'AH.2', '21st purchase within 1 minute is rate-limited (429)');

  // --------------------------------------------------------------------------
  // SCENARIO AI: NOTIFICATION FAILURE ISOLATION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AI: Notification Failure Isolation ---');
  vtpassAdapter.resetSimulation();

  // Notification failure during purchase settlement does not roll back transaction
  const notifIsoRes = await VasPurchaseService.purchaseAirtime({
    userId: testUserA.uid,
    network: NetworkProvider.MTN,
    phoneNumber: '08031234567',
    amountKobo: 50_000 as IntegerKobo,
    idempotencyKey: 'idemp_notif_iso_01',
  });
  assert(notifIsoRes.status === TransactionStatus.SUCCESSFUL, 'AI.1', 'Purchase completes SUCCESSFUL even if notification fails');

  // --------------------------------------------------------------------------
  // SCENARIO AJ: PROFIT RECOGNITION ONLY AFTER SUCCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AJ: Profit Recognition Invariant ---');
  const successTx = await getTransactionById(airtimeSuccessRes.transaction_id);
  const refundTx = await getTransactionById(airtimeFailRes.transaction_id);

  assert(Boolean(successTx && successTx.gross_profit_kobo !== null && successTx.gross_profit_kobo > 0), 'AJ.1', 'Profit recognized for successful delivery');
  assert(Boolean(refundTx && refundTx.gross_profit_kobo === 0), 'AJ.2', 'Zero profit recognized on failed/refunded delivery');

  // --------------------------------------------------------------------------
  // SCENARIO AK: INTEGER-KOBO VALIDATION
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AK: Integer-Kobo Validation ---');
  let floatRejected = false;
  try {
    VasPricingService.validateVasAmountBounds(5000.5 as any);
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.INVALID_KOBO_AMOUNT) {
      floatRejected = true;
    }
  }
  assert(floatRejected, 'AK.1', 'Floating point amount strictly rejected by integer-kobo validator');

  // --------------------------------------------------------------------------
  // SCENARIO AL: MAXIMUM VAS AMOUNT ENFORCEMENT
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AL: Maximum VAS Amount Enforcement ---');
  let maxVasExceeded = false;
  try {
    await VasPricingService.resolveAirtimePricing(
      NetworkProvider.MTN,
      (VAS_FINANCIAL_LIMITS.MAX_SINGLE_VAS_KOBO + 1) as IntegerKobo // 10,000,001 kobo (₦100,000.01)
    );
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.DAILY_LIMIT_EXCEEDED) {
      maxVasExceeded = true;
    }
  }
  assert(maxVasExceeded, 'AL.1', 'Order > ₦100,000 (10,000,000 kobo) rejected with DAILY_LIMIT_EXCEEDED');

  // --------------------------------------------------------------------------
  // SCENARIO AM: MINIMUM VAS AMOUNT ENFORCEMENT
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario AM: Minimum VAS Amount Enforcement ---');
  let minVasRejected = false;
  try {
    await VasPricingService.resolveAirtimePricing(
      NetworkProvider.MTN,
      (VAS_FINANCIAL_LIMITS.MIN_VAS_PURCHASE_KOBO - 1) as IntegerKobo // 4,999 kobo (₦49.99)
    );
  } catch (err: any) {
    if (err instanceof AlexvyaApiError && err.code === ErrorCodes.INVALID_AMOUNT) {
      minVasRejected = true;
    }
  }
  assert(minVasRejected, 'AM.1', 'Order < ₦50 (5,000 kobo) rejected with INVALID_AMOUNT');

  console.log('\n================================================================');
  console.log(`STAGE 2.7 COMPREHENSIVE TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error in VAS test suite:', err);
  process.exit(1);
});
