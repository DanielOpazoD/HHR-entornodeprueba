import { describe, expect, it } from 'vitest';
import {
  resolveDeliveryRouteIconColor,
  resolveDeliveryRoutePopoverPosition,
  resolveDeliveryRouteTitle,
} from '@/features/census/controllers/deliveryRoutePopoverController';

describe('deliveryRoutePopoverController', () => {
  it('resolves icon color from persisted route state', () => {
    expect(resolveDeliveryRouteIconColor(false, undefined)).toContain('text-slate-300');
    expect(resolveDeliveryRouteIconColor(true, 'Vaginal')).toContain('text-pink-500');
    expect(resolveDeliveryRouteIconColor(true, 'Cesárea')).toContain('text-blue-500');
  });

  it('clamps popover position inside viewport bounds', () => {
    const rect = {
      left: 20,
      bottom: 100,
      width: 10,
    } as DOMRect;

    const position = resolveDeliveryRoutePopoverPosition({
      buttonRect: rect,
      panelWidth: 208,
      viewportWidth: 240,
    });

    expect(position.top).toBe(104);
    expect(position.left).toBeGreaterThanOrEqual(8);
  });

  it('builds tooltip title for empty and populated data', () => {
    expect(resolveDeliveryRouteTitle(undefined, undefined)).toBe('Vía del parto');
    expect(resolveDeliveryRouteTitle('Vaginal', undefined)).toContain('Sin fecha');
  });
});
