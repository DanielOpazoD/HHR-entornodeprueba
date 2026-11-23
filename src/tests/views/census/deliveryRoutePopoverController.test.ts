// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildCesareanLaborButtonModels,
  buildDeliveryRouteButtonModels,
  buildDeliveryRouteDraft,
  canSaveDeliveryRouteDraft,
  normalizeDeliveryRouteDate,
  resolveDeliveryRouteIconColor,
  resolveDeliveryRoutePopoverPosition,
  resolveDeliveryRoutePopoverToggle,
  resolveDeliveryRouteTitle,
  resolveHasPersistedDeliveryRoute,
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
    expect(resolveDeliveryRouteTitle('Cesárea', '2025-01-02')).toContain('02-01-2025');
    expect(resolveDeliveryRouteTitle('Cesárea', '2025-01-02', 'Sin TdP')).toContain('Sin TdP');
  });

  it('handles popover toggle state and persisted route presence', () => {
    expect(resolveDeliveryRoutePopoverToggle({ isOpen: false, disabled: true })).toEqual({
      nextOpen: false,
      shouldUpdatePosition: false,
    });
    expect(resolveDeliveryRoutePopoverToggle({ isOpen: false, disabled: false })).toEqual({
      nextOpen: true,
      shouldUpdatePosition: true,
    });
    expect(resolveDeliveryRoutePopoverToggle({ isOpen: true, disabled: false })).toEqual({
      nextOpen: false,
      shouldUpdatePosition: false,
    });
    expect(resolveHasPersistedDeliveryRoute(undefined)).toBe(false);
    expect(resolveHasPersistedDeliveryRoute('Vaginal')).toBe(true);
  });

  it('builds and validates delivery route drafts', () => {
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
    expect(normalizeDeliveryRouteDate('2026-02-15')).toBe('2026-02-15');
    expect(normalizeDeliveryRouteDate('   ')).toBeUndefined();
    expect(canSaveDeliveryRouteDraft(undefined, undefined)).toBe(false);
    expect(canSaveDeliveryRouteDraft('Vaginal', undefined)).toBe(true);
    expect(canSaveDeliveryRouteDraft('Cesárea', 'Con TdP')).toBe(true);
  });

  it('builds route and cesarean labor button view models', () => {
    const selectedRoute = buildDeliveryRouteButtonModels('Vaginal');
    expect(selectedRoute).toHaveLength(2);
    expect(selectedRoute[0]).toMatchObject({ route: 'Vaginal', isSelected: true });
    expect(selectedRoute[0].className).toContain('bg-pink-50');
    expect(selectedRoute[1].isSelected).toBe(false);
    expect(buildDeliveryRouteButtonModels(undefined).every(item => !item.isSelected)).toBe(true);

    const selectedLabor = buildCesareanLaborButtonModels('Con TdP');
    expect(selectedLabor[0]).toMatchObject({ value: 'Sin TdP', isSelected: false });
    expect(selectedLabor[1]).toMatchObject({ value: 'Con TdP', isSelected: true });
    expect(selectedLabor[1].className).toContain('bg-violet-50');
    expect(
      buildCesareanLaborButtonModels(undefined).every(
        item => !item.isSelected && item.className.includes('bg-slate-50')
      )
    ).toBe(true);
  });
});
