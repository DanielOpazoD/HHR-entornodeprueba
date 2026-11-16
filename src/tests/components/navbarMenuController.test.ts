// @vitest-environment node
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

    expect(resolution).toEqual({ moduleToChange: 'AUDIT' });
  });

  it('returns empty resolution for items without an actionType match', () => {
    const resolution = resolveNavbarMenuAction({
      item: { ...createItem({}), actionType: 'UNKNOWN' as never } as NavItemConfig,
    });

    expect(resolution).toEqual({});
  });
});
