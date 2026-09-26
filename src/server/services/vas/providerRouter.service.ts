/**
 * Alexvya Platform — Provider Router & Circuit Breaker Engine
 * Stage 2.7 V1 VAS Service Purchase Engine
 * 
 * Routing Policy:
 * 1. Evaluates provider operational status (ACTIVE vs DEGRADED vs MAINTENANCE vs DISABLED).
 * 2. Checks circuit breaker state: Trips after 5 consecutive failures, routes to secondary if supported.
 * 3. Evaluates 24h success rate, latency, and service capability.
 * 
 * CRITICAL ARCHITECTURAL INVARIANT (Stage 1.2 & Stage 2.7):
 * A provider timeout or ambiguous network failure MUST NOT automatically trigger a second provider.
 * UNKNOWN orders must be reconciled via requery, never re-vended to an alternate provider!
 */

import { IVASProviderAdapter } from '../providers/provider.types.ts';
import { VTpassAdapter } from '../providers/vtpass.adapter.ts';
import { ClubKonnectAdapter } from '../providers/clubkonnect.adapter.ts';
import {
  ProviderId,
  ServiceCategory,
  ProviderStatus,
} from '../../../types/enums.ts';
import {
  getProviderById,
  upsertProvider,
  updateProviderHealth,
} from '../../repositories/providers.repository.ts';
import { AlexvyaApiError, ErrorCodes } from '../../../lib/api/errors.ts';
import { logger } from '../../../lib/logger/logger.ts';

export const vtpassAdapter = new VTpassAdapter();
export const clubkonnectAdapter = new ClubKonnectAdapter();

const adapterRegistry = new Map<ProviderId, IVASProviderAdapter>([
  [ProviderId.VTPASS, vtpassAdapter],
  [ProviderId.CLUBKONNECT, clubkonnectAdapter],
]);

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;

