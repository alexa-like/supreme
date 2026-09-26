/**
 * Alexvya Platform — Authoritative VAS Pricing & Product Resolution Engine
 * Stage 2.7 V1 VAS Service Purchase Engine
 * 
 * CORE ARCHITECTURAL INVARIANT:
 * THE CLIENT BROWSER NEVER DETERMINES OR MODIFIES FINANCIAL PRICING.
 * All prices, discounts, fees, provider costs, and expected gross profits
 * are resolved authoritatively on the server from the serviceProducts catalog.
 * 
 * Financial Bounds:
 * - Minimum VAS Purchase: ₦50 = 5,000 kobo
 * - Maximum Single VAS Order: ₦100,000 = 10,000,000 kobo
 * - Maximum Wallet Balance: ₦10,000,000 = 1,000,000,000 kobo
 */

import {
  getProductById,
  upsertProduct,
} from '../../repositories/serviceProducts.repository.ts';
import {
  ServiceProductDocument,
  OriginalEconomics,
} from '../../../types/firestore.ts';
import {
  ServiceCategory,
  NetworkProvider,
  MeterType,
} from '../../../types/enums.ts';
import { IntegerKobo, isSafeKobo } from '../../../types/money.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';

export const VAS_FINANCIAL_LIMITS = {
  MIN_VAS_PURCHASE_KOBO: 5000 as IntegerKobo,        // ₦50.00
  MAX_SINGLE_VAS_KOBO: 10000000 as IntegerKobo,      // ₦100,000.00
  MAX_WALLET_BALANCE_KOBO: 1000000000 as IntegerKobo, // ₦10,000,000.00
} as const;

export const PRICING_RULE_VERSION = 'v1.0';

export interface ResolvedPricingResult {
  product: ServiceProductDocument;
  economics: OriginalEconomics;
  faceValueKobo: IntegerKobo;
  totalChargedKobo: IntegerKobo;
}

