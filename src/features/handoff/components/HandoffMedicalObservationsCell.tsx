import {
  resolveMedicalObservationEmptyState,
  shouldShowMedicalPrimaryNoteFallback,
} from '@/features/handoff/controllers/handoffRowCellsController';
import React from 'react';
import type { PatientData } from '@/domain/handoff/patientContracts';
import { MedicalHandoffDraftTextarea } from './MedicalHandoffDraftTextarea';
import { medicalHandoffPatientKey } from './medicalHandoffPatientKey';
import { MedicalHandoffObservationEntry } from './MedicalHandoffObservationEntry';
import { getMedicalHandoffSpecialtyOptions } from '@/domain/handoff/patientEntries';
import { resolveMedicalObservationEntries } from '@/domain/handoff/patientView';

interface HandoffMedicalObservationsCellProps {
  patient: PatientData;
  reportDate: string;
  isFieldReadOnly: boolean;
  primaryNoteValue: string;
  onPrimaryNoteChange: (value: string) => void;
  onCreatePrimaryEntry?: () => void;
  onEntryNoteChange: (entryId: string, value: string) => void;
  onEntrySpecialtyChange?: (entryId: string, specialty: string) => void;
  onAddEntry?: () => void;
  onDeleteEntry?: (entryId: string) => void;
  onRefreshAsCurrent?: (entryId: string) => void;
}

const specialtyOptions = getMedicalHandoffSpecialtyOptions();

export const HandoffMedicalObservationsCell: React.FC<HandoffMedicalObservationsCellProps> = ({
  patient,
  reportDate,
  isFieldReadOnly,
  primaryNoteValue,
  onPrimaryNoteChange,
  onCreatePrimaryEntry,
  onEntryNoteChange,
  onEntrySpecialtyChange,
  onAddEntry,
  onDeleteEntry,
  onRefreshAsCurrent,
}) => {
  const entries = resolveMedicalObservationEntries({
    patient,
    isFieldReadOnly,
    hasCreatePrimaryEntryAction: Boolean(onCreatePrimaryEntry),
  });
  const displayEntries = entries;
  const emptyState = resolveMedicalObservationEmptyState({
    displayEntriesCount: displayEntries.length,
    isFieldReadOnly,
    hasCreatePrimaryEntryAction: Boolean(onCreatePrimaryEntry),
  });
  const showPrimaryNoteFallback = shouldShowMedicalPrimaryNoteFallback({
    entriesCount: displayEntries.length,
    isFieldReadOnly,
    hasCreatePrimaryEntryAction: Boolean(onCreatePrimaryEntry),
  });

  return (
    <td className="p-1.5 w-full min-w-[280px] align-top print:w-auto print:min-w-0 print:text-[8px] print:p-0.5">
      <div className="space-y-2">
        {displayEntries.length === 0 ? (
          emptyState === 'create-entry' && onCreatePrimaryEntry ? (
            <button
              type="button"
              onClick={onCreatePrimaryEntry}
              data-testid="medical-handoff-create-entry-button"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 print:hidden"
            >
              + Crear entrega
            </button>
          ) : emptyState === 'primary-note' && showPrimaryNoteFallback ? (
            <>
              <div className="print:hidden">
                <MedicalHandoffDraftTextarea
                  patient={patient}
                  reportDate={reportDate}
                  entryId="primary-note"
                  value={primaryNoteValue}
                  onChangeValue={onPrimaryNoteChange}
                />
              </div>
              <div className="hidden print:block w-full whitespace-pre-wrap break-words text-slate-800 print:text-[8px] print:leading-tight">
                {primaryNoteValue}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400 italic print:text-[8px]">
              Sin entrega registrada
            </div>
          )
        ) : (
          displayEntries.map((entry, index) => (
            <MedicalHandoffObservationEntry
              key={`${medicalHandoffPatientKey(patient)}:${entry.id}`}
              entry={entry}
              patient={patient}
              reportDate={reportDate}
              index={index}
              entriesCount={displayEntries.length}
              isFieldReadOnly={isFieldReadOnly}
              specialtyOptions={specialtyOptions}
              canEditSpecialty={Boolean(onEntrySpecialtyChange)}
              onEntryNoteChange={onEntryNoteChange}
              onEntrySpecialtyChange={onEntrySpecialtyChange}
              onAddEntry={onAddEntry}
              onDeleteEntry={onDeleteEntry}
              onRefreshAsCurrent={onRefreshAsCurrent}
            />
          ))
        )}
      </div>
    </td>
  );
};
