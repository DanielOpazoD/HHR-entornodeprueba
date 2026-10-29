import React from 'react';
import {
  FileClock,
  FileText,
  Pencil,
  Repeat2,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { CensusMovementActionKind } from '@/features/census/types/censusMovementActionTypes';

export const MOVEMENT_ACTION_BUTTON_CLASS =
  'census-movement-action inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600';

const ACTION_ICONS = {
  undo: RotateCcw,
  viewDocuments: FileText,
  hospitalizationReports: FileClock,
  edit: Pencil,
  delete: Trash2,
  convert: Repeat2,
} satisfies Record<CensusMovementActionKind, LucideIcon>;

export const renderCensusMovementActionIcon = (kind: CensusMovementActionKind) => {
  const Icon = ACTION_ICONS[kind];
  return <Icon size={14} aria-hidden="true" />;
};
