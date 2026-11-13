import type { CesareanLabor, DeliveryRoute } from '@/types/domain/patient';

import clsx from 'clsx';

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
