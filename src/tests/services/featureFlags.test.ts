/**
 * Tests for FeatureFlags Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('FeatureFlags', () => {
    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('should export featureFlags instance', async () => {
        const { featureFlags } = await import('@/services/utils/featureFlags');
        expect(featureFlags).toBeDefined();
        expect(typeof featureFlags.isEnabled).toBe('function');
        expect(typeof featureFlags.enable).toBe('function');
        expect(typeof featureFlags.disable).toBe('function');
    });

    it('should export isFeatureEnabled helper', async () => {
        const { isFeatureEnabled } = await import('@/services/utils/featureFlags');
        expect(typeof isFeatureEnabled).toBe('function');
    });

    it('should export FEATURE_FLAGS constant', async () => {
        const { FEATURE_FLAGS } = await import('@/services/utils/featureFlags');
        expect(FEATURE_FLAGS).toBeDefined();
        expect(typeof FEATURE_FLAGS).toBe('object');
        expect('SHOW_DEBUG_PANEL' in FEATURE_FLAGS).toBe(true);
    });

    it('should return default values for flags', async () => {
        const { featureFlags } = await import('@/services/utils/featureFlags');

        // Check that defaults are respected
        expect(typeof featureFlags.isEnabled('ENABLE_ANALYTICS_VIEW')).toBe('boolean');
        expect(typeof featureFlags.isEnabled('SHOW_DEBUG_PANEL')).toBe('boolean');
    });

    it('should enable and disable flags', async () => {
        const { featureFlags } = await import('@/services/utils/featureFlags');

        featureFlags.enable('SHOW_DEBUG_PANEL');
        expect(featureFlags.isEnabled('SHOW_DEBUG_PANEL')).toBe(true);

        featureFlags.disable('SHOW_DEBUG_PANEL');
        expect(featureFlags.isEnabled('SHOW_DEBUG_PANEL')).toBe(false);
    });

    it('should toggle flags', async () => {
        const { featureFlags } = await import('@/services/utils/featureFlags');

        const initial = featureFlags.isEnabled('SHOW_DEBUG_PANEL');
        const toggled = featureFlags.toggle('SHOW_DEBUG_PANEL');

        expect(toggled).toBe(!initial);
        expect(featureFlags.isEnabled('SHOW_DEBUG_PANEL')).toBe(!initial);
    });

    it('should get all flags', async () => {
        const { featureFlags } = await import('@/services/utils/featureFlags');

        const allFlags = featureFlags.getAll();
        expect(typeof allFlags).toBe('object');
        expect('SHOW_DEBUG_PANEL' in allFlags).toBe(true);
        expect('ENABLE_ANALYTICS_VIEW' in allFlags).toBe(true);
    });

    it('should reset flags to defaults', async () => {
        const { featureFlags, FEATURE_FLAGS } = await import('@/services/utils/featureFlags');

        featureFlags.enable('SHOW_DEBUG_PANEL');
        featureFlags.reset('SHOW_DEBUG_PANEL');

        // After reset, should return to default
        expect(featureFlags.isEnabled('SHOW_DEBUG_PANEL')).toBe(FEATURE_FLAGS.SHOW_DEBUG_PANEL);
    });
});
