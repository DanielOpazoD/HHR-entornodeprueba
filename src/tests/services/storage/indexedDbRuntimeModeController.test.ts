// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import {
  buildLocalPersistenceRuntimeSnapshot,
  shouldExposeDatabaseFallbackToUi,
} from '@/services/storage/indexeddb/indexedDbRuntimeModeController';

describe('indexedDbRuntimeModeController', () => {
  it('hides only intentional E2E mock fallback from recovery UI', () => {
    expect(shouldExposeDatabaseFallbackToUi({ fallbackMode: true, e2eOverrideActive: false })).toBe(
      true
    );
    expect(shouldExposeDatabaseFallbackToUi({ fallbackMode: true, e2eOverrideActive: true })).toBe(
      false
    );
    expect(shouldExposeDatabaseFallbackToUi({ fallbackMode: false, e2eOverrideActive: true })).toBe(
      false
    );
  });

  it('builds the local persistence snapshot without coupling callers to core state', () => {
    expect(
      buildLocalPersistenceRuntimeSnapshot({
        indexedDbAvailable: true,
        isUsingMock: true,
      })
    ).toEqual({
      indexedDbAvailable: true,
      fallbackMode: true,
      runtimeState: 'recoverable',
    });
  });
});
