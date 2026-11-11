import React from 'react';
import type { BedDefinition } from '@/types/domain/beds';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import { HandoffPatientTable } from './HandoffPatientTable';
import { MovementsSummary } from './MovementsSummary';
import { HandoffNovedades } from './HandoffNovedades';
import type { HandoffClinicalEventActions, HandoffMedicalActions } from './handoffRowContracts';
import { buildHandoffNovedadesBindings } from '@/features/handoff/controllers/handoffViewController';

interface HandoffNursingContentProps {
  visibleBeds: BedDefinition[];
  record: HandoffDailyRecordContract;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift' | 'medicalHandoffNote';
  onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
  medicalActions: HandoffMedicalActions;
  tableHeaderClass: string;
  readOnly: boolean;
  hasAnyPatients: boolean;
  shouldShowPatient: (bedId: string) => boolean;
  clinicalEventActions: HandoffClinicalEventActions;
  selectedShift: 'day' | 'night';
  updateHandoffNovedades: (shift: 'day' | 'night' | 'medical', value: string) => void;
}

export const HandoffNursingContent: React.FC<HandoffNursingContentProps> = ({
  visibleBeds,
  record,
  noteField,
  onNoteChange,
  medicalActions,
  tableHeaderClass,
  readOnly,
  hasAnyPatients,
  shouldShowPatient,
  clinicalEventActions,
  selectedShift,
  updateHandoffNovedades,
}) => {
  const handoffNovedadesBindings = buildHandoffNovedadesBindings({
    isMedical: false,
    selectedShift,
    record,
    readOnly,
    onUpdateHandoffNovedades: updateHandoffNovedades,
  });

  return (
    <>
      <HandoffPatientTable
        visibleBeds={visibleBeds}
        record={record}
        noteField={noteField}
        onNoteChange={onNoteChange}
        medicalActions={medicalActions}
        tableHeaderClass={tableHeaderClass}
        readOnly={readOnly}
        isMedical={false}
        hasAnyPatients={hasAnyPatients}
        shouldShowPatient={shouldShowPatient}
        clinicalEventActions={clinicalEventActions}
      />

      <div className="hidden print:block print:h-4" aria-hidden="true" />

      <MovementsSummary record={record} selectedShift={selectedShift} />

      <HandoffNovedades
        value={handoffNovedadesBindings.value}
        onChange={handoffNovedadesBindings.onChange}
        readOnly={handoffNovedadesBindings.readOnly}
      />
    </>
  );
};
