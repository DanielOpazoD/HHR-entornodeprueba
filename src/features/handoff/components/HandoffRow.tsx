import React, { useState, useEffect } from 'react';
import { PatientData } from '@/domain/handoff/patientContracts';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import { AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { calculateOperationalHospitalizedDays } from '@/utils/clinicalDayUtils';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import {
  HandoffBedCell,
  HandoffPatientCell,
  HandoffDiagnosisCell,
  HandoffDevicesCell,
  HandoffObservationsCell,
} from './HandoffRowCells';
import { HandoffMedicalObservationsCell } from './HandoffMedicalObservationsCell';
import {
  hasActiveMedicalMutationPaths,
  resolveHandoffRowReadOnly,
  resolveMedicalEntryNoteChangeHandler,
} from '@/features/handoff/controllers/handoffRowController';

// ============================================================================
// HandoffRow Component
// ============================================================================

interface HandoffRowMedicalActions {
  onCreatePrimaryEntry?: () => void;
  onEntryNoteChange?: (entryId: string, value: string) => void;
  onEntrySpecialtyChange?: (entryId: string, specialty: string) => void;
  onEntryAdd?: () => void;
  onEntryDelete?: (entryId: string) => void;
  onRefreshAsCurrent?: (entryId: string) => void;
}

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
  medicalActions?: HandoffRowMedicalActions;
  readOnly?: boolean;
  isMedical?: boolean;
  forcedExpand?: boolean;
  clinicalEventActions?: HandoffRowClinicalEventActions;
}

export const HandoffRow: React.FC<HandoffRowProps> = ({
  bedName,
  patient,
  reportDate,
  isSubRow = false,
  noteField,
  onNoteChange,
  medicalActions,
  readOnly = false,
  isMedical = false,
  forcedExpand = false,
  clinicalEventActions,
}) => {
  const { stabilityRules } = useDailyRecordData();
  const [showEvents, setShowEvents] = useState(false);

  // Sync with global expansion
  useEffect(() => {
    setShowEvents(forcedExpand);
  }, [forcedExpand]);

  const hasEvents = (patient.clinicalEvents?.length || 0) > 0;
  const hasMedicalMutationPaths = hasActiveMedicalMutationPaths({
    isMedical,
    onNoteChange,
    medicalActions,
  });

  // If bed is blocked (and not a sub-row), show blocked status
  if (!isSubRow && patient.isBlocked) {
    return (
      <tr className="bg-slate-50 border-b border-slate-200 text-sm print:last:border-b-0 print:text-[10px]">
        <td className="p-2 font-semibold text-slate-700 text-center align-middle border-r border-slate-200 print:p-1">
          {bedName}
        </td>
        <td
          colSpan={isMedical ? 3 : 4}
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
    canEditField: stabilityRules.canEditField,
    hasMedicalMutationPaths,
  });

  return (
    <tr
      className={clsx(
        'border-b border-slate-100/80 hover:bg-blue-50/30 transition-all duration-150 text-sm print:last:border-b-0',
        isSubRow ? 'bg-pink-50/40 print:!bg-white' : 'bg-white'
      )}
    >
      <HandoffBedCell bedName={bedName} isSubRow={isSubRow} daysHospitalized={daysHospitalized} />

      <HandoffPatientCell patient={patient} isSubRow={isSubRow} />

      <HandoffDiagnosisCell
        patient={patient}
        isMedical={isMedical}
        isSubRow={isSubRow}
        showEvents={showEvents}
        setShowEvents={setShowEvents}
        hasEvents={hasEvents}
        isFieldReadOnly={isFieldReadOnly}
        onClinicalEventAdd={clinicalEventActions?.onAdd}
        onClinicalEventUpdate={clinicalEventActions?.onUpdate}
        onClinicalEventDelete={clinicalEventActions?.onDelete}
      />

      {/* DMI column only shown in nursing handoff */}
      {!isMedical && <HandoffDevicesCell patient={patient} reportDate={reportDate} />}

      {isMedical ? (
        <HandoffMedicalObservationsCell
          patient={patient}
          reportDate={reportDate}
          isFieldReadOnly={isFieldReadOnly}
          primaryNoteValue={noteValue}
          onPrimaryNoteChange={onNoteChange}
          onCreatePrimaryEntry={medicalActions?.onCreatePrimaryEntry}
          onEntryNoteChange={resolveMedicalEntryNoteChangeHandler(
            medicalActions?.onEntryNoteChange
          )}
          onEntrySpecialtyChange={medicalActions?.onEntrySpecialtyChange}
          onAddEntry={medicalActions?.onEntryAdd}
          onDeleteEntry={medicalActions?.onEntryDelete}
          onRefreshAsCurrent={medicalActions?.onRefreshAsCurrent}
        />
      ) : (
        <HandoffObservationsCell
          noteValue={noteValue}
          onNoteChange={onNoteChange}
          isFieldReadOnly={isFieldReadOnly}
        />
      )}
    </tr>
  );
};
