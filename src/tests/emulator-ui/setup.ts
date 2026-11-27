import 'fake-indexeddb/auto';
import { notifyManager } from '@tanstack/query-core';
import { act, configure } from '@testing-library/react';
import { wrapConsoleForOperationalNoise } from '@/tests/utils/operationalConsoleNoiseFilter';

wrapConsoleForOperationalNoise(['warn', 'error']);

// Emulator UI suites run 35 files concurrently against a live Firestore emulator;
// Testing Library's default 1 s asyncUtilTimeout trips under CI CPU contention.
configure({ asyncUtilTimeout: 5_000 });

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;
notifyManager.setNotifyFunction(callback => {
  act(callback);
});

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () => '00000000-0000-0000-0000-000000000000',
    },
    configurable: true,
  });
} else if (typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000000',
    configurable: true,
  });
}
