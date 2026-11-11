import type { CesareanLabor, DeliveryRoute } from '@/types/domain/patient';

export interface DeliveryRoutePopoverDraft {
  selectedRoute: DeliveryRoute | undefined;
  selectedDate: string;
  selectedCesareanLabor: CesareanLabor | undefined;
}

export const buildDeliveryRouteDraft = (
  route?: DeliveryRoute,
  date?: string,
  cesareanLabor?: CesareanLabor
): DeliveryRoutePopoverDraft => ({
  selectedRoute: route,
  selectedDate: date || '',
  selectedCesareanLabor: route === 'Cesárea' ? cesareanLabor : undefined,
});

export const normalizeDeliveryRouteDate = (date: string): string | undefined => {
  const trimmed = date.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeDeliveryCesareanLabor = (
  route: DeliveryRoute | undefined,
  cesareanLabor: CesareanLabor | undefined
): CesareanLabor | undefined => (route === 'Cesárea' ? cesareanLabor : undefined);

export const canSaveDeliveryRouteDraft = (
  selectedRoute: DeliveryRoute | undefined,
  _selectedCesareanLabor: CesareanLabor | undefined
): boolean => Boolean(selectedRoute);
