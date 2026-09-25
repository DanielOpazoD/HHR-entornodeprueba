/**
 * PatientIdentityCell - Celda única de identidad del paciente (rediseño censo 2026)
 *
 * Unifica las antiguas columnas Nombre / RUT / Edad en un solo <td>:
 * - Fila 1: nombre (puede envolver a dos líneas) + edad; la edad abre datos demográficos. El nombre
 *   solo es editable (input real) para cuna RN provisional y camas
 *   vacías (el selector de activación necesita input[name="patientName"]).
 * - Fila 2: RUT en letra pequeña gris, solo lectura, con check de validación
 *   y copia al portapapeles (comportamiento heredado de RutPassportInput).
 *
 * Los componentes NameInput / RutPassportInput / AgeInput se conservan en el
 * repositorio para reactivación futura de las columnas separadas.
 */

import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ArrowRight, X } from 'lucide-react';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import { isValidRut } from '@/utils/rutUtils';
import { formatAge } from '@/utils/ageDisplayUtils';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { useStaffContext } from '@/context/StaffContext';
import {
  findProfessionalByRayenIdentity,
  resolveVisibleTreatingPhysicianName,
} from '@/services/staff/treatingPhysicianCatalog';
import {
  dismissTreatingPhysician,
  isDismissedTreatingPhysician,
} from '@/shared/census/treatingPhysicianDismissal';
import { resolveNameInputState } from './nameInputController';
import { ClinicalPanelTrigger } from './ClinicalPanelTrigger';
import { PatientLaboratoryTrigger } from './PatientLaboratoryTrigger';
import { PatientRadiologyTrigger } from './PatientRadiologyTrigger';
import { SpecialtyChip } from './SpecialtyChip';
import type { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';
import type { PatientRowPatientPatch } from './patientRowContracts';

/** Admission date as "DD-MM-YYYY" for the FI (fecha de ingreso) tag under the name. */
const formatAdmissionShort = (raw?: string): string => {
  const value = (raw ?? '').trim();
  if (!value) return '';
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}-${year}`;
  }
  return '';
};

interface PatientIdentityCellProps extends BaseCellProps {
  currentDateString?: string;
  parentBedId?: string;
  hasRutError: boolean;
  onNameChange: DebouncedTextHandler;
  onMultipleUpdate?: (fields: PatientRowPatientPatch) => void;
  physicianReadOnly?: boolean;
  onOpenDemographics: () => void;
}

export const PatientIdentityCell: React.FC<PatientIdentityCellProps> = ({
  data,
  parentBedId,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  currentDateString,
  hasRutError,
  onNameChange,
  onMultipleUpdate,
  physicianReadOnly = readOnly,
  onOpenDemographics,
}) => {
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle');
  const { professionalsCatalog = [] } = useStaffContext();

  const { fullName, canEditInlineName } = resolveNameInputState({
    data,
    isSubRow,
    isEmpty,
    readOnly,
  });
  const handlePatientNameChange = canEditInlineName ? onNameChange('patientName') : () => undefined;

  const hasNameValidationError =
    !PatientInputSchema.pick({ patientName: true }).safeParse({ patientName: fullName }).success &&
    !!fullName;
  const hasAgeValidationError =
    !PatientInputSchema.pick({ age: true }).safeParse({ age: data.age }).success && !!data.age;

  const documentType = data.documentType || 'RUT';
  const rutValue = (data.rut || '').trim();
  const hasRutValue = rutValue !== '' && rutValue !== '-';
  const isRutMode = documentType === 'RUT';
  const isRutValid = isRutMode && hasRutValue && isValidRut(rutValue);
  const isRutInvalid = isRutMode && hasRutValue && !isRutValid;
  const admissionShort = formatAdmissionShort(data.admissionDate);
  // Especialidad como etiqueta de texto (rediseño 2026): ya no tiene columna propia; se muestra
  // junto a la fecha de ingreso y se edita desde el editor de Diagnóstico.
  const specialtyLabel = (data.specialty || '').trim();
  const specialtyScopeBedId = isSubRow ? parentBedId : data.bedId;
  const matchedPhysician = findProfessionalByRayenIdentity(
    professionalsCatalog,
    data.treatingPhysicianId,
    data.treatingPhysicianName
  );
  const visibleTreatingPhysicianName = isDismissedTreatingPhysician(data, data)
    ? ''
    : resolveVisibleTreatingPhysicianName(
        professionalsCatalog,
        data.treatingPhysicianId,
        data.treatingPhysicianName
      );
  // A real occupant always shows the details row so the specialty chip (or "Pendiente asignar")
  // has a home, even before RUT/edad/FI are filled in.
  const isRealPatient = !isEmpty && !!fullName.trim();
  const showIdentityDetails =
    !isEmpty &&
    (hasRutValue ||
      !!data.age ||
      !!admissionShort ||
      !!specialtyLabel ||
      !!visibleTreatingPhysicianName ||
      isRealPatient);
  const handleSpecialtyAssign = onNameChange('specialty');

  useEffect(() => {
    if (copyFeedback !== 'copied') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyFeedback('idle');
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyFeedback]);

  const handleCopyRut = async () => {
    if (!hasRutValue) {
      return;
    }

    await writeClipboardText(rutValue);
    setCopyFeedback('copied');
  };

  const ageBadge = !isEmpty && !!data.age && (
    <button
      type="button"
      onClick={onOpenDemographics}
      className={clsx(
        'shrink-0 text-[11px] font-medium tabular-nums transition-colors',
        hasAgeValidationError
          ? 'text-red-500 hover:text-red-600'
          : 'text-slate-400 hover:text-medical-600'
      )}
      title="Datos demográficos"
      aria-label="Edad del paciente, abre datos demográficos"
    >
      ({formatAge(data.age)})
    </button>
  );

  return (
    <td className="census-identity-cell py-1 px-1 border-r border-slate-200 align-middle">
      <div className="relative">
        {isSubRow && (
          <div className="absolute left-[-15px] top-2 text-slate-300">
            <ArrowRight size={14} />
          </div>
        )}
        <div className="flex items-center gap-1">
          {canEditInlineName ? (
            <div
              className={clsx(
                'census-identity-name flex min-h-7 w-full min-w-0 flex-1 items-start gap-1 rounded border border-slate-200 bg-slate-50 p-0.5 text-[13px] font-semibold text-slate-700 transition-all duration-200 focus-within:border-medical-400 focus-within:ring-2 focus-within:ring-medical-100',
                hasNameValidationError && 'border-red-400 bg-red-50/50 text-red-700'
              )}
            >
              <div className="group/name relative min-h-6 min-w-0 flex-1">
                <DebouncedInput
                  type="text"
                  name="patientName"
                  className="absolute inset-0 h-full w-full border-0 bg-slate-50 p-0 text-[13px] font-semibold text-inherit opacity-0 focus:opacity-100 focus:outline-none"
                  placeholder="Nombre RN / Niño"
                  value={fullName}
                  onChange={handlePatientNameChange}
                  debounceMs={350}
                />
                <span
                  aria-hidden="true"
                  className="block min-w-0 break-words leading-4 group-focus-within/name:invisible"
                >
                  {fullName || 'Nombre RN / Niño'}
                </span>
              </div>
              {ageBadge}
            </div>
          ) : isEmpty ? (
            <DebouncedInput
              type="text"
              name="patientName"
              className={clsx(
                'w-full min-w-0 flex-1 p-0.5 h-7 border rounded transition-all duration-200 text-[13px] font-semibold',
                'bg-slate-50 text-slate-700 cursor-default border-slate-200',
                hasNameValidationError && 'border-red-400 bg-red-50/50 text-red-700'
              )}
              placeholder=""
              value={fullName}
              readOnly
              onChange={handlePatientNameChange}
              debounceMs={350}
            />
          ) : (
            <div
              className={clsx(
                'census-identity-name relative flex w-full min-w-0 flex-1 items-start gap-1 rounded border bg-slate-50 p-0.5 text-[13px] font-semibold text-slate-700 cursor-default',
                'border-slate-200',
                hasNameValidationError && 'border-red-400 bg-red-50/50 text-red-700'
              )}
            >
              {/*
                Preserve the read-only input as the census/e2e value hook. Its visible text is rendered
                separately so names can wrap naturally instead of being truncated by a one-line input.
              */}
              <input
                type="text"
                name="patientName"
                readOnly
                tabIndex={-1}
                value={fullName}
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 h-px w-px border-0 opacity-0"
              />
              <span
                className={clsx('min-w-0 break-words leading-4', !fullName && 'text-slate-400')}
              >
                {fullName || (isSubRow ? 'Nombre RN / Niño' : 'Nombre Paciente')}
              </span>
              {ageBadge}
            </div>
          )}
          {!isEmpty && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <ClinicalPanelTrigger
                bedId={data.bedId}
                triggerKey={isSubRow ? `${data.bedId}-clinical-crib` : data.bedId}
                patientName={fullName}
                patientRun={data.rut}
                clinicalEpisodeId={data.clinicalEpisodeId}
                encounterRouteHint={data.eloisaManualImportAudit?.encounterRoute}
                admissionDate={data.admissionDate}
                censusDate={currentDateString}
              />
              <PatientLaboratoryTrigger
                patient={data}
                triggerKey={isSubRow ? `${data.bedId}-clinical-crib` : data.bedId}
                censusDate={currentDateString}
              />
              <PatientRadiologyTrigger
                patient={data}
                triggerKey={isSubRow ? `${data.bedId}-clinical-crib` : data.bedId}
              />
            </span>
          )}
        </div>
        {showIdentityDetails && (
          <div className="census-identity-details mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 pl-0.5 text-[10px] leading-tight text-slate-500">
            {hasRutValue ? (
              <>
                <span
                  className={clsx(
                    'whitespace-nowrap tabular-nums',
                    hasRutError && 'text-red-500',
                    isRutMode && 'cursor-pointer hover:text-slate-500'
                  )}
                  title={isRutMode ? 'Click para copiar RUT' : undefined}
                  onClick={isRutMode ? handleCopyRut : undefined}
                >
                  {rutValue}
                </span>
                {!isRutMode && (
                  <span className="text-[9px] font-bold text-slate-400" title="Documento pasaporte">
                    PAS
                  </span>
                )}
                {isRutMode && (
                  <span
                    className={clsx(
                      'pointer-events-none select-none inline-flex w-3 items-center justify-center text-[10px] font-semibold leading-none transition-all duration-200',
                      copyFeedback === 'copied'
                        ? 'scale-110 text-emerald-600'
                        : isRutValid
                          ? 'text-slate-500'
                          : 'text-red-500'
                    )}
                    aria-hidden="true"
                    title={
                      copyFeedback === 'copied'
                        ? 'RUT copiado'
                        : isRutValid
                          ? 'RUT válido'
                          : 'RUT inválido'
                    }
                  >
                    {copyFeedback === 'copied' ? '⧉' : isRutValid ? '✓' : '✕'}
                  </span>
                )}
                {isRutInvalid && <span className="sr-only">RUT inválido</span>}
              </>
            ) : (
              !admissionShort && <span className="italic text-slate-300">Sin documento</span>
            )}
            {admissionShort && (
              <span
                className="flex shrink-0 items-center gap-0.5 tabular-nums text-slate-400"
                title="Fecha de ingreso"
              >
                {hasRutValue && <span className="text-slate-300">/</span>}
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400/90">
                  FI:
                </span>
                {admissionShort}
              </span>
            )}
            <span className="flex min-w-0 items-center gap-1">
              {(hasRutValue || admissionShort) && <span className="text-slate-300">/</span>}
              <SpecialtyChip
                specialty={specialtyLabel}
                decision={data.specialtyAssignment}
                cie10Code={data.cie10Code}
                readOnly={readOnly}
                onAssign={handleSpecialtyAssign}
                scope={
                  currentDateString && specialtyScopeBedId && data.clinicalEpisodeId
                    ? {
                        date: currentDateString,
                        bedId: specialtyScopeBedId,
                        target: isSubRow ? 'clinicalCrib' : 'bed',
                        episodeId: data.clinicalEpisodeId,
                      }
                    : undefined
                }
              />
              {visibleTreatingPhysicianName && (
                <span className="group/physician inline-flex min-w-0 items-center gap-0.5">
                  <span
                    className="max-w-28 truncate text-[9px] font-medium text-slate-400"
                    title={`Médico tratante: ${visibleTreatingPhysicianName}`}
                  >
                    · {visibleTreatingPhysicianName}
                  </span>
                  {!physicianReadOnly && onMultipleUpdate && data.clinicalEpisodeId?.trim() && (
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-slate-700 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 group-hover/physician:opacity-100"
                      aria-label={`Quitar médico tratante ${visibleTreatingPhysicianName}`}
                      title={`Quitar médico tratante ${visibleTreatingPhysicianName}`}
                      onClick={() =>
                        onMultipleUpdate(
                          dismissTreatingPhysician(data, {
                            practitionerId: matchedPhysician?.rayenPractitionerId,
                            name: visibleTreatingPhysicianName,
                          })
                        )
                      }
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </td>
  );
};
