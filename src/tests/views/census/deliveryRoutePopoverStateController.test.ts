import { describe, expect, it } from 'vitest';
import {
  buildDeliveryRouteDraft,
  canSaveDeliveryRouteDraft,
  normalizeDeliveryRouteDate,
} from '@/features/census/controllers/deliveryRoutePopoverStateController';

describe('deliveryRoutePopoverStateController', () => {
  it('builds draft state from optional persisted values', () => {
    expect(buildDeliveryRouteDraft('Vaginal', '2026-02-15')).toEqual({
      selectedRoute: 'Vaginal',
      selectedDate: '2026-02-15',
    });

    expect(buildDeliveryRouteDraft(undefined, undefined)).toEqual({
      selectedRoute: undefined,
      selectedDate: '',
    });
  });

  it('normalizes date values before persistence', () => {
    expect(normalizeDeliveryRouteDate('2026-02-15')).toBe('2026-02-15');
    expect(normalizeDeliveryRouteDate('')).toBeUndefined();
    expect(normalizeDeliveryRouteDate('   ')).toBeUndefined();
  });

  it('allows save only when route is selected', () => {
    expect(canSaveDeliveryRouteDraft(undefined)).toBe(false);
    expect(canSaveDeliveryRouteDraft('Cesárea')).toBe(true);
  });
});
