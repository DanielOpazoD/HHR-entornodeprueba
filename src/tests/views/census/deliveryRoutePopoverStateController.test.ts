// @vitest-environment node
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
      selectedCesareanLabor: undefined,
    });

    expect(buildDeliveryRouteDraft(undefined, undefined)).toEqual({
      selectedRoute: undefined,
      selectedDate: '',
      selectedCesareanLabor: undefined,
    });
  });

  it('normalizes date values before persistence', () => {
    expect(normalizeDeliveryRouteDate('2026-02-15')).toBe('2026-02-15');
    expect(normalizeDeliveryRouteDate('')).toBeUndefined();
    expect(normalizeDeliveryRouteDate('   ')).toBeUndefined();
  });

  it('allows saving any selected delivery route', () => {
    expect(canSaveDeliveryRouteDraft(undefined, undefined)).toBe(false);
    expect(canSaveDeliveryRouteDraft('Vaginal', undefined)).toBe(true);
    expect(canSaveDeliveryRouteDraft('Cesárea', undefined)).toBe(true);
    expect(canSaveDeliveryRouteDraft('Cesárea', 'Con TdP')).toBe(true);
  });
});
