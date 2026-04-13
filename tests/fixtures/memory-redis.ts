/**
 * In-memory Redis mock for testing
 * Provides a simple key-value store with TTL support
 * Implements a subset of ioredis interface for testing purposes
 */

import type Redis from 'ioredis';

interface StoredValue {
  value: string;
  expiresAt?: number; // Timestamp when key expires
}

export function createMemoryRedis(): Redis {
  const store = new Map<string, StoredValue>();

  // Helper: Check and remove expired keys
  const checkExpiry = (key: string): boolean => {
    const item = store.get(key);
    if (item && item.expiresAt && item.expiresAt < Date.now()) {
      store.delete(key);
      return true;
    }
    return false;
  };

  const redis = {
    // Connection events
    on: (event: string, callback: Function) => {
      // Simulate connection events
      if (event === 'connect') {
        setImmediate(() => callback());
      }
      return redis;
    },

    // Key-value operations
    get: async (key: string): Promise<string | null> => {
      if (checkExpiry(key)) return null;
      const item = store.get(key);
      return item ? item.value : null;
    },

    set: async (key: string, value: string): Promise<string> => {
      store.set(key, { value });
      return 'OK';
    },

    setex: async (key: string, seconds: number, value: string): Promise<string> => {
      const expiresAt = Date.now() + seconds * 1000;
      store.set(key, { value, expiresAt });
      return 'OK';
    },

    del: async (key: string): Promise<number> => {
      if (store.has(key)) {
        store.delete(key);
        return 1;
      }
      return 0;
    },

    exists: async (key: string): Promise<number> => {
      if (checkExpiry(key)) return 0;
      return store.has(key) ? 1 : 0;
    },

    ttl: async (key: string): Promise<number> => {
      if (checkExpiry(key)) return -2; // Key doesn't exist
      const item = store.get(key);
      if (!item) return -2; // Key doesn't exist
      if (!item.expiresAt) return -1; // Key exists but has no expiry
      const remaining = Math.ceil((item.expiresAt - Date.now()) / 1000);
      return Math.max(-2, remaining); // Return -2 if already expired
    },

    keys: async (pattern: string): Promise<string[]> => {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      const keys: string[] = [];

      for (const [key, item] of store.entries()) {
        // Skip expired keys
        if (item.expiresAt && item.expiresAt < Date.now()) {
          store.delete(key);
          continue;
        }

        if (regex.test(key)) {
          keys.push(key);
        }
      }

      return keys;
    },

    flushall: async (): Promise<string> => {
      store.clear();
      return 'OK';
    },

    // Connection management
    quit: async (): Promise<string> => {
      store.clear();
      return 'OK';
    },

    disconnect: async (): Promise<void> => {
      store.clear();
    },

    // Error event handler
    once: (event: string, callback: Function) => {
      return redis;
    },

    // Additional methods for compatibility
    ping: async (): Promise<string> => 'PONG',

    echo: async (message: string): Promise<string> => message,

    // Batch operations (for completeness)
    mget: async (...keys: string[]): Promise<(string | null)[]> => {
      return Promise.all(
        keys.map(key => redis.get(key))
      );
    },

    mset: async (...args: string[]): Promise<string> => {
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];
        if (key && value) {
          await redis.set(key, value);
        }
      }
      return 'OK';
    },
  } as unknown as Redis;

  return redis;
}
