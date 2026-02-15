import type { DeliveryRoute } from '@/features/census/controllers/deliveryRoutePopoverController';

export interface DeliveryRoutePopoverDraft {
  selectedRoute: DeliveryRoute | undefined;
  selectedDate: string;
}

export const buildDeliveryRouteDraft = (
  route?: DeliveryRoute,
  date?: string
): DeliveryRoutePopoverDraft => ({
  selectedRoute: route,
  selectedDate: date || '',
});

export const normalizeDeliveryRouteDate = (date: string): string | undefined => {
  const trimmed = date.trim();
  return trimmed ? trimmed : undefined;
};

export const canSaveDeliveryRouteDraft = (selectedRoute: DeliveryRoute | undefined): boolean =>
  Boolean(selectedRoute);