export class VasPricingService {
  /**
   * Validates that requested kobo amount is a safe positive integer within locked bounds.
   */
  public static validateVasAmountBounds(amountKobo: unknown): asserts amountKobo is IntegerKobo {
    if (!isSafeKobo(amountKobo)) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_KOBO_AMOUNT,
        `Amount must be a safe, positive non-zero integer in kobo. Received: ${amountKobo}`,
        400,
        { amountKobo }
      );
    }

    if (amountKobo < VAS_FINANCIAL_LIMITS.MIN_VAS_PURCHASE_KOBO) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_AMOUNT,
        `Purchase amount of ${amountKobo} kobo (₦${(amountKobo / 100).toFixed(2)}) is below the minimum allowed VAS purchase of ₦50.00 (5,000 kobo).`,
        400,
        { amountKobo, minAllowedKobo: VAS_FINANCIAL_LIMITS.MIN_VAS_PURCHASE_KOBO }
      );
    }

    if (amountKobo > VAS_FINANCIAL_LIMITS.MAX_SINGLE_VAS_KOBO) {
      throw new AlexvyaApiError(
        ErrorCodes.DAILY_LIMIT_EXCEEDED,
        `Purchase amount of ${amountKobo} kobo (₦${(amountKobo / 100).toFixed(2)}) exceeds the maximum single VAS order limit of ₦100,000.00 (10,000,000 kobo).`,
        400,
        { amountKobo, maxAllowedKobo: VAS_FINANCIAL_LIMITS.MAX_SINGLE_VAS_KOBO }
      );
    }
  }

  /**
   * Strictly validates that gross margin is non-negative and all economics invariants hold.
   */
  public static validateEconomics(economics: OriginalEconomics): void {
    if (economics.expected_gross_profit_kobo < 0) {
      throw new AlexvyaApiError(
        ErrorCodes.NEGATIVE_MARGIN_FORBIDDEN,
        `Economics rejected: Negative gross margin (${economics.expected_gross_profit_kobo} kobo) is strictly forbidden.`,
        500,
        { economics }
      );
    }

    if (economics.total_charged_kobo < economics.provider_cost_kobo) {
      throw new AlexvyaApiError(
        ErrorCodes.NEGATIVE_MARGIN_FORBIDDEN,
        `Economics rejected: Total charged (${economics.total_charged_kobo} kobo) cannot be less than provider cost (${economics.provider_cost_kobo} kobo).`,
        500,
        { economics }
      );
    }
  }

  /**
   * Authoritatively resolves airtime pricing.
   * Discounts:
   * - MTN: 2.0% customer discount, 3.0% provider discount -> 1.0% margin
   * - AIRTEL: 2.0% customer discount, 3.5% provider discount -> 1.5% margin
   * - GLO: 3.0% customer discount, 5.0% provider discount -> 2.0% margin
   * - 9MOBILE: 3.0% customer discount, 4.5% provider discount -> 1.5% margin
   */
  public static async resolveAirtimePricing(
    network: NetworkProvider,
    requestedAmountKobo: unknown
  ): Promise<ResolvedPricingResult> {
    this.validateVasAmountBounds(requestedAmountKobo);
    const amountKobo = requestedAmountKobo as IntegerKobo;

    await this.seedDefaultProducts();

    const productId = `prod_airtime_${network.toLowerCase()}`;
    const product = await getProductById(productId);

    if (!product || !product.is_active) {
      throw new AlexvyaApiError(
        ErrorCodes.PRODUCT_DISABLED,
        `Airtime service for network '${network}' is currently unavailable.`,
        400,
        { network, productId }
      );
    }

    // Determine discounts based on network
    let customerDiscountBps = 200; // 2.0%
    let providerDiscountBps = 300; // 3.0%

    if (network === NetworkProvider.GLO) {
      customerDiscountBps = 300; // 3.0%
      providerDiscountBps = 500; // 5.0%
    } else if (network === NetworkProvider.AIRTEL) {
      customerDiscountBps = 200; // 2.0%
      providerDiscountBps = 350; // 3.5%
    } else if (network === NetworkProvider['9MOBILE']) {
      customerDiscountBps = 300; // 3.0%
      providerDiscountBps = 450; // 4.5%
    }

    const discountKobo = Math.floor((amountKobo * customerDiscountBps) / 10000) as IntegerKobo;
    const sellingPriceKobo = (amountKobo - discountKobo) as IntegerKobo;
    const providerDiscountKobo = Math.floor((amountKobo * providerDiscountBps) / 10000) as IntegerKobo;
    const providerCostKobo = (amountKobo - providerDiscountKobo) as IntegerKobo;
    const markupKobo = (sellingPriceKobo - providerCostKobo) as IntegerKobo;
    const expectedGrossProfitKobo = markupKobo;

    // Negative margin guard
    if (expectedGrossProfitKobo < 0) {
      throw new AlexvyaApiError(
        ErrorCodes.NEGATIVE_MARGIN_FORBIDDEN,
        `Airtime pricing rejected: Negative gross margin (${expectedGrossProfitKobo} kobo) detected.`,
        500,
        { sellingPriceKobo, providerCostKobo }
      );
    }

    const economics: OriginalEconomics = {
      total_charged_kobo: sellingPriceKobo,
      provider_cost_kobo: providerCostKobo,
      markup_kobo: markupKobo,
      discount_kobo: discountKobo,
      expected_gross_profit_kobo: expectedGrossProfitKobo,
      pricing_rule_version: PRICING_RULE_VERSION,
    };

    return {
      product: {
        ...product,
        face_value_kobo: amountKobo,
        selling_price_kobo: sellingPriceKobo,
        provider_cost_kobo: providerCostKobo,
      },
      economics,
      faceValueKobo: amountKobo,
      totalChargedKobo: sellingPriceKobo,
    };
  }

  /**
   * Authoritatively resolves fixed data plan pricing from serviceProducts catalog.
   * Client-submitted prices are strictly ignored and rejected.
   */
  public static async resolveDataPricing(productId: string): Promise<ResolvedPricingResult> {
    await this.seedDefaultProducts();

    const product = await getProductById(productId);
    if (!product) {
      throw new AlexvyaApiError(
        ErrorCodes.PRODUCT_NOT_FOUND,
        `Data product '${productId}' not found in catalog.`,
        404,
        { productId }
      );
    }

    if (!product.is_active) {
      throw new AlexvyaApiError(
        ErrorCodes.PRODUCT_DISABLED,
        `Data product '${product.name}' is currently deactivated.`,
        400,
        { productId }
      );
    }

    if (product.category !== ServiceCategory.DATA) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        `Product '${productId}' is not a DATA product.`,
        400,
        { productId, category: product.category }
      );
    }

    const faceValueKobo = product.face_value_kobo;
    const sellingPriceKobo = product.selling_price_kobo;
    const providerCostKobo = product.provider_cost_kobo;
    const serviceFeeKobo = product.service_fee_kobo || (0 as IntegerKobo);

    const totalChargedKobo = (sellingPriceKobo + serviceFeeKobo) as IntegerKobo;
    const discountKobo = (faceValueKobo > sellingPriceKobo ? faceValueKobo - sellingPriceKobo : 0) as IntegerKobo;
    const markupKobo = (totalChargedKobo - providerCostKobo) as IntegerKobo;
    const expectedGrossProfitKobo = markupKobo;

    // Negative margin guard
    if (expectedGrossProfitKobo < 0) {
      throw new AlexvyaApiError(
        ErrorCodes.NEGATIVE_MARGIN_FORBIDDEN,
        `Data pricing rejected: Negative gross margin (${expectedGrossProfitKobo} kobo).`,
        500,
        { totalChargedKobo, providerCostKobo }
      );
    }

    const economics: OriginalEconomics = {
      total_charged_kobo: totalChargedKobo,
      provider_cost_kobo: providerCostKobo,
      markup_kobo: markupKobo,
      discount_kobo: discountKobo,
      expected_gross_profit_kobo: expectedGrossProfitKobo,
      pricing_rule_version: PRICING_RULE_VERSION,
    };

    return {
      product,
      economics,
      faceValueKobo,
      totalChargedKobo,
    };
  }

  /**
   * Authoritatively resolves electricity bill pricing.
   * Service fee is fixed (₦100 = 10,000 kobo).
   */
  public static async resolveElectricityPricing(
    disco: string,
    meterType: MeterType,
    requestedAmountKobo: unknown
  ): Promise<ResolvedPricingResult> {
    this.validateVasAmountBounds(requestedAmountKobo);
    const amountKobo = requestedAmountKobo as IntegerKobo;

    await this.seedDefaultProducts();

    const productId = `prod_electricity_${disco.toLowerCase()}`;
    const product = await getProductById(productId);

    if (!product || !product.is_active) {
      throw new AlexvyaApiError(
        ErrorCodes.PRODUCT_DISABLED,
        `Electricity service for DISCO '${disco}' is currently unavailable.`,
        400,
        { disco, productId }
      );
    }

    const serviceFeeKobo = (product.service_fee_kobo || 10000) as IntegerKobo; // ₦100 convenience fee
    const totalChargedKobo = (amountKobo + serviceFeeKobo) as IntegerKobo;
    const providerCostKobo = amountKobo; // Provider bills face value
    const markupKobo = serviceFeeKobo;
    const expectedGrossProfitKobo = markupKobo;

    if (expectedGrossProfitKobo < 0) {
      throw new AlexvyaApiError(
        ErrorCodes.NEGATIVE_MARGIN_FORBIDDEN,
        `Electricity pricing rejected: Negative gross margin.`,
        500
      );
    }

    const economics: OriginalEconomics = {
      total_charged_kobo: totalChargedKobo,
      provider_cost_kobo: providerCostKobo,
      markup_kobo: markupKobo,
      discount_kobo: 0 as IntegerKobo,
      expected_gross_profit_kobo: expectedGrossProfitKobo,
      pricing_rule_version: PRICING_RULE_VERSION,
    };

    return {
      product: {
        ...product,
        face_value_kobo: amountKobo,
        selling_price_kobo: amountKobo,
        service_fee_kobo: serviceFeeKobo,
      },
      economics,
      faceValueKobo: amountKobo,
      totalChargedKobo,
    };
  }

  /**
   * Authoritatively resolves Cable TV bouquet pricing from serviceProducts catalog.
   */
  public static async resolveCableTvPricing(productId: string): Promise<ResolvedPricingResult> {
    await this.seedDefaultProducts();

    const product = await getProductById(productId);
    if (!product) {
      throw new AlexvyaApiError(
        ErrorCodes.PRODUCT_NOT_FOUND,
        `Cable TV product '${productId}' not found in catalog.`,
        404,
        { productId }
      );
    }

    if (!product.is_active) {
      throw new AlexvyaApiError(
        ErrorCodes.PRODUCT_DISABLED,
        `Cable package '${product.name}' is currently unavailable.`,
        400,
        { productId }
      );
    }

    if (product.category !== ServiceCategory.CABLE_TV) {
      throw new AlexvyaApiError(
        ErrorCodes.INVALID_INPUT,
        `Product '${productId}' is not a CABLE_TV product.`,
        400,
        { productId, category: product.category }
      );
    }

    const faceValueKobo = product.face_value_kobo;
    const sellingPriceKobo = product.selling_price_kobo;
    const providerCostKobo = product.provider_cost_kobo;
    const serviceFeeKobo = product.service_fee_kobo || (0 as IntegerKobo);

    const totalChargedKobo = (sellingPriceKobo + serviceFeeKobo) as IntegerKobo;
    const discountKobo = (faceValueKobo > sellingPriceKobo ? faceValueKobo - sellingPriceKobo : 0) as IntegerKobo;
    const markupKobo = (totalChargedKobo - providerCostKobo) as IntegerKobo;
    const expectedGrossProfitKobo = markupKobo;

    if (expectedGrossProfitKobo < 0) {
      throw new AlexvyaApiError(
        ErrorCodes.NEGATIVE_MARGIN_FORBIDDEN,
        `Cable TV pricing rejected: Negative gross margin (${expectedGrossProfitKobo} kobo).`,
        500
      );
    }

    const economics: OriginalEconomics = {
      total_charged_kobo: totalChargedKobo,
      provider_cost_kobo: providerCostKobo,
      markup_kobo: markupKobo,
      discount_kobo: discountKobo,
      expected_gross_profit_kobo: expectedGrossProfitKobo,
      pricing_rule_version: PRICING_RULE_VERSION,
    };

    return {
      product,
      economics,
      faceValueKobo,
      totalChargedKobo,
    };
  }

  /**
   * Seeds standard production catalog items for all 4 services if not present.
   */
  public static async seedDefaultProducts(): Promise<void> {
    const defaultCatalog: ServiceProductDocument[] = [
      // AIRTIME
      {
        id: 'prod_airtime_mtn',
        category: ServiceCategory.AIRTIME,
        sub_category: 'MTN',
        name: 'MTN Airtime VTU',
        description: 'Instant MTN airtime recharge',
        face_value_kobo: 0 as IntegerKobo,
        provider_cost_kobo: 0 as IntegerKobo,
        selling_price_kobo: 0 as IntegerKobo,
        discount_percentage: 2.0,
        service_fee_kobo: 0 as IntegerKobo,
        is_active: true,
        min_amount_kobo: 5000 as IntegerKobo,
        max_amount_kobo: 10000000 as IntegerKobo,
        provider_mappings: { vtpass: 'mtn', clubkonnect: 'MTN' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'prod_airtime_airtel',
        category: ServiceCategory.AIRTIME,
        sub_category: 'AIRTEL',
        name: 'Airtel Airtime VTU',
        description: 'Instant Airtel airtime recharge',
        face_value_kobo: 0 as IntegerKobo,
        provider_cost_kobo: 0 as IntegerKobo,
        selling_price_kobo: 0 as IntegerKobo,
        discount_percentage: 2.0,
        service_fee_kobo: 0 as IntegerKobo,
        is_active: true,
        min_amount_kobo: 5000 as IntegerKobo,
        max_amount_kobo: 10000000 as IntegerKobo,
        provider_mappings: { vtpass: 'airtel', clubkonnect: 'AIRTEL' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'prod_airtime_glo',
        category: ServiceCategory.AIRTIME,
        sub_category: 'GLO',
        name: 'Glo Airtime VTU',
        description: 'Instant Glo airtime recharge',
        face_value_kobo: 0 as IntegerKobo,
        provider_cost_kobo: 0 as IntegerKobo,
        selling_price_kobo: 0 as IntegerKobo,
        discount_percentage: 3.0,
        service_fee_kobo: 0 as IntegerKobo,
        is_active: true,
        min_amount_kobo: 5000 as IntegerKobo,
        max_amount_kobo: 10000000 as IntegerKobo,
        provider_mappings: { vtpass: 'glo', clubkonnect: 'GLO' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'prod_airtime_9mobile',
        category: ServiceCategory.AIRTIME,
        sub_category: '9MOBILE',
        name: '9mobile Airtime VTU',
        description: 'Instant 9mobile airtime recharge',
        face_value_kobo: 0 as IntegerKobo,
        provider_cost_kobo: 0 as IntegerKobo,
        selling_price_kobo: 0 as IntegerKobo,
        discount_percentage: 3.0,
        service_fee_kobo: 0 as IntegerKobo,
        is_active: true,
        min_amount_kobo: 5000 as IntegerKobo,
        max_amount_kobo: 10000000 as IntegerKobo,
        provider_mappings: { vtpass: '9mobile', clubkonnect: '9MOBILE' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // DATA
      {
        id: 'prod_mtn_data_1gb',
        category: ServiceCategory.DATA,
        sub_category: 'MTN',
        name: 'MTN 1GB SME (30 Days)',
        description: 'MTN 1GB SME Data Bundle valid for 30 days',
        face_value_kobo: 30000 as IntegerKobo,     // ₦300
        provider_cost_kobo: 25000 as IntegerKobo,  // ₦250
        selling_price_kobo: 28000 as IntegerKobo,  // ₦280 (Profit: ₦30 = 3,000 kobo)
        discount_percentage: 6.67,
        service_fee_kobo: 0 as IntegerKobo,
        is_active: true,
        min_amount_kobo: 28000 as IntegerKobo,
        max_amount_kobo: 28000 as IntegerKobo,
        provider_mappings: { vtpass: 'mtn-data-1gb', clubkonnect: 'MTN_1GB' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'prod_airtel_data_2gb',
        category: ServiceCategory.DATA,
        sub_category: 'AIRTEL',
        name: 'Airtel 2GB Corporate (30 Days)',
        description: 'Airtel 2GB corporate gifting bundle',
        face_value_kobo: 60000 as IntegerKobo,     // ₦600
        provider_cost_kobo: 52000 as IntegerKobo,  // ₦520
        selling_price_kobo: 56000 as IntegerKobo,  // ₦560 (Profit: ₦40 = 4,000 kobo)
        discount_percentage: 6.67,
        service_fee_kobo: 0 as IntegerKobo,
        is_active: true,
        min_amount_kobo: 56000 as IntegerKobo,
        max_amount_kobo: 56000 as IntegerKobo,
        provider_mappings: { vtpass: 'airtel-data-2gb', clubkonnect: 'AIRTEL_2GB' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // ELECTRICITY
      {
        id: 'prod_electricity_ikedc',
        category: ServiceCategory.ELECTRICITY,
        sub_category: 'IKEDC',
        name: 'Ikeja Electric (IKEDC)',
        description: 'Prepaid & Postpaid bill payment for Ikeja Electric',
        face_value_kobo: 0 as IntegerKobo,
        provider_cost_kobo: 0 as IntegerKobo,
        selling_price_kobo: 0 as IntegerKobo,
        discount_percentage: 0,
        service_fee_kobo: 10000 as IntegerKobo, // ₦100 convenience fee
        is_active: true,
        min_amount_kobo: 5000 as IntegerKobo,
        max_amount_kobo: 10000000 as IntegerKobo,
        provider_mappings: { vtpass: 'ikeja-electric', clubkonnect: 'IKEDC' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'prod_electricity_ekedc',
        category: ServiceCategory.ELECTRICITY,
        sub_category: 'EKEDC',
        name: 'Eko Electric (EKEDC)',
        description: 'Prepaid & Postpaid bill payment for Eko Electric',
        face_value_kobo: 0 as IntegerKobo,
        provider_cost_kobo: 0 as IntegerKobo,
        selling_price_kobo: 0 as IntegerKobo,
        discount_percentage: 0,
        service_fee_kobo: 10000 as IntegerKobo,
        is_active: true,
        min_amount_kobo: 5000 as IntegerKobo,
        max_amount_kobo: 10000000 as IntegerKobo,
        provider_mappings: { vtpass: 'eko-electric', clubkonnect: 'EKEDC' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },

      // CABLE TV
      {
        id: 'prod_dstv_yanga',
        category: ServiceCategory.CABLE_TV,
        sub_category: 'DSTV',
        name: 'DStv Yanga Bouquet',
        description: 'DStv Yanga Monthly Subscription',
        face_value_kobo: 510000 as IntegerKobo,    // ₦5,100
        provider_cost_kobo: 495000 as IntegerKobo, // ₦4,950
        selling_price_kobo: 510000 as IntegerKobo, // ₦5,100
        discount_percentage: 0,
        service_fee_kobo: 10000 as IntegerKobo,    // ₦100 fee -> Total: ₦5,200 (Profit: ₦250)
        is_active: true,
        min_amount_kobo: 510000 as IntegerKobo,
        max_amount_kobo: 510000 as IntegerKobo,
        provider_mappings: { vtpass: 'dstv-yanga', clubkonnect: 'DSTV_YANGA' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'prod_gotv_jolli',
        category: ServiceCategory.CABLE_TV,
        sub_category: 'GOTV',
        name: 'GOtv Jolli Bouquet',
        description: 'GOtv Jolli Monthly Subscription',
        face_value_kobo: 395000 as IntegerKobo,    // ₦3,950
        provider_cost_kobo: 385000 as IntegerKobo, // ₦3,850
        selling_price_kobo: 395000 as IntegerKobo, // ₦3,950
        discount_percentage: 0,
        service_fee_kobo: 10000 as IntegerKobo,    // ₦100 fee -> Total: ₦4,050 (Profit: ₦200)
        is_active: true,
        min_amount_kobo: 395000 as IntegerKobo,
        max_amount_kobo: 395000 as IntegerKobo,
        provider_mappings: { vtpass: 'gotv-jolli', clubkonnect: 'GOTV_JOLLI' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    for (const item of defaultCatalog) {
      const existing = await getProductById(item.id);
      if (!existing) {
        await upsertProduct(item);
      }
    }
  }
}
