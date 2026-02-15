import { describe, expect, it } from 'vitest';
import { Settings } from 'lucide-react';
import { resolveNavbarMenuAction } from '@/components/layout/navbar/navbarMenuController';
import type { NavItemConfig } from '@/constants/navigationConfig';

const createItem = (overrides: Partial<NavItemConfig>): NavItemConfig =>
  ({
    id: 'test-item',
    label: 'Test',
    icon: Settings,
    actionType: 'MODULE_CHANGE',
    ...overrides,
  }) as NavItemConfig;

describe('resolveNavbarMenuAction', () => {
  it('returns module change action for MODULE_CHANGE items', () => {
    const resolution = resolveNavbarMenuAction({
      item: createItem({ module: 'AUDIT', actionType: 'MODULE_CHANGE' }),
    });

    expect(resolution).toEqual({
      moduleToChange: 'AUDIT',
      shouldOpenSettings: false,
    });
  });

  it('returns settings action for SETTINGS items', () => {
    const resolution = resolveNavbarMenuAction({
      item: createItem({ actionType: 'SETTINGS' }),
    });

    expect(resolution).toEqual({
      shouldOpenSettings: true,
    });
  });
});
