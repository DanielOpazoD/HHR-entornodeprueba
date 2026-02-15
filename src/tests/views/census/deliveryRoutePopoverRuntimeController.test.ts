import { describe, expect, it } from 'vitest';
import {
  resolveDeliveryRoutePopoverToggle,
  resolveHasPersistedDeliveryRoute,
} from '@/features/census/controllers/deliveryRoutePopoverRuntimeController';

describe('deliveryRoutePopoverRuntimeController', () => {
  it('keeps state unchanged when disabled', () => {
    const result = resolveDeliveryRoutePopoverToggle({ isOpen: false, disabled: true });
    expect(result).toEqual({ nextOpen: false, shouldUpdatePosition: false });
  });

  it('opens popover and requests reposition when currently closed', () => {
    const result = resolveDeliveryRoutePopoverToggle({ isOpen: false, disabled: false });
    expect(result).toEqual({ nextOpen: true, shouldUpdatePosition: true });
  });

  it('closes popover without reposition when currently open', () => {
    const result = resolveDeliveryRoutePopoverToggle({ isOpen: true, disabled: false });
    expect(result).toEqual({ nextOpen: false, shouldUpdatePosition: false });
  });

  it('resolves persisted data from route value', () => {
    expect(resolveHasPersistedDeliveryRoute(undefined)).toBe(false);
    expect(resolveHasPersistedDeliveryRoute('Vaginal')).toBe(true);
  });
});
