// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  isIndexedDbBackingStoreError,
  shouldScheduleBackgroundIndexedDbRecovery,
  shouldLogIndexedDbRuntimeWarning,
  shouldUseStickyIndexedDbFallback,
} from '@/services/storage/indexeddb/indexedDbRecoveryPolicy';

describe('indexedDbRecoveryPolicy', () => {
  it('recognizes backing-store UnknownError failures', () => {
    expect(
      isIndexedDbBackingStoreError({
        name: 'UnknownError',
        message: 'Internal error opening backing store for indexedDB.open.',
      })
    ).toBe(true);
  });

  it('does not mark transient non-backing-store failures as backing-store errors', () => {
    expect(
      isIndexedDbBackingStoreError({
        name: 'UnknownError',
        message: 'Temporary open failure',
      })
    ).toBe(false);
  });

  it('keeps backing-store failures recoverable instead of sticky-blocking the session', () => {
    expect(
      shouldUseStickyIndexedDbFallback({
        name: 'UnknownError',
        message: 'Internal error opening backing store for indexedDB.open.',
      })
    ).toBe(false);
  });

  it('skips background recovery when sticky fallback mode is active', () => {
    expect(shouldScheduleBackgroundIndexedDbRecovery(0, 3, true)).toBe(false);
  });

  it('stops background recovery when the retry budget is exhausted', () => {
    expect(shouldScheduleBackgroundIndexedDbRecovery(3, 3, false)).toBe(false);
  });

  it('deduplicates runtime warnings after the first emission', () => {
    const emittedWarnings = new Set<string>();

    expect(shouldLogIndexedDbRuntimeWarning('blocked', false, emittedWarnings)).toBe(true);
    expect(shouldLogIndexedDbRuntimeWarning('blocked', false, emittedWarnings)).toBe(false);
  });

  it('suppresses unexpected-close warnings while sticky fallback is active', () => {
    const emittedWarnings = new Set<string>();

    expect(shouldLogIndexedDbRuntimeWarning('unexpected-close', true, emittedWarnings)).toBe(false);
  });
});
