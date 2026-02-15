import {
  Ambulance,
  ArrowRightLeft,
  Copy,
  LogOut,
  Scissors,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type {
  ClinicalPatientRowAction,
  UtilityPatientRowAction,
} from '@/features/census/types/patientRowActionTypes';

export interface UtilityActionConfig {
  action: UtilityPatientRowAction;
  label: string;
  title: string;
  icon: LucideIcon;
  iconClassName: string;
  visibleWhenBlocked: boolean;
}

export interface ClinicalActionConfig {
  action: ClinicalPatientRowAction;
  label: string;
  icon: LucideIcon;
  iconClassName: string;
}

export const UTILITY_ACTIONS: readonly UtilityActionConfig[] = [
  {
    action: 'clear',
    label: 'Limpiar',
    title: 'Borrar datos',
    icon: Trash2,
    iconClassName: 'hover:text-red-600',
    visibleWhenBlocked: true,
  },
  {
    action: 'copy',
    label: 'Copiar',
    title: 'Copiar a otro día',
    icon: Copy,
    iconClassName: 'hover:text-blue-600',
    visibleWhenBlocked: false,
  },
  {
    action: 'move',
    label: 'Mover',
    title: 'Mover de cama',
    icon: ArrowRightLeft,
    iconClassName: 'hover:text-amber-600',
    visibleWhenBlocked: false,
  },
] as const;

export const CLINICAL_ACTIONS: readonly ClinicalActionConfig[] = [
  {
    action: 'discharge',
    label: 'Dar de Alta',
    icon: LogOut,
    iconClassName: 'text-green-600',
  },
  {
    action: 'transfer',
    label: 'Trasladar',
    icon: Ambulance,
    iconClassName: 'text-blue-600',
  },
  {
    action: 'cma',
    label: 'Egreso CMA',
    icon: Scissors,
    iconClassName: 'text-orange-600',
  },
] as const;

export const getVisibleUtilityActions = (isBlocked: boolean): UtilityActionConfig[] =>
  UTILITY_ACTIONS.filter(action => action.visibleWhenBlocked || !isBlocked);
