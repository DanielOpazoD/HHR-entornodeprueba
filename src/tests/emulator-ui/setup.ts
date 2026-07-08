import 'fake-indexeddb/auto';
import { notifyManager } from '@tanstack/query-core';
import { act } from '@testing-library/react';
import { wrapConsoleForOperationalNoise } from '@/tests/utils/operationalConsoleNoiseFilter';

wrapConsoleForOperationalNoise(['warn', 'error']);

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