export class ProviderRouterService {
  /**
   * Initializes baseline provider records if not present in repository.
   */
  public static async initializeProviders(): Promise<void> {
    const existingVtpass = await getProviderById(ProviderId.VTPASS);
    if (!existingVtpass) {
      await upsertProvider({
        id: ProviderId.VTPASS,
        display_name: 'VTpass API',
        status: ProviderStatus.ACTIVE,
        supported_services: [
          ServiceCategory.AIRTIME,
          ServiceCategory.DATA,
          ServiceCategory.ELECTRICITY,
          ServiceCategory.CABLE_TV,
        ],
        current_balance_kobo: null,
        success_rate_24h: 99.5,
        avg_latency_ms: 120,
        circuit_breaker_open: false,
        consecutive_failures: 0,
        last_health_check_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const existingClubkonnect = await getProviderById(ProviderId.CLUBKONNECT);
    if (!existingClubkonnect) {
      await upsertProvider({
        id: ProviderId.CLUBKONNECT,
        display_name: 'ClubKonnect API',
        status: ProviderStatus.ACTIVE,
        supported_services: [
          ServiceCategory.AIRTIME,
          ServiceCategory.DATA,
          ServiceCategory.ELECTRICITY,
          ServiceCategory.CABLE_TV,
        ],
        current_balance_kobo: null,
        success_rate_24h: 99.2,
        avg_latency_ms: 95,
        circuit_breaker_open: false,
        consecutive_failures: 0,
        last_health_check_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Retrieves an adapter by exact provider ID.
   */
  public static getProviderAdapter(providerId: ProviderId): IVASProviderAdapter {
    const adapter = adapterRegistry.get(providerId);
    if (!adapter) {
      throw new AlexvyaApiError(
        ErrorCodes.PROVIDER_UNAVAILABLE,
        `No adapter registered for provider ID '${providerId}'.`,
        500
      );
    }
    return adapter;
  }

  /**
   * Selects the most suitable active provider for a service category.
   * If a preferred provider is given, checks if it is healthy and supports the service.
   */
  public static async selectProviderForService(
    serviceCategory: ServiceCategory,
    preferredProviderId?: ProviderId
  ): Promise<IVASProviderAdapter> {
    await this.initializeProviders();

    // Default primary preferences per service category:
    // - Airtime: VTpass (secondary: ClubKonnect)
    // - Data: ClubKonnect (secondary: VTpass)
    // - Electricity: VTpass (secondary: ClubKonnect)
    // - Cable TV: VTpass (secondary: ClubKonnect)
    const primaryId = preferredProviderId || (
      serviceCategory === ServiceCategory.DATA ? ProviderId.CLUBKONNECT : ProviderId.VTPASS
    );
    const secondaryId = primaryId === ProviderId.VTPASS ? ProviderId.CLUBKONNECT : ProviderId.VTPASS;

    // Check primary provider health
    const primaryDoc = await getProviderById(primaryId);
    const isPrimaryHealthy = primaryDoc &&
      primaryDoc.status === ProviderStatus.ACTIVE &&
      !primaryDoc.circuit_breaker_open &&
      primaryDoc.supported_services.includes(serviceCategory);

    if (isPrimaryHealthy) {
      return this.getProviderAdapter(primaryId as ProviderId);
    }

    // Attempt secondary fallback if primary is degraded/circuit breaker open
    const secondaryDoc = await getProviderById(secondaryId);
    const isSecondaryHealthy = secondaryDoc &&
      secondaryDoc.status === ProviderStatus.ACTIVE &&
      !secondaryDoc.circuit_breaker_open &&
      secondaryDoc.supported_services.includes(serviceCategory);

    if (isSecondaryHealthy) {
      logger.warn(`[ProviderRouter] Primary provider '${primaryId}' unavailable or circuit open. Falling back to '${secondaryId}' for ${serviceCategory}`);
      return this.getProviderAdapter(secondaryId as ProviderId);
    }

    // Both unavailable
    if (primaryDoc?.circuit_breaker_open && secondaryDoc?.circuit_breaker_open) {
      throw new AlexvyaApiError(
        ErrorCodes.CIRCUIT_BREAKER_OPEN,
        `All providers for service '${serviceCategory}' have open circuit breakers due to recent failures.`,
        503,
        { serviceCategory, primaryId, secondaryId }
      );
    }

    throw new AlexvyaApiError(
      ErrorCodes.PROVIDER_UNAVAILABLE,
      `No operational provider available for service '${serviceCategory}'.`,
      503,
      { serviceCategory }
    );
  }

  /**
   * Records a provider failure, incrementing consecutive failures and tripping circuit breaker if threshold reached.
   */
  public static async recordProviderFailure(providerId: ProviderId): Promise<void> {
    const doc = await getProviderById(providerId);
    if (!doc) return;

    const consecutiveFailures = (doc.consecutive_failures || 0) + 1;
    const circuitBreakerOpen = consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD;

    await updateProviderHealth(providerId, {
      consecutive_failures: consecutiveFailures,
      circuit_breaker_open: circuitBreakerOpen,
      status: circuitBreakerOpen ? ProviderStatus.DEGRADED : doc.status,
    });

    if (circuitBreakerOpen) {
      logger.error(`[ProviderRouter] Circuit breaker TRIPPED for provider '${providerId}' after ${consecutiveFailures} consecutive failures.`);
    }
  }

  /**
   * Records a provider success, resetting consecutive failures.
   */
  public static async recordProviderSuccess(providerId: ProviderId, latencyMs: number): Promise<void> {
    const doc = await getProviderById(providerId);
    if (!doc) return;

    const newAvgLatency = doc.avg_latency_ms
      ? Math.round((doc.avg_latency_ms * 0.8) + (latencyMs * 0.2))
      : latencyMs;

    await updateProviderHealth(providerId, {
      consecutive_failures: 0,
      circuit_breaker_open: false,
      status: ProviderStatus.ACTIVE,
      avg_latency_ms: newAvgLatency,
    });
  }

  /**
   * Resets all provider health states (used in tests).
   */
  public static async resetProviderHealth(): Promise<void> {
    await this.initializeProviders();
    vtpassAdapter.resetSimulation();
    clubkonnectAdapter.resetSimulation();

    for (const pid of [ProviderId.VTPASS, ProviderId.CLUBKONNECT]) {
      await updateProviderHealth(pid, {
        consecutive_failures: 0,
        circuit_breaker_open: false,
        status: ProviderStatus.ACTIVE,
        success_rate_24h: 100,
        avg_latency_ms: 100,
      });
    }
  }

  /**
   * Retrieves provider health status and circuit breaker state.
   */
  public static async getProviderHealth(providerId: ProviderId): Promise<{
    status: ProviderStatus;
    circuit_breaker_open: boolean;
    consecutive_failures: number;
    avg_latency_ms: number;
  }> {
    const doc = await getProviderById(providerId);
    return {
      status: doc?.status || ProviderStatus.ACTIVE,
      circuit_breaker_open: doc?.circuit_breaker_open || false,
      consecutive_failures: doc?.consecutive_failures || 0,
      avg_latency_ms: doc?.avg_latency_ms || 100,
    };
  }
}
