import { describe, expect, it } from 'vitest';

import { NAVIGATION_CONFIG } from '@/constants/navigationConfig';

describe('navigationConfig', () => {
  it('keeps medical handoff hidden and the retired transfer management route absent', () => {
    const visibleNavigationIds = NAVIGATION_CONFIG.map(item => item.id);

    expect(visibleNavigationIds).not.toContain('medical-handoff');
    expect(visibleNavigationIds).not.toContain('transfer-management');
    expect(visibleNavigationIds).toContain('nursing-handoff');
  });
});
