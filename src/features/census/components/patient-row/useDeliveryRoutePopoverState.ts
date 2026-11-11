import type { CesareanLabor, DeliveryRoute } from '@/types/domain/patient';

import { useCallback, useMemo, useState } from 'react';

import {
  buildDeliveryRouteDraft,
  canSaveDeliveryRouteDraft,
  normalizeDeliveryCesareanLabor,
  normalizeDeliveryRouteDate,
} from '@/features/census/controllers/deliveryRoutePopoverStateController';

interface UseDeliveryRoutePopoverStateParams {
  deliveryRoute?: DeliveryRoute;
  deliveryDate?: string;
  deliveryCesareanLabor?: CesareanLabor;
  onSave: (
    route: DeliveryRoute | undefined,
    date: string | undefined,
    cesareanLabor: CesareanLabor | undefined
  ) => void;
}

interface UseDeliveryRoutePopoverStateResult {
  selectedRoute: DeliveryRoute | undefined;
  selectedDate: string;
  selectedCesareanLabor: CesareanLabor | undefined;
  canSave: boolean;
  setSelectedRoute: (route: DeliveryRoute | undefined) => void;
  setSelectedDate: (date: string) => void;
  setSelectedCesareanLabor: (cesareanLabor: CesareanLabor | undefined) => void;
  resetFromPersisted: () => void;
  saveAndClose: (close: () => void) => void;
  clearAndClose: (close: () => void) => void;
}

export const useDeliveryRoutePopoverState = ({
  deliveryRoute,
  deliveryDate,
  deliveryCesareanLabor,
  onSave,
}: UseDeliveryRoutePopoverStateParams): UseDeliveryRoutePopoverStateResult => {
  type DeliveryRouteDraft = ReturnType<typeof buildDeliveryRouteDraft>;

  const persistedDraft = useMemo(
    () => buildDeliveryRouteDraft(deliveryRoute, deliveryDate, deliveryCesareanLabor),
    [deliveryCesareanLabor, deliveryDate, deliveryRoute]
  );
  const [draftOverride, setDraftOverride] = useState<DeliveryRouteDraft | null>(null);

  const selectedRoute = (draftOverride ?? persistedDraft).selectedRoute;
  const selectedDate = (draftOverride ?? persistedDraft).selectedDate;
  const selectedCesareanLabor = (draftOverride ?? persistedDraft).selectedCesareanLabor;

  const setSelectedRoute = useCallback(
    (route: DeliveryRoute | undefined) => {
      setDraftOverride(previous => {
        const base = previous ?? persistedDraft;
        return {
          ...base,
          selectedRoute: route,
          selectedCesareanLabor: route === 'Cesárea' ? base.selectedCesareanLabor : undefined,
        };
      });
    },
    [persistedDraft]
  );

  const setSelectedDate = useCallback(
    (date: string) => {
      setDraftOverride(previous => {
        const base = previous ?? persistedDraft;
        return {
          ...base,
          selectedDate: date,
        };
      });
    },
    [persistedDraft]
  );

  const setSelectedCesareanLabor = useCallback(
    (cesareanLabor: CesareanLabor | undefined) => {
      setDraftOverride(previous => {
        const base = previous ?? persistedDraft;
        return {
          ...base,
          selectedCesareanLabor: cesareanLabor,
        };
      });
    },
    [persistedDraft]
  );

  const resetFromPersisted = useCallback(() => {
    setDraftOverride(null);
  }, []);

  const saveAndClose = useCallback(
    (close: () => void) => {
      onSave(
        selectedRoute,
        normalizeDeliveryRouteDate(selectedDate),
        normalizeDeliveryCesareanLabor(selectedRoute, selectedCesareanLabor)
      );
      close();
    },
    [onSave, selectedCesareanLabor, selectedDate, selectedRoute]
  );

  const clearAndClose = useCallback(
    (close: () => void) => {
      setDraftOverride({
        selectedRoute: undefined,
        selectedDate: '',
        selectedCesareanLabor: undefined,
      });
      onSave(undefined, undefined, undefined);
      close();
    },
    [onSave]
  );

  return {
    selectedRoute,
    selectedDate,
    selectedCesareanLabor,
    canSave: canSaveDeliveryRouteDraft(selectedRoute, selectedCesareanLabor),
    setSelectedRoute,
    setSelectedDate,
    setSelectedCesareanLabor,
    resetFromPersisted,
    saveAndClose,
    clearAndClose,
  };
};
