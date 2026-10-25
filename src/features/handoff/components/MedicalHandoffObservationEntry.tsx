import React from 'react';
import clsx from 'clsx';
import type { MedicalHandoffEntry, PatientData } from '@/domain/handoff/patientContracts';
import { CheckCircle, Plus, Trash2 } from 'lucide-react';
import { MedicalHandoffDraftTextarea } from './MedicalHandoffDraftTextarea';
import {
  resolveMedicalEntryInlineMeta,
  resolveMedicalHandoffValidityViewModel,
} from '@/domain/handoff/patientView';

interface MedicalHandoffObservationEntryProps {
  entry: MedicalHandoffEntry;
  patient: PatientData;
  reportDate: string;
  index: number;
  entriesCount: number;
  isFieldReadOnly: boolean;
  specialtyOptions: string[];
  canEditSpecialty?: boolean;
  onEntryNoteChange: (entryId: string, value: string) => unknown;
  onEditingChange?: (editing: boolean) => void;
  onEntrySpecialtyChange?: (entryId: string, specialty: string) => void;
  onAddEntry?: () => void;
  onDeleteEntry?: (entryId: string) => void;
  onRefreshAsCurrent?: (entryId: string) => void;
}

export const MedicalHandoffObservationEntry: React.FC<MedicalHandoffObservationEntryProps> = ({
  entry,
  patient,
  reportDate,
  index,
  entriesCount,
  isFieldReadOnly,
  specialtyOptions,
  canEditSpecialty = true,
  onEntryNoteChange,
  onEditingChange,
  onEntrySpecialtyChange,
  onAddEntry,
  onDeleteEntry,
  onRefreshAsCurrent,
}) => {
  const validity = resolveMedicalHandoffValidityViewModel(entry, reportDate);
  const authorMeta = resolveMedicalEntryInlineMeta(entry);
  const specialtyLabel = entry.specialty || 'Especialidad sin definir';
  const specialtyWidth = `${Math.max(String(specialtyLabel).length + 4, 14)}ch`;

  return (
    <div
      className={clsx(
        'space-y-1',
        index > 0 && 'border-t border-slate-100 pt-2 print:border-t-0 print:pt-1'
      )}
    >
      {/* Print-only compact summary */}
      <div className="hidden print:block text-[7px] leading-tight text-slate-500">
        {[specialtyLabel, authorMeta].filter(Boolean).join(' · ')}
      </div>

      {/* Header row: specialty + author + actions */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] leading-tight text-slate-500 print:hidden">
        {/* Specialty */}
        {!isFieldReadOnly && canEditSpecialty && onEntrySpecialtyChange ? (
          <>
            <label className="sr-only" htmlFor={`medical-specialty-${patient.bedId}-${entry.id}`}>
              Especialidad {index + 1}
            </label>
            <select
              id={`medical-specialty-${patient.bedId}-${entry.id}`}
              aria-label={`Especialidad ${index + 1}`}
              value={entry.specialty}
              onChange={event => onEntrySpecialtyChange(entry.id, event.target.value)}
              className="rounded-full border border-slate-200/80 bg-white px-2 py-0.5 text-[9px] font-medium text-slate-500"
              style={{ width: specialtyWidth }}
            >
              {specialtyOptions.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="rounded-full border border-slate-200/80 bg-white px-2 py-0.5 text-[9px] font-medium text-slate-500">
            {specialtyLabel}
          </span>
        )}

        {/* Author + timestamp */}
        {authorMeta && <span className="text-slate-400">{authorMeta}</span>}

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1">
          {/* Validate button — only visible when note is from a previous day.
              Once validated, updatedAt matches reportDate so the button hides. */}
          {!isFieldReadOnly &&
            onRefreshAsCurrent &&
            !validity.isActiveToday &&
            validity.canRefreshAsCurrent && (
              <button
                type="button"
                onClick={() => onRefreshAsCurrent(entry.id)}
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-100"
                aria-label="Validar nota"
                title="Validar nota como vigente para hoy"
              >
                <CheckCircle size={10} />
                Validar
              </button>
            )}
          {!isFieldReadOnly && onAddEntry && index === entriesCount - 1 && (
            <button
              type="button"
              onClick={onAddEntry}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
              aria-label="Agregar otra especialidad"
              title="Agregar otra especialidad"
            >
              <Plus size={11} />
            </button>
          )}
          {onDeleteEntry && (
            <button
              type="button"
              onClick={() => onDeleteEntry(entry.id)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
              aria-label={`Eliminar entrega ${index + 1}`}
              title="Eliminar entrega de turno"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Note content */}
      {isFieldReadOnly ? (
        <div className="whitespace-pre-wrap break-words text-[13px] leading-snug text-slate-800 print:text-[8px] print:leading-tight">
          {entry.note || <span className="text-slate-400 italic">Sin entrega registrada</span>}
        </div>
      ) : (
        <>
          <div className="print:hidden">
            <MedicalHandoffDraftTextarea
              patient={patient}
              reportDate={reportDate}
              entryId={entry.id}
              value={entry.note}
              onChangeValue={value => onEntryNoteChange(entry.id, value)}
              onEditingChange={onEditingChange}
            />
          </div>
          <div className="hidden print:block whitespace-pre-wrap break-words text-slate-800 print:text-[8px] print:leading-tight">
            {entry.note}
          </div>
        </>
      )}
    </div>
  );
};
