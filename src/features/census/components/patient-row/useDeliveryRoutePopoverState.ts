import { useCallback, useEffect, useState } from 'react';
import type { DeliveryRoute } from '@/features/census/controllers/deliveryRoutePopoverController';
import {
  buildDeliveryRouteDraft,
  canSaveDeliveryRouteDraft,
  normalizeDeliveryRouteDate,
} from '@/features/census/controllers/deliveryRoutePopoverStateController';

interface UseDeliveryRoutePopoverStateParams {
  deliveryRoute?: DeliveryRoute;
  deliveryDate?: string;
  onSave: (route: DeliveryRoute | undefined, date: string | undefined) => void;
}

interface UseDeliveryRoutePopoverStateResult {
  selectedRoute: DeliveryRoute | undefined;
  selectedDate: string;
  canSave: boolean;
  setSelectedRoute: (route: DeliveryRoute | undefined) => void;
  setSelectedDate: (date: string) => void;
  saveAndClose: (close: () => void) => void;
  clearAndClose: (close: () => void) => void;
}

export const useDeliveryRoutePopoverState = ({
  deliveryRoute,
  deliveryDate,
  onSave,
}: UseDeliveryRoutePopoverStateParams): UseDeliveryRoutePopoverStateResult => {
  const [selectedRoute, setSelectedRoute] = useState<DeliveryRoute | undefined>(deliveryRoute);
  const [selectedDate, setSelectedDate] = useState<string>(deliveryDate || '');

  useEffect(() => {
    const draft = buildDeliveryRouteDraft(deliveryRoute, deliveryDate);
    setSelectedRoute(draft.selectedRoute);
    setSelectedDate(draft.selectedDate);
  }, [deliveryDate, deliveryRoute]);

  const saveAndClose = useCallback(
    (close: () => void) => {
      onSave(selectedRoute, normalizeDeliveryRouteDate(selectedDate));
      close();
    },
    [onSave, selectedDate, selectedRoute]
  );

  const clearAndClose = useCallback(
    (close: () => void) => {
      setSelectedRoute(undefined);
      setSelectedDate('');
      onSave(undefined, undefined);
      close();
    },
    [onSave]
  );

  return {
    selectedRoute,
    selectedDate,
    canSave: canSaveDeliveryRouteDraft(selectedRoute),
    setSelectedRoute,
    setSelectedDate,
    saveAndClose,
    clearAndClose,
  };
};
