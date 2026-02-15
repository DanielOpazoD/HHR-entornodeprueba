import { describe, expect, it } from 'vitest';
import { buildDeliveryRouteButtonModels } from '@/features/census/controllers/deliveryRoutePopoverViewController';

describe('deliveryRoutePopoverViewController', () => {
  it('builds route button models with selected state and classes', () => {
    const selected = buildDeliveryRouteButtonModels('Vaginal');
    expect(selected).toHaveLength(2);
    expect(selected[0].route).toBe('Vaginal');
    expect(selected[0].isSelected).toBe(true);
    expect(selected[0].className).toContain('bg-pink-50');
    expect(selected[1].isSelected).toBe(false);

    const none = buildDeliveryRouteButtonModels(undefined);
    expect(none.every(item => item.isSelected === false)).toBe(true);
  });
});
