import React from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { useCensusToolbarMenuTarget } from '@/shared/ui/CensusToolbarMenuTargetContext';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';
import { resolveResetDayMenuEntryState } from '@/features/census/controllers/censusResetDayController';

interface CensusResetDayMenuEntryProps {
  readOnly: boolean;
  canDeleteRecord: boolean;
  deniedMessage: string;
  onClearAll: () => Promise<void>;
}

/** «Limpiar datos del día» in the date-bar «⋯» menu, with the census confirmation and permissions. */
export const CensusResetDayMenuEntry: React.FC<CensusResetDayMenuEntryProps> = ({
  readOnly,
  canDeleteRecord,
  deniedMessage,
  onClearAll,
}) => {
  const target = useCensusToolbarMenuTarget();
  const state = resolveResetDayMenuEntryState({ readOnly, canDeleteRecord, deniedMessage });
  if (!target || !state.visible) return null;
  return createPortal(
    <button
      type="button"
      data-census-menu-action
      data-testid="census-reset-day-menu-entry"
      disabled={!state.enabled}
      onClick={() => void onClearAll()}
      title={state.title}
      className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-slate-200 bg-slate-50 text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-60`}
    >
      <Trash2 size={13} aria-hidden="true" />
      <span>Limpiar datos del día</span>
    </button>,
    target
  );
};
