import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import {
  buildLocalPersistenceRuntimeSnapshot,
  resolveLocalPersistenceRuntimeState,
  shouldAttemptMockRecovery,
  shouldExposeDatabaseFallbackToUi,
  shouldSkipReadyCheckForMock,
} from '@/services/storage/indexeddb/indexedDbRuntimeModeController';

describe('indexedDbRuntimeModeController', () => {
  it('maps fallback and sticky modes to operational runtime states', () => {
    expect(
      resolveLocalPersistenceRuntimeState({ isUsingMock: false, stickyFallbackMode: false })
    ).toBe('ok');
    expect(
      resolveLocalPersistenceRuntimeState({ isUsingMock: true, stickyFallbackMode: false })
    ).toBe('recoverable');
    expect(
      resolveLocalPersistenceRuntimeState({ isUsingMock: true, stickyFallbackMode: true })
    ).toBe('blocked');
  });

  it('keeps mock recovery decisions explicit', () => {
    expect(shouldSkipReadyCheckForMock({ isUsingMock: true, allowRecoveryWhenMock: false })).toBe(
      true
    );
    expect(
      shouldAttemptMockRecovery({
        isUsingMock: true,
        allowRecoveryWhenMock: true,
        stickyFallbackMode: false,
      })
    ).toBe(true);
    expect(
      shouldAttemptMockRecovery({
        isUsingMock: true,
        allowRecoveryWhenMock: true,
        stickyFallbackMode: true,
      })
    ).toBe(false);
  });

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
        stickyFallbackMode: false,
      })
    ).toEqual({
      indexedDbAvailable: true,
      fallbackMode: true,
      stickyFallbackMode: false,
      runtimeState: 'recoverable',
    });
  });
});
