import type { AppConfig } from '../core/config.js';
import { BusinessAsAServiceAdapter } from './business-as-a-service/index.js';
import { PepsaOrderAdapter } from './pepsa-order/index.js';
import { PepsaPaymentAdapter } from './pepsa-payment/index.js';
import { VendorAdapter } from './vendor/index.js';
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
  adapters.register(
    new PepsaOrderAdapter(
      config.orderService.baseUrl,
      config.orderService.timeoutMs,
      config.orderService.audience,
      config.actorSigningSecret,
      config.orderService.retryAttempts,
      config.orderService.circuitFailureThreshold,
      config.orderService.circuitOpenMs,
    ),
  );
  adapters.register(
    new PepsaPaymentAdapter(
      config.paymentService.baseUrl,
      config.paymentService.timeoutMs,
      config.paymentService.audience,
      config.actorSigningSecret,
      config.paymentService.retryAttempts,
      config.paymentService.circuitFailureThreshold,
      config.paymentService.circuitOpenMs,
    ),
  );
  adapters.register(
    new VendorAdapter(
      config.vendorService.baseUrl,
      config.vendorService.timeoutMs,
      config.vendorService.audience,
      config.actorSigningSecret,
      config.vendorService.retryAttempts,
      config.vendorService.circuitFailureThreshold,
      config.vendorService.circuitOpenMs,
    ),
  );
  return adapters;
}
