import clsx from 'clsx';
import type { CesareanLabor, DeliveryRoute } from '@/types/domain/patient';

import { formatCensusRouteDateLabel } from '@/shared/census/censusPresentation';

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

interface DeliveryRouteOption {
  route: DeliveryRoute;
  label: string;
  selectedColorClassName: string;
}

const ROUTE_OPTIONS: readonly DeliveryRouteOption[] = [
  {
    route: 'Vaginal',
    label: 'Vaginal',
    selectedColorClassName: 'border-pink-200 bg-pink-50 text-pink-700 shadow-sm',
  },
  {
    route: 'Cesárea',
    label: 'Cesárea',
    selectedColorClassName: 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm',
  },
] as const;

export interface DeliveryRouteButtonModel {
  route: DeliveryRoute;
  label: string;
  isSelected: boolean;
  className: string;
}

export const buildDeliveryRouteButtonModels = (
  selectedRoute: DeliveryRoute | undefined
): DeliveryRouteButtonModel[] =>
  ROUTE_OPTIONS.map(option => ({
    route: option.route,
    label: option.label,
    isSelected: selectedRoute === option.route,
    className: clsx(
      'px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center gap-1',
      selectedRoute === option.route
        ? option.selectedColorClassName
        : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200'
    ),
  }));

interface CesareanLaborOption {
  value: CesareanLabor;
  label: string;
  selectedColorClassName: string;
}

const CESAREAN_LABOR_OPTIONS: readonly CesareanLaborOption[] = [
  {
    value: 'Sin TdP',
    label: 'Sin TdP',
    selectedColorClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm',
  },
  {
    value: 'Con TdP',
    label: 'Con TdP',
    selectedColorClassName: 'border-violet-200 bg-violet-50 text-violet-700 shadow-sm',
  },
] as const;

export interface CesareanLaborButtonModel {
  value: CesareanLabor;
  label: string;
  isSelected: boolean;
  className: string;
}

export const buildCesareanLaborButtonModels = (
  selectedCesareanLabor: CesareanLabor | undefined
): CesareanLaborButtonModel[] =>
  CESAREAN_LABOR_OPTIONS.map(option => ({
    value: option.value,
    label: option.label,
    isSelected: selectedCesareanLabor === option.value,
    className: clsx(
      'px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center gap-1',
      selectedCesareanLabor === option.value
        ? option.selectedColorClassName
        : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200'
    ),
  }));

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
