import React, { useState } from 'react';
import clsx from 'clsx';
import { Check, SquarePen, X } from 'lucide-react';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import type {
  PatientData,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { DebouncedTextHandler } from '@/features/census/components/patient-row/inputCellTypes';

// The clinical status was decoupled from this editor (rediseño 2026): it now lives in its own
// column as a colored dot (StatusSelect). This editor only edits diagnosis + specialty.
interface ClinicalInitialBlockDraft {
  pathology: string;
  specialtySelection: string;
  specialtyOther: string;
}

interface ClinicalInitialBlockEditorProps {
  data: PatientData;
  disabled?: boolean;
  alignRightClassName?: string;
  triggerAriaLabel?: string;
  triggerClassName?: string;
  triggerContent?: React.ReactNode;
  triggerTitle?: string;
  onChange: DebouncedTextHandler;
  onMultipleUpdate?: (fields: PatientRowPatientPatch) => void;
}

const isKnownSpecialtyOption = (specialty: string): boolean =>
  specialty === '' || SPECIALTY_OPTIONS.includes(specialty as (typeof SPECIALTY_OPTIONS)[number]);

const buildClinicalInitialBlockDraft = (data: PatientData): ClinicalInitialBlockDraft => {
  const specialty = data.specialty || '';
  const isKnownSpecialty = isKnownSpecialtyOption(specialty);

  return {
    pathology: data.pathology || '',
    specialtySelection: isKnownSpecialty ? specialty : 'Otro',
    specialtyOther: isKnownSpecialty ? '' : specialty,
  };
};

const buildClinicalInitialBlockPatch = (
  draft: ClinicalInitialBlockDraft
): PatientRowPatientPatch => ({
  pathology: draft.pathology,
  specialty: (draft.specialtySelection === 'Otro'
    ? draft.specialtyOther.trim() || 'Otro'
    : draft.specialtySelection) as PatientData['specialty'],
});

export const ClinicalInitialBlockEditor: React.FC<ClinicalInitialBlockEditorProps> = ({
  data,
  disabled = false,
  alignRightClassName = 'right-1',
  triggerAriaLabel = 'Editar bloque clínico',
  triggerClassName,
  triggerContent,
  triggerTitle = 'Editar bloque clínico',
  onChange,
  onMultipleUpdate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<ClinicalInitialBlockDraft>(() =>
    buildClinicalInitialBlockDraft(data)
  );

  const openEditor = () => {
    setDraft(buildClinicalInitialBlockDraft(data));
    setIsOpen(true);
  };

  const closeEditor = () => {
    setIsOpen(false);
  };

  const saveDraft = () => {
    const patch = buildClinicalInitialBlockPatch(draft);
    if (onMultipleUpdate) {
      onMultipleUpdate(patch);
    } else {
      const fallbackSpecialty =
        draft.specialtySelection === 'Otro'
          ? draft.specialtyOther.trim() || 'Otro'
          : draft.specialtySelection;
      onChange('pathology')(draft.pathology);
      onChange('specialty')(fallbackSpecialty);
    }
    setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={
          triggerClassName ||
          clsx(
            'absolute top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white p-1 text-slate-500 shadow-sm transition-colors',
            'hover:border-medical-300 hover:text-medical-700 focus:outline-none focus:ring-2 focus:ring-medical-500/20',
            disabled && 'cursor-not-allowed opacity-50',
            alignRightClassName
          )
        }
        title={triggerTitle}
        aria-label={triggerAriaLabel}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) {
            openEditor();
          }
        }}
        disabled={disabled}
      >
        {triggerContent || <SquarePen size={12} />}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-8 z-[1000] w-80 rounded-lg border border-slate-200 bg-white shadow-xl"
          data-testid={`clinical-block-editor-${data.bedId}`}
        >
          <button
            type="button"
            className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:text-slate-600"
            title="Cerrar"
            aria-label="Cerrar bloque clínico"
            onClick={closeEditor}
          >
            <X size={13} />
          </button>

          <div className="space-y-2 p-3 pt-4">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                Diagnóstico
              </span>
              <input
                id={`clinical-block-pathology-${data.bedId}`}
                name={`clinical-block-pathology-${data.bedId}`}
                data-testid={`clinical-block-pathology-${data.bedId}`}
                className="h-8 w-full rounded border border-slate-200 px-2 text-[13px] focus:border-medical-500 focus:outline-none focus:ring-2 focus:ring-medical-500/20"
                value={draft.pathology}
                onChange={event =>
                  setDraft(current => ({ ...current, pathology: event.target.value }))
                }
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                Especialidad
              </span>
              <select
                id={`clinical-block-specialty-${data.bedId}`}
                name={`clinical-block-specialty-${data.bedId}`}
                data-testid={`clinical-block-specialty-${data.bedId}`}
                className="h-8 w-full rounded border border-slate-200 px-2 text-[12px] focus:border-medical-500 focus:outline-none focus:ring-2 focus:ring-medical-500/20"
                value={draft.specialtySelection}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    specialtySelection: event.target.value,
                    specialtyOther: event.target.value === 'Otro' ? current.specialtyOther : '',
                  }))
                }
              >
                <option value="">-- Esp --</option>
                {SPECIALTY_OPTIONS.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            {draft.specialtySelection === 'Otro' && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                  Describir especialidad
                </span>
                <input
                  id={`clinical-block-specialty-other-${data.bedId}`}
                  name={`clinical-block-specialty-other-${data.bedId}`}
                  data-testid={`clinical-block-specialty-other-${data.bedId}`}
                  className="h-8 w-full rounded border border-slate-200 px-2 text-[13px] focus:border-medical-500 focus:outline-none focus:ring-2 focus:ring-medical-500/20"
                  value={draft.specialtyOther}
                  onChange={event =>
                    setDraft(current => ({ ...current, specialtyOther: event.target.value }))
                  }
                />
              </label>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="rounded border border-slate-200 px-2 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
                onClick={closeEditor}
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid={`clinical-block-save-${data.bedId}`}
                className="inline-flex items-center gap-1 rounded border border-medical-600 bg-medical-600 px-2 py-1 text-[12px] font-semibold text-white hover:bg-medical-700"
                onClick={saveDraft}
              >
                <Check size={13} />
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
