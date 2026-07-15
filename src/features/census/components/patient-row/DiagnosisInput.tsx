/**
 * DiagnosisInput - Diagnosis input with CIE-10 and free text modes
 */

import React from 'react';
import clsx from 'clsx';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { TerminologySuggestor } from '@/components/shared/TerminologySuggestor';
import { DeliveryRoutePopover } from './DeliveryRoutePopover';
import {
  isGinecobstetriciaSpecialty,
  isObstetricGinecobstetricia,
} from '@/shared/census/ginecobstetriciaClassification';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import { getCIE10Description } from '@/services/terminology/terminologyService';
import type {
  CesareanLabor,
  DeliveryRoute,
} from '@/features/census/contracts/censusObstetricContracts';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { useClinicalFieldFreshnessPause } from './useClinicalFieldFreshnessPause';
import { ClinicalInitialBlockEditor } from './ClinicalInitialBlockEditor';
import { DiagnosisCodeBadge } from './DiagnosisCodeBadge';

interface DiagnosisInputProps extends BaseCellProps {
  diagnosisMode: DiagnosisMode;
  onChange: DebouncedTextHandler;
  onMultipleUpdate?: (fields: Partial<PatientData>) => void;
  onDeliveryRouteChange?: (
    route: DeliveryRoute | undefined,
    date: string | undefined,
    cesareanLabor: CesareanLabor | undefined
  ) => void;
}

export const DiagnosisInput: React.FC<DiagnosisInputProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  readOnlyReason,
  clinicalPause,
  diagnosisMode,
  onChange,
  onMultipleUpdate,
  onDeliveryRouteChange,
}) => {
  const freshnessPause = useClinicalFieldFreshnessPause(clinicalPause);
  const isGinecobstetricia = isGinecobstetriciaSpecialty(data.specialty);
  const canShowDeliveryRoute =
    isGinecobstetricia && isObstetricGinecobstetricia(data.ginecobstetriciaType);
  const canShowClinicalInitialBlockEditor =
    !readOnly && !isSubRow && !isEmpty && Boolean(data.patientName);
  const hasPathologyError =
    !PatientInputSchema.pick({ pathology: true }).safeParse({ pathology: data.pathology })
      .success && !!data.pathology;

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 min-w-[160px]" />;
  }

  // CIE-10 Mode
  if (diagnosisMode === 'cie10') {
    return (
      <td
        className="py-0.5 px-1 border-r border-slate-200 min-w-[160px]"
        title={readOnlyReason}
        onMouseDownCapture={freshnessPause.acknowledge}
        onFocusCapture={freshnessPause.acknowledge}
      >
        <div className="relative w-full flex flex-col gap-0.5">
          <TerminologySuggestor
            className={clsx(
              'w-full border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-[13px] h-7',
              'border-slate-200 focus:ring-medical-500/20 focus:border-medical-500',
              isSubRow && 'text-xs h-6',
              freshnessPause.pauseClassName
            )}
            placeholder="Buscar diagnóstico CIE-10..."
            value={
              data.cie10Description ||
              (data.cie10Code ? getCIE10Description(data.cie10Code) : '') ||
              ''
            }
            cie10Code={data.cie10Code}
            freeTextValue={data.pathology}
            onChange={(text, concept) => {
              if (concept) {
                if (onMultipleUpdate) {
                  onMultipleUpdate({
                    cie10Code: concept.code,
                    cie10Description: concept.display,
                  });
                } else {
                  onChange('cie10Code')(concept.code);
                  onChange('cie10Description')(concept.display);
                }
              } else {
                onChange('cie10Description')(text);
                if (text === '') {
                  onChange('cie10Code')('');
                }
              }
            }}
            disabled={readOnly}
            title={readOnlyReason}
          />

          {canShowClinicalInitialBlockEditor && (
            <ClinicalInitialBlockEditor
              data={data}
              alignRightClassName={data.cie10Code ? 'right-20' : 'right-1'}
              onChange={onChange}
              onMultipleUpdate={onMultipleUpdate}
            />
          )}

          {data.cie10Code && (
            <span className="absolute right-1 top-1 inline-flex items-center gap-1">
              <DiagnosisCodeBadge
                code={data.cie10Code}
                description={data.cie10Description || data.pathology}
              />
              {!readOnly && (
                <button
                  type="button"
                  aria-label="Eliminar código CIE-10"
                  title="Eliminar código CIE-10"
                  className="text-slate-500 hover:text-red-600 leading-none"
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (onMultipleUpdate) {
                      onMultipleUpdate({
                        cie10Code: '',
                        cie10Description: '',
                      });
                    } else {
                      onChange('cie10Code')('');
                      onChange('cie10Description')('');
                    }
                  }}
                >
                  x
                </button>
              )}
            </span>
          )}
          {freshnessPause.hint}
        </div>
      </td>
    );
  }

  // Free Text Mode
  return (
    <td
      className="py-0.5 px-1 border-r border-slate-200 min-w-[160px]"
      title={readOnlyReason}
      onMouseDownCapture={freshnessPause.acknowledge}
      onFocusCapture={freshnessPause.acknowledge}
    >
      <div className="relative w-full">
        <DebouncedInput
          type="text"
          className={clsx(
            'w-full border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-[13px] h-7 px-2',
            hasPathologyError
              ? 'border-red-400 focus:ring-red-200 focus:border-red-500'
              : 'border-slate-200 focus:ring-medical-500/20 focus:border-medical-500',
            isSubRow && 'text-xs h-6',
            (canShowDeliveryRoute || canShowClinicalInitialBlockEditor || data.cie10Code) &&
              'pr-16',
            freshnessPause.pauseClassName
          )}
          placeholder="Diagnóstico (texto libre)"
          value={data.pathology || ''}
          onChange={onChange('pathology')}
          disabled={readOnly}
          title={readOnlyReason}
        />

        {canShowClinicalInitialBlockEditor && (
          <ClinicalInitialBlockEditor
            data={data}
            alignRightClassName={
              data.cie10Code
                ? canShowDeliveryRoute
                  ? 'right-24'
                  : 'right-16'
                : canShowDeliveryRoute
                  ? 'right-7'
                  : 'right-1'
            }
            onChange={onChange}
            onMultipleUpdate={onMultipleUpdate}
          />
        )}

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <DiagnosisCodeBadge
            code={data.cie10Code}
            description={data.cie10Description || data.pathology}
          />
          {canShowDeliveryRoute && onDeliveryRouteChange && (
            <DeliveryRoutePopover
              deliveryRoute={data.deliveryRoute}
              deliveryDate={data.deliveryDate}
              deliveryCesareanLabor={data.deliveryCesareanLabor}
              onSave={onDeliveryRouteChange}
              disabled={readOnly}
            />
          )}
        </div>
        {freshnessPause.hint}
      </div>
    </td>
  );
};
