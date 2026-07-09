import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLegacyCompatibilityMode,
  isLegacyBridgeEnabled,
  shouldUseLegacyCompatibilityInHotPath,
} from '@/services/repositories/legacyCompatibilityPolicy';

describe('legacyCompatibilityPolicy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to disabled so the testing repo does not read production Firebase', () => {
    vi.stubEnv('VITE_LEGACY_COMPATIBILITY_MODE', '');

    expect(getLegacyCompatibilityMode()).toBe('disabled');
    expect(isLegacyBridgeEnabled()).toBe(false);
    expect(shouldUseLegacyCompatibilityInHotPath()).toBe(false);
  });

  it('can disable the explicit legacy bridge without re-enabling the hot path fallback', () => {
    vi.stubEnv('VITE_LEGACY_COMPATIBILITY_MODE', 'disabled');

    expect(getLegacyCompatibilityMode()).toBe('disabled');
    expect(isLegacyBridgeEnabled()).toBe(false);
    expect(shouldUseLegacyCompatibilityInHotPath()).toBe(false);
  });
});
