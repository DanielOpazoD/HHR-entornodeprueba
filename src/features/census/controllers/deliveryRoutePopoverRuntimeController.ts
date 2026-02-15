export interface DeliveryRoutePopoverToggleResolution {
  nextOpen: boolean;
  shouldUpdatePosition: boolean;
}

export const resolveDeliveryRoutePopoverToggle = ({
  isOpen,
  disabled,
}: {
  isOpen: boolean;
  disabled: boolean;
}): DeliveryRoutePopoverToggleResolution => {
  if (disabled) {
    return {
      nextOpen: isOpen,
      shouldUpdatePosition: false,
    };
  }

  const nextOpen = !isOpen;
  return {
    nextOpen,
    shouldUpdatePosition: nextOpen,
  };
};

export const resolveHasPersistedDeliveryRoute = (deliveryRoute?: 'Vaginal' | 'Cesárea'): boolean =>
  Boolean(deliveryRoute);
