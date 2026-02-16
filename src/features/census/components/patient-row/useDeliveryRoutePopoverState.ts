import { useCallback, useMemo, useState } from 'react';
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
  resetFromPersisted: () => void;
  saveAndClose: (close: () => void) => void;
  clearAndClose: (close: () => void) => void;
}

export const useDeliveryRoutePopoverState = ({
  deliveryRoute,
  deliveryDate,
  onSave,
}: UseDeliveryRoutePopoverStateParams): UseDeliveryRoutePopoverStateResult => {
  type DeliveryRouteDraft = ReturnType<typeof buildDeliveryRouteDraft>;

  const persistedDraft = useMemo(
    () => buildDeliveryRouteDraft(deliveryRoute, deliveryDate),
    [deliveryDate, deliveryRoute]
  );
  const [draftOverride, setDraftOverride] = useState<DeliveryRouteDraft | null>(null);

  const selectedRoute = (draftOverride ?? persistedDraft).selectedRoute;
  const selectedDate = (draftOverride ?? persistedDraft).selectedDate;

  const setSelectedRoute = useCallback(
    (route: DeliveryRoute | undefined) => {
      setDraftOverride(previous => {
        const base = previous ?? persistedDraft;
        return {
          ...base,
          selectedRoute: route,
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

  const resetFromPersisted = useCallback(() => {
    setDraftOverride(null);
  }, []);

  const saveAndClose = useCallback(
    (close: () => void) => {
      onSave(selectedRoute, normalizeDeliveryRouteDate(selectedDate));
      close();
    },
    [onSave, selectedDate, selectedRoute]
  );

  const clearAndClose = useCallback(
    (close: () => void) => {
      setDraftOverride({
        selectedRoute: undefined,
        selectedDate: '',
      });
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
    resetFromPersisted,
    saveAndClose,
    clearAndClose,
  };
};
