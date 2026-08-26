import type { PlatformAdapter } from './adapter.js';

export class PlatformAdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter>();

  register(adapter: PlatformAdapter) {
    if (this.adapters.has(adapter.key)) {
      throw new Error(`Platform adapter already registered: ${adapter.key}`);
    }

    this.adapters.set(adapter.key, adapter);
  }

  get(key: string) {
    return this.adapters.get(key);
  }

  list() {
    return [...this.adapters.values()];
  }
}
