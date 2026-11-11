import type { PatientData } from '@/types/domain/patient';

import React from 'react';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';

import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { ClinicalEventsPanel } from './ClinicalEventsPanel';
import { resolveClinicalEventsCellState } from '@/features/handoff/controllers/handoffRowCellsController';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';

interface HandoffDiagnosisCellProps {
  patient: PatientData;
  isMedical: boolean;
  isSubRow: boolean;
  showEvents: boolean;
  setShowEvents: (val: boolean) => void;
  hasEvents: boolean;
  isFieldReadOnly: boolean;
  onClinicalEventAdd?: (event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
  onClinicalEventUpdate?: (eventId: string, data: Partial<ClinicalEvent>) => void;
  onClinicalEventDelete?: (eventId: string) => void;
}

export const HandoffDiagnosisCell: React.FC<HandoffDiagnosisCellProps> = ({
  patient,
  isMedical,
  isSubRow,
  showEvents,
  setShowEvents,
  hasEvents,
  isFieldReadOnly,
  onClinicalEventAdd,
  onClinicalEventUpdate,
  onClinicalEventDelete,
}) => {
  const canManageEvents =
    Boolean(onClinicalEventAdd) && Boolean(onClinicalEventUpdate) && Boolean(onClinicalEventDelete);
  const clinicalEventsCellState = resolveClinicalEventsCellState({
    patientStatus: patient.status,
    isSubRow,
    hasEvents,
    canAdd: Boolean(onClinicalEventAdd),
    canUpdate: Boolean(onClinicalEventUpdate),
    canDelete: Boolean(onClinicalEventDelete),
    showEvents,
    isMedical,
  });
  const { canToggleEvents, shouldRenderEventsPanel, showStatusBadge, statusVariant } =
    clinicalEventsCellState;

  return (
    <td className="p-1.5 border-r border-slate-200/60 w-[220px] text-slate-700 align-top relative print:w-20 print:text-[10px] print:leading-tight print:p-1">
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-0">
          <div className="font-medium leading-tight flex-1 pr-6">{patient.pathology}</div>
          {canToggleEvents && (
            <button
              onClick={() => setShowEvents(!showEvents)}
              className={clsx(
                'absolute top-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded transition-all print:hidden',
                hasEvents
                  ? 'text-medical-600 bg-medical-50/80 hover:bg-medical-100 shadow-sm border border-medical-100'
                  : 'text-slate-400 hover:text-slate-600 border border-transparent'
              )}
              title={showEvents ? 'Ocultar eventos' : 'Ver eventos clínicos'}
            >
              <ChevronDown
                size={10}
                className={clsx('transition-transform', showEvents && 'rotate-180')}
              />
            </button>
          )}
        </div>

        {showStatusBadge && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200 flex justify-start">
            <MedicalBadge variant={statusVariant} className="text-center">
              {patient.status}
            </MedicalBadge>
          </div>
        )}

        {shouldRenderEventsPanel &&
          canManageEvents &&
          onClinicalEventAdd &&
          onClinicalEventUpdate &&
          onClinicalEventDelete && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <ClinicalEventsPanel
                events={patient.clinicalEvents || []}
                onAdd={onClinicalEventAdd}
                onUpdate={onClinicalEventUpdate}
                onDelete={onClinicalEventDelete}
                readOnly={isFieldReadOnly}
              />
            </div>
          )}
      </div>
    </td>
  );
};
