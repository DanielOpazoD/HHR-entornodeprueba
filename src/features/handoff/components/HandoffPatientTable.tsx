import type { PatientData } from '@/types/domain/patient';

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BedDefinition } from '@/types/domain/beds';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';

import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import {
  buildSpecialistHandoffIdentity,
  specialistHandoffIdentityKey,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { resolveHandoffPatientRowPlan } from '@/features/handoff/controllers/handoffPatientTableController';
import { HandoffRow } from './HandoffRow';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { HandoffClinicalEventActions } from './handoffRowContracts';

/** Rows remount when the patient or episode changes, never only by bed. */
const handoffPatientKey = (patient: PatientData): string =>
  specialistHandoffIdentityKey(buildSpecialistHandoffIdentity(patient));

interface HandoffPatientTableProps {
  visibleBeds: BedDefinition[];
  record: HandoffDailyRecordContract;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift';
  onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
  tableHeaderClass: string;
  readOnly: boolean;
  hasAnyPatients: boolean;
  shouldShowPatient: (bedId: string) => boolean;
  clinicalEventActions?: HandoffClinicalEventActions;
}

type HandoffNoteField = 'handoffNoteDayShift' | 'handoffNoteNightShift';

interface HandoffTableBedRowProps {
  bedId: string;
  bedName: string;
  bedType: string;
  patient: PatientData;
  reportDate: string;
  isNested: boolean;
  noteField: HandoffNoteField;
  readOnly: boolean;
  forcedExpand?: boolean;
  hasEventAdd: boolean;
  hasEventUpdate: boolean;
  hasEventDelete: boolean;
  onBedNoteChange: (
    bedId: string,
    isNested: boolean,
    patient: PatientData,
    capturedScopeKey: string,
    value: string
  ) => void;
  onEventAdd: (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
  onEventUpdate: (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => void;
  onEventDelete: (bedId: string, eventId: string) => void;
}

const HandoffTableBedRow = React.memo(function HandoffTableBedRow({
  bedId,
  bedName,
  bedType,
  patient,
  reportDate,
  isNested,
  noteField,
  readOnly,
  forcedExpand,
  hasEventAdd,
  hasEventUpdate,
  hasEventDelete,
  onBedNoteChange,
  onEventAdd,
  onEventUpdate,
  onEventDelete,
}: HandoffTableBedRowProps) {
  const handleNoteChange = useCallback(
    (value: string) =>
      onBedNoteChange(bedId, isNested, patient, `${reportDate}::${noteField}`, value),
    [bedId, isNested, noteField, onBedNoteChange, patient, reportDate]
  );

  const rowClinicalEventActions = useMemo(
    () => ({
      onAdd: hasEventAdd
        ? (event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => onEventAdd(bedId, event)
        : undefined,
      onUpdate: hasEventUpdate
        ? (eventId: string, data: Partial<ClinicalEvent>) => onEventUpdate(bedId, eventId, data)
        : undefined,
      onDelete: hasEventDelete ? (eventId: string) => onEventDelete(bedId, eventId) : undefined,
    }),
    [bedId, hasEventAdd, hasEventDelete, hasEventUpdate, onEventAdd, onEventDelete, onEventUpdate]
  );

  return (
    <HandoffRow
      bedName={bedName}
      bedType={bedType}
      patient={patient}
      reportDate={reportDate}
      isSubRow={isNested}
      noteField={noteField}
      onNoteChange={handleNoteChange}
      readOnly={readOnly}
      forcedExpand={forcedExpand}
      clinicalEventActions={rowClinicalEventActions}
    />
  );
});

export const HandoffPatientTable: React.FC<HandoffPatientTableProps> = ({
  visibleBeds,
  record,
  noteField,
  onNoteChange,
  tableHeaderClass,
  readOnly,
  hasAnyPatients,
  shouldShowPatient,
  clinicalEventActions,
}) => {
  const [allEventsExpanded, setAllEventsExpanded] = useState(false);

  const currentRecord = useRef(record);
  // Keep one note-change handler per date+shift scope so a pending debounced edit started
  // before a shift or date switch (e.g. set-shift without blur) still saves to its original scope.
  const onNoteChangeByScopeRef = useRef<Record<string, HandoffPatientTableProps['onNoteChange']>>(
    {}
  );
  const clinicalEventActionsRef = useRef(clinicalEventActions);
  useLayoutEffect(() => {
    currentRecord.current = record;
    onNoteChangeByScopeRef.current[`${record.date}::${noteField}`] = onNoteChange;
    clinicalEventActionsRef.current = clinicalEventActions;
  }, [record, noteField, onNoteChange, clinicalEventActions]);

  const handleBedNoteChange = useCallback(
    (
      bedId: string,
      isNested: boolean,
      patient: PatientData,
      capturedScopeKey: string,
      value: string
    ) => {
      const bed = currentRecord.current.beds[bedId];
      const current = isNested ? bed?.clinicalCrib : bed;
      if (current && handoffPatientKey(current) === handoffPatientKey(patient)) {
        onNoteChangeByScopeRef.current[capturedScopeKey]?.(bedId, value, isNested);
      }
    },
    []
  );

  const handleEventAdd = useCallback(
    (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => {
      clinicalEventActionsRef.current?.onAdd?.(bedId, event);
    },
    []
  );

  const handleEventUpdate = useCallback(
    (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => {
      clinicalEventActionsRef.current?.onUpdate?.(bedId, eventId, data);
    },
    []
  );

  const handleEventDelete = useCallback((bedId: string, eventId: string) => {
    clinicalEventActionsRef.current?.onDelete?.(bedId, eventId);
  }, []);

  const hasEventAdd = Boolean(clinicalEventActions?.onAdd);
  const hasEventUpdate = Boolean(clinicalEventActions?.onUpdate);
  const hasEventDelete = Boolean(clinicalEventActions?.onDelete);

  const renderRow = (
    bed: BedDefinition,
    patient: PatientData,
    options: { isNested: boolean; forcedExpand?: boolean }
  ) => (
    <HandoffTableBedRow
      key={`${bed.id}-${options.isNested ? 'crib' : 'main'}:${handoffPatientKey(patient)}`}
      bedId={bed.id}
      bedName={bed.name}
      bedType={options.isNested ? 'Cuna' : bed.type}
      patient={patient}
      reportDate={record.date}
      isNested={options.isNested}
      noteField={noteField}
      readOnly={readOnly}
      forcedExpand={options.forcedExpand}
      hasEventAdd={hasEventAdd}
      hasEventUpdate={hasEventUpdate}
      hasEventDelete={hasEventDelete}
      onBedNoteChange={handleBedNoteChange}
      onEventAdd={handleEventAdd}
      onEventUpdate={handleEventUpdate}
      onEventDelete={handleEventDelete}
    />
  );

  return (
    <div className="handoff-patient-table bg-white rounded-2xl shadow-sm border border-slate-200/80 ring-1 ring-black/[0.02] overflow-hidden print:shadow-none print:border-none print:rounded-none print:overflow-visible">
      <p id="nursing-handoff-scroll-hint" className="handoff-scroll-hint">
        Desliza para ver diagnóstico, dispositivos y observaciones →
      </p>
      <div
        className="handoff-patients overflow-x-auto"
        role="region"
        aria-label="Pacientes de entrega de enfermería"
        aria-describedby="nursing-handoff-scroll-hint"
        tabIndex={0}
      >
        <table className="w-full table-fixed text-left border-collapse print:[&_th]:p-1 print:[&_td]:p-1 print:[&_th]:text-[10px] print:[&_td]:text-[10px]">
          <thead>
            <tr className={tableHeaderClass}>
              <th
                scope="col"
                className="p-2 border-r border-slate-200/60 w-16 print:w-[35px] print:text-[10px] print:p-1"
              >
                Cama
              </th>
              <th
                scope="col"
                className="p-2 border-r border-slate-200/60 w-44 print:w-[20%] print:text-[10px] print:p-1"
                title="Nombre, RUT, Edad, Fecha de Ingreso"
              >
                Paciente
              </th>
              <th
                scope="col"
                className="p-2 border-r border-slate-200/60 w-[220px] print:w-[26%] print:text-[10px] print:p-1"
              >
                <div className="flex items-center justify-between">
                  <span>Diagnóstico</span>
                  {clinicalEventActions && (
                    <button
                      onClick={() => setAllEventsExpanded(!allEventsExpanded)}
                      className="p-1 hover:bg-black/5 rounded transition-colors print:hidden flex items-center justify-center"
                      title={
                        allEventsExpanded
                          ? 'Colapsar todos los eventos'
                          : 'Expandir todos los eventos'
                      }
                    >
                      {allEventsExpanded ? (
                        <Minimize2 size={12} className="opacity-70" />
                      ) : (
                        <Maximize2 size={12} className="opacity-70" />
                      )}
                    </button>
                  )}
                </div>
              </th>
              <th
                scope="col"
                className="p-2 border-r border-slate-200/60 w-28 print:w-[50px] print:text-[10px] print:p-1"
                title="Dispositivos médicos invasivos"
              >
                DMI
              </th>
              <th
                scope="col"
                className="p-2 print:w-[35%] print:min-w-0 print:text-[10px] print:p-1"
              >
                Observaciones
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleBeds.map(bed => {
              const rowPlan = resolveHandoffPatientRowPlan(bed, record.beds[bed.id], {
                shouldShowPatient,
              });

              if (!rowPlan.shouldRender) {
                return null;
              }

              return (
                <React.Fragment key={bed.id}>
                  {rowPlan.shouldRenderMainRow
                    ? renderRow(bed, rowPlan.basePatient, {
                        isNested: false,
                        forcedExpand: allEventsExpanded,
                      })
                    : null}
                  {rowPlan.shouldRenderClinicalCrib && rowPlan.basePatient.clinicalCrib
                    ? renderRow(bed, rowPlan.basePatient.clinicalCrib, {
                        isNested: true,
                        forcedExpand: allEventsExpanded,
                      })
                    : null}
                </React.Fragment>
              );
            })}

            {!hasAnyPatients && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400 italic text-sm">
                  No hay pacientes registrados en este turno.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
