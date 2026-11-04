/** Header switch for this computer's census view; see `useCensusViewPreferences`. */

import React from 'react';
import { AlertTriangle, Columns3 } from 'lucide-react';
import { setCensusViewPreference } from '@/features/census/hooks/useCensusViewPreferences';

const toggleClassName =
  'inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-700 print:hidden';

export const AlertsViewToggle: React.FC<{ active: boolean }> = ({ active }) => (
  <button
    type="button"
    aria-pressed={active}
    title={
      active
        ? 'Volver a Signos, DMI, Scores y UPC'
        : 'Ver las alertas de la ficha en lugar de Signos, DMI, Scores y UPC'
    }
    onClick={() => setCensusViewPreference({ alertsView: !active })}
    className={toggleClassName}
    data-testid="census-alerts-view-toggle"
  >
    {active ? (
      <Columns3 size={10} aria-hidden="true" />
    ) : (
      <AlertTriangle size={10} aria-hidden="true" />
    )}
    {active ? 'Columnas' : 'Alertas'}
  </button>
);
