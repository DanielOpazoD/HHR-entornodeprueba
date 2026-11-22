import type { PatientData } from '@/types/domain/patient';

import React, { useState } from 'react';

import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import { AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { calculateOperationalHospitalizedDays } from '@/utils/clinicalDayUtils';
import { useDailyRecordStability } from '@/context/DailyRecordContext';
import { HandoffBedCell } from './HandoffBedCell';
import { HandoffPatientCell } from './HandoffPatientCell';
import { HandoffDiagnosisCell } from './HandoffDiagnosisCell';
import { HandoffDevicesCell } from './HandoffDevicesCell';
import { HandoffObservationsCell } from './HandoffObservationsCell';
import { resolveHandoffRowReadOnly } from '@/features/handoff/controllers/handoffRowController';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

// ============================================================================
// HandoffRow Component
// ============================================================================

interface HandoffRowClinicalEventActions {
  onAdd?: (event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
  onUpdate?: (eventId: string, data: Partial<ClinicalEvent>) => void;
  onDelete?: (eventId: string) => void;
}

interface HandoffRowProps {
  bedName: string;
  bedType?: string; // Kept for compatibility if needed elsewhere
  patient: PatientData;
  reportDate: string;
  isSubRow?: boolean;
  noteField: keyof PatientData; // Dynamic field
  onNoteChange: (val: string) => void;
  readOnly?: boolean;
  forcedExpand?: boolean;
  clinicalEventActions?: HandoffRowClinicalEventActions;
}

const DENY_ALL_FIELDS = () => false;

export const HandoffRow: React.FC<HandoffRowProps> = ({
  bedName,
  patient,
  reportDate,
  isSubRow = false,
  noteField,
  onNoteChange,
  readOnly = false,
  forcedExpand = false,
  clinicalEventActions,
}) => {
  const stabilityRules = useDailyRecordStability();
  const [showEvents, setShowEvents] = useState(false);

  // Sync with global expansion
  if (useChangedOnRender([forcedExpand])) setShowEvents(forcedExpand);

  const hasEvents = (patient.clinicalEvents?.length || 0) > 0;

  // If bed is blocked (and not a sub-row), show blocked status
  if (!isSubRow && patient.isBlocked) {
    return (
      <tr className="bg-slate-50 border-b border-slate-200 text-sm print:last:border-b-0 print:text-[10px]">
        <td className="p-2 font-semibold text-slate-700 text-center align-middle border-r border-slate-200 print:p-1">
          {bedName}
        </td>
        <td
          colSpan={4}
          className="p-2 text-slate-600 align-middle print:p-1 print:whitespace-nowrap"
        >
          <span className="inline-flex items-center gap-1.5 print:gap-1">
            <AlertCircle size={14} className="text-slate-500 print:hidden" />
            <span className="font-medium">BLOQUEADA:</span> {patient.blockedReason || 'Sin motivo'}
          </span>
        </td>
      </tr>
    );
  }

  const isEmpty = !patient.patientName;
  if (isEmpty) return null;

  const daysHospitalized = calculateOperationalHospitalizedDays(patient.admissionDate, reportDate);
  const noteValue = (patient[noteField] as string) || '';
  const isFieldReadOnly = resolveHandoffRowReadOnly({
    readOnly,
    noteField,
    canEditField: stabilityRules?.canEditField ?? DENY_ALL_FIELDS,
  });

  return (
    <tr
      data-nested={isSubRow}
      className={clsx(
        'handoff-patient-row border-b border-slate-100/80 hover:bg-blue-50/30 transition-all duration-150 text-sm print:last:border-b-0',
        isSubRow ? 'bg-pink-50/40 print:!bg-white' : 'bg-white'
      )}
    >
      <HandoffBedCell bedName={bedName} isSubRow={isSubRow} daysHospitalized={daysHospitalized} />

      <HandoffPatientCell patient={patient} isSubRow={isSubRow} />

      <HandoffDiagnosisCell
        patient={patient}
        isSubRow={isSubRow}
        showEvents={showEvents}
        setShowEvents={setShowEvents}
        hasEvents={hasEvents}
        isFieldReadOnly={isFieldReadOnly}
        onClinicalEventAdd={clinicalEventActions?.onAdd}
        onClinicalEventUpdate={clinicalEventActions?.onUpdate}
        onClinicalEventDelete={clinicalEventActions?.onDelete}
      />

      <HandoffDevicesCell patient={patient} reportDate={reportDate} />

      <HandoffObservationsCell
        noteValue={noteValue}
        onNoteChange={onNoteChange}
        isFieldReadOnly={isFieldReadOnly}
      />
    </tr>
  );
};
