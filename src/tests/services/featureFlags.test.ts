/**
 * Tests for FeatureFlags Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('FeatureFlags', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('should return default values for flags', async () => {
    const { featureFlags, isFeatureEnabled } = await import('@/services/utils/featureFlags');

    // Check that defaults are respected
    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(
      isFeatureEnabled('SPECIALTY_JEV_CONSULTATION')
    );
    expect(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY')).toBe(
      isFeatureEnabled('SPECIALTY_RULES_MEMORY')
    );
  });

  it('should enable and disable flags', async () => {
    const { featureFlags } = await import('@/services/utils/featureFlags');

    featureFlags.enable('SPECIALTY_RULES_MEMORY');
    expect(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY')).toBe(true);

    featureFlags.disable('SPECIALTY_RULES_MEMORY');
    expect(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY')).toBe(false);
  });

  it('should toggle flags', async () => {
    const { featureFlags } = await import('@/services/utils/featureFlags');

    const initial = featureFlags.isEnabled('SPECIALTY_RULES_MEMORY');
    const toggled = featureFlags.toggle('SPECIALTY_RULES_MEMORY');

    expect(toggled).toBe(!initial);
    expect(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY')).toBe(!initial);
  });

  it('should get all flags', async () => {
    const { featureFlags } = await import('@/services/utils/featureFlags');

    const allFlags = featureFlags.getAll();
    expect(allFlags.SPECIALTY_RULES_MEMORY).toBe(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY'));
    expect(allFlags.SPECIALTY_JEV_CONSULTATION).toBe(
      featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')
    );
  });

  it('should reset flags to defaults', async () => {
    const { featureFlags, FEATURE_FLAGS } = await import('@/services/utils/featureFlags');

    featureFlags.enable('SPECIALTY_RULES_MEMORY');
    featureFlags.reset('SPECIALTY_RULES_MEMORY');

    // After reset, should return to default
    expect(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY')).toBe(
      FEATURE_FLAGS.SPECIALTY_RULES_MEMORY
    );
  });

  it('should notify subscribers when a flag changes', async () => {
    const { featureFlags } = await import('@/services/utils/featureFlags');
    const values: boolean[] = [];
    const unsubscribe = featureFlags.subscribe('SPECIALTY_RULES_MEMORY', enabled =>
      values.push(enabled)
    );

    featureFlags.enable('SPECIALTY_RULES_MEMORY');
    featureFlags.disable('SPECIALTY_RULES_MEMORY');
    unsubscribe();
    featureFlags.enable('SPECIALTY_RULES_MEMORY');

    expect(values).toEqual([true, false]);
  });

  it('should reset all flags back to defaults', async () => {
    const { featureFlags, FEATURE_FLAGS } = await import('@/services/utils/featureFlags');

    featureFlags.enable('SPECIALTY_RULES_MEMORY');
    featureFlags.enable('SPECIALTY_JEV_CONSULTATION');
    featureFlags.resetAll();

    expect(featureFlags.getAll()).toEqual(FEATURE_FLAGS);
  });

  it('hydrates persisted overrides from localStorage without IndexedDB bootstrap', async () => {
    localStorage.setItem(
      'hhr_feature_flags',
      JSON.stringify({
        SPECIALTY_JEV_CONSULTATION: false,
        SPECIALTY_RULES_MEMORY: true,
      })
    );

    const { featureFlags } = await import('@/services/utils/featureFlags');

    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(false);
    expect(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY')).toBe(true);
  });

  it('keeps environment overrides separate from localStorage, overrides stale storage on boot, and preserves them on reset', async () => {
    localStorage.setItem(
      'hhr_feature_flags',
      JSON.stringify({ SPECIALTY_JEV_CONSULTATION: false })
    );
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_HHR_SPECIALTY_JEV_PILOT', 'enabled');

    const { featureFlags } = await import('@/services/utils/featureFlags');

    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(true);

    featureFlags.enable('SPECIALTY_RULES_MEMORY');
    const persisted = JSON.parse(localStorage.getItem('hhr_feature_flags') ?? '{}');
    expect(persisted).toEqual({ SPECIALTY_RULES_MEMORY: true });

    featureFlags.disable('SPECIALTY_JEV_CONSULTATION');
    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(false);

    featureFlags.reset('SPECIALTY_JEV_CONSULTATION');
    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(true);

    featureFlags.resetAll();
    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(true);
  });
});
