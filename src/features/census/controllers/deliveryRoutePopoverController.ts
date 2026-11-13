import type { CesareanLabor, DeliveryRoute } from '@/types/domain/patient';

import { formatCensusRouteDateLabel } from '@/shared/census/censusPresentation';

interface ResolveDeliveryRoutePopoverPositionParams {
  buttonRect: DOMRect;
  panelWidth: number;
  viewportWidth: number;
  viewportPadding?: number;
  offsetY?: number;
}

export const resolveDeliveryRoutePopoverPosition = ({
  buttonRect,
  panelWidth,
  viewportWidth,
  viewportPadding = 8,
  offsetY = 4,
}: ResolveDeliveryRoutePopoverPositionParams): { top: number; left: number } => {
  const preferredLeft = buttonRect.left - panelWidth + buttonRect.width;
  const maxLeft = viewportWidth - panelWidth - viewportPadding;
  const left = Math.max(viewportPadding, Math.min(preferredLeft, maxLeft));

  return {
    top: buttonRect.bottom + offsetY,
    left,
  };
};

export const resolveDeliveryRouteIconColor = (
  hasPersistedData: boolean,
  route?: DeliveryRoute
): string => {
  if (!hasPersistedData) {
    return 'text-slate-300 hover:text-slate-400';
  }

  if (route === 'Vaginal') {
    return 'text-pink-500';
  }

  if (route === 'Cesárea') {
    return 'text-blue-500';
  }

  return 'text-slate-400';
};

export const resolveDeliveryRouteTitle = (
  route?: DeliveryRoute,
  date?: string,
  cesareanLabor?: CesareanLabor
): string => {
  if (!route) {
    return 'Vía del parto';
  }

  if (route === 'Cesárea' && cesareanLabor) {
    return `${route} (${cesareanLabor}) - ${formatCensusRouteDateLabel(date)}`;
  }

  return `${route} - ${formatCensusRouteDateLabel(date)}`;
};
