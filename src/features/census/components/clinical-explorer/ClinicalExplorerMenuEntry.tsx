import React from 'react';
import { createPortal } from 'react-dom';
import { Compass } from 'lucide-react';
import { useCensusToolbarMenuTarget } from '@/shared/ui/CensusToolbarMenuTargetContext';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import { openClinicalExplorer } from './clinicalExplorerStore';

interface ClinicalExplorerMenuEntryProps {
  censusDate: string;
  patients: ClinicalExplorerPatient[];
}

/** Entry in the date-bar «⋯» menu, owned by the census like the medical handoff action. */
export const ClinicalExplorerMenuEntry: React.FC<ClinicalExplorerMenuEntryProps> = ({
  censusDate,
  patients,
}) => {
  const target = useCensusToolbarMenuTarget();
  const first = patients[0];
  if (!target) return null;
  return createPortal(
    <button
      type="button"
      data-census-menu-action
      data-testid="clinical-explorer-menu-entry"
      disabled={!first}
      onClick={() => first && openClinicalExplorer({ censusDate, bedId: first.bedId })}
      className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50`}
      title={
        first
          ? 'Evoluciones, signos vitales, laboratorio, imágenes e indicaciones de los pacientes del censo'
          : 'Sin pacientes con RUT y episodio en este censo'
      }
    >
      <Compass size={13} aria-hidden="true" />
      <span>Explorador clínico</span>
      <span className="ml-1 rounded-full border border-dashed border-slate-400 px-1.5 text-[8px] font-bold uppercase tracking-wider text-slate-500">
        Experimental
      </span>
    </button>,
    target
  );
};
