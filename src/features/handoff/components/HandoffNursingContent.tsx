import React, { useMemo } from 'react';
import type { BedDefinition } from '@/types/domain/beds';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import { HandoffPatientTable } from './HandoffPatientTable';
import { MovementsSummary } from './MovementsSummary';
import { HandoffNovedades } from './HandoffNovedades';
import type { HandoffClinicalEventActions } from './handoffRowContracts';
import { buildHandoffNovedadesBindings } from '@/features/handoff/controllers/handoffViewController';

interface HandoffNursingContentProps {
  visibleBeds: BedDefinition[];
  record: HandoffDailyRecordContract;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift';
  onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
  tableHeaderClass: string;
  readOnly: boolean;
  hasAnyPatients: boolean;
  shouldShowPatient: (bedId: string) => boolean;
  clinicalEventActions: HandoffClinicalEventActions;
  selectedShift: 'day' | 'night';
  updateHandoffNovedades: (shift: 'day' | 'night', value: string) => void;
}

export const HandoffNursingContent: React.FC<HandoffNursingContentProps> = ({
  visibleBeds,
  record,
  noteField,
  onNoteChange,
  tableHeaderClass,
  readOnly,
  hasAnyPatients,
  shouldShowPatient,
  clinicalEventActions,
  selectedShift,
  updateHandoffNovedades,
}) => {
  const handoffNovedadesDayShift = record.handoffNovedadesDayShift;
  const handoffNovedadesNightShift = record.handoffNovedadesNightShift;
  const handoffNovedadesBindings = useMemo(
    () =>
      buildHandoffNovedadesBindings({
        selectedShift,
        record: {
          handoffNovedadesDayShift,
          handoffNovedadesNightShift,
        },
        readOnly,
        onUpdateHandoffNovedades: updateHandoffNovedades,
      }),
    [
      selectedShift,
      handoffNovedadesDayShift,
      handoffNovedadesNightShift,
      readOnly,
      updateHandoffNovedades,
    ]
  );

  return (
    <>
      <HandoffPatientTable
        visibleBeds={visibleBeds}
        record={record}
        noteField={noteField}
        onNoteChange={onNoteChange}
        tableHeaderClass={tableHeaderClass}
        readOnly={readOnly}
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
