import type { AppConfig } from '../core/config.js';
import { BusinessAsAServiceAdapter } from './business-as-a-service/index.js';
import { PlatformAdapterRegistry } from './registry.js';

export function createAdapterRegistry(config: AppConfig) {
  const adapters = new PlatformAdapterRegistry();
  adapters.register(
    new BusinessAsAServiceAdapter(
      config.businessService.baseUrl,
      config.businessService.timeoutMs,
      config.businessService.audience,
      config.actorSigningSecret,
      config.businessService.retryAttempts,
      config.businessService.circuitFailureThreshold,
      config.businessService.circuitOpenMs,
    ),
  );
  return adapters;
}
