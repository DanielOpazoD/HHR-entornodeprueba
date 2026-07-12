/**
 * PatientIdentityCell - Celda única de identidad del paciente (rediseño censo 2026)
 *
 * Unifica las antiguas columnas Nombre / RUT / Edad en un solo <td>:
 * - Fila 1: nombre + edad inline inmediatamente después, como una sola línea
 *   visual "Daniel Opazo (35a)"; la edad abre datos demográficos. El nombre
 *   solo es editable (input real) para cuna clínica provisional y camas
 *   vacías (el selector de activación necesita input[name="patientName"]).
 * - Fila 2: RUT en letra pequeña gris, solo lectura, con check de validación
 *   y copia al portapapeles (comportamiento heredado de RutPassportInput).
 *
 * Los componentes NameInput / RutPassportInput / AgeInput se conservan en el
 * repositorio para reactivación futura de las columnas separadas.
 */

import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ArrowRight, Baby } from 'lucide-react';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import { isValidRut } from '@/utils/rutUtils';
import { formatAge } from '@/utils/ageDisplayUtils';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { resolveNameInputState } from './nameInputController';
import type { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';

interface PatientIdentityCellProps extends BaseCellProps {
  hasRutError: boolean;
  onNameChange: DebouncedTextHandler;
  onOpenDemographics: () => void;
}

export const PatientIdentityCell: React.FC<PatientIdentityCellProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  hasRutError,
  onNameChange,
  onOpenDemographics,
}) => {
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle');

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
  const showIdentityDetails = !isEmpty && (hasRutValue || !!data.age);

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
    <td className="py-1 px-1 border-r border-slate-200 align-middle">
      <div className="relative">
        {isSubRow && (
          <div className="absolute left-[-15px] top-2 text-slate-300">
            <ArrowRight size={14} />
          </div>
        )}
        <div className="flex items-center gap-1">
          {canEditInlineName || isEmpty ? (
            <DebouncedInput
              type="text"
              name="patientName"
              className={clsx(
                'w-full min-w-0 flex-1 p-0.5 h-7 border rounded transition-all duration-200 text-[13px] font-semibold',
                canEditInlineName
                  ? 'bg-white text-slate-800 focus:ring-2 focus:ring-pink-200 focus:border-pink-400'
                  : 'bg-slate-50 text-slate-700 cursor-default',
                isSubRow ? 'border-pink-100 text-xs h-6' : 'border-slate-200',
                hasNameValidationError && 'border-red-400 bg-red-50/50 text-red-700'
              )}
              placeholder={isSubRow ? 'Nombre RN / Niño' : isEmpty ? '' : 'Nombre Paciente'}
              value={fullName}
              readOnly={!canEditInlineName}
              onChange={handlePatientNameChange}
              debounceMs={350}
            />
          ) : (
            <div
              className={clsx(
                'flex w-full min-w-0 flex-1 items-center gap-1 overflow-hidden p-0.5 h-7 border rounded transition-all duration-200 text-[13px] font-semibold bg-slate-50 text-slate-700 cursor-default',
                isSubRow ? 'border-pink-100 text-xs h-6' : 'border-slate-200',
                hasNameValidationError && 'border-red-400 bg-red-50/50 text-red-700'
              )}
            >
              {/*
                Read-only display of an official patient's name. Rendered as a borderless, content-width
                <input> (not a <span>) so the row keeps `input[name="patientName"]` — the stable hook the
                whole census test/e2e suite reads a patient's name through — while still looking like plain
                text. `size` sizes it to the name so the "(edad)" badge hugs right after it.
              */}
              <input
                type="text"
                name="patientName"
                readOnly
                tabIndex={-1}
                value={fullName}
                title={fullName || undefined}
                size={Math.max(fullName.length, 1)}
                placeholder={isSubRow ? 'Nombre RN / Niño' : 'Nombre Paciente'}
                className={clsx(
                  'min-w-0 max-w-full truncate border-0 bg-transparent p-0 cursor-default focus:outline-none',
                  !fullName && 'text-slate-400'
                )}
              />
              {ageBadge}
            </div>
          )}
          {canEditInlineName && ageBadge}
          {isSubRow && (
            <span className="shrink-0 text-pink-400 pointer-events-none">
              <Baby size={12} />
            </span>
          )}
        </div>
        {showIdentityDetails && (
          <div className="mt-0.5 flex items-center gap-1 pl-0.5 text-[10px] leading-tight text-slate-400">
            {hasRutValue ? (
              <>
                <span
                  className={clsx(
                    'truncate tabular-nums',
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
              <span className="italic text-slate-300">Sin documento</span>
            )}
          </div>
        )}
      </div>
    </td>
  );
};
