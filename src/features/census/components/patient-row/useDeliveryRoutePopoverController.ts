import { MouseEvent, useCallback, useRef, useState } from 'react';
import {
  type DeliveryRoute,
  resolveDeliveryRoutePopoverPosition,
} from '@/features/census/controllers/deliveryRoutePopoverController';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import { useDeliveryRoutePopoverState } from '@/features/census/components/patient-row/useDeliveryRoutePopoverState';
import { buildDeliveryRouteButtonModels } from '@/features/census/controllers/deliveryRoutePopoverViewController';
import {
  resolveDeliveryRoutePopoverToggle,
  resolveHasPersistedDeliveryRoute,
} from '@/features/census/controllers/deliveryRoutePopoverRuntimeController';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

interface UseDeliveryRoutePopoverControllerParams {
  deliveryRoute?: DeliveryRoute;
  deliveryDate?: string;
  onSave: (route: DeliveryRoute | undefined, date: string | undefined) => void;
  disabled: boolean;
  panelWidth: number;
}

export const useDeliveryRoutePopoverController = ({
  deliveryRoute,
  deliveryDate,
  onSave,
  disabled,
  panelWidth,
}: UseDeliveryRoutePopoverControllerParams) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const {
    selectedRoute,
    selectedDate,
    canSave,
    setSelectedRoute,
    setSelectedDate,
    saveAndClose,
    clearAndClose,
  } = useDeliveryRoutePopoverState({
    deliveryRoute,
    deliveryDate,
    onSave,
  });

  const closePopover = useCallback(() => {
    setIsOpen(false);
  }, []);

  const resolvePopoverPosition = useCallback(() => {
    if (!buttonRef.current) {
      return null;
    }

    const rect = buttonRef.current.getBoundingClientRect();
    return resolveDeliveryRoutePopoverPosition({
      buttonRect: rect,
      panelWidth,
      viewportWidth: defaultBrowserWindowRuntime.getViewportWidth(),
    });
  }, [panelWidth]);

  const { position: popoverPos, updatePosition } = usePortalPopoverRuntime({
    isOpen,
    anchorRef: buttonRef,
    popoverRef,
    initialPosition: { top: 0, left: 0 },
    resolvePosition: resolvePopoverPosition,
    onClose: closePopover,
  });

  const togglePopover = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const resolution = resolveDeliveryRoutePopoverToggle({ isOpen, disabled });
      if (resolution.shouldUpdatePosition) {
        updatePosition();
      }
      setIsOpen(resolution.nextOpen);
    },
    [disabled, isOpen, updatePosition]
  );

  const hasPersistedData = resolveHasPersistedDeliveryRoute(deliveryRoute);
  const routeButtonModels = buildDeliveryRouteButtonModels(selectedRoute);

  return {
    isOpen,
    popoverRef,
    buttonRef,
    popoverPos,
    selectedRoute,
    selectedDate,
    canSave,
    routeButtonModels,
    hasPersistedData,
    setSelectedRoute,
    setSelectedDate,
    saveAndClose,
    clearAndClose,
    closePopover,
    togglePopover,
  };
};
