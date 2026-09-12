/**
 * DiagnosisInput - Diagnosis input with CIE-10 and free text modes
 */

import React from 'react';
import clsx from 'clsx';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { DeliveryRoutePopover } from './DeliveryRoutePopover';
import {
  isGinecobstetriciaSpecialty,
  isObstetricGinecobstetricia,
} from '@/shared/census/ginecobstetriciaClassification';
import { PatientInputSchema } from '@/schemas/inputSchemas';
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

// The CIE-10 catalogue is large and only needed in CIE-10 mode, so the census table
// no longer pays for it on every startup.
const DiagnosisCie10Cell = React.lazy(() => import('./DiagnosisCie10Cell'));

const DiagnosisCie10CellFallback = ({ readOnlyReason }: { readOnlyReason?: string }) => (
  <td
    className="census-diagnosis-cell py-0.5 px-1 border-r border-slate-200 min-w-[160px]"
    title={readOnlyReason}
  >
    <div className="relative w-full h-7" />
  </td>
);

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
  const freeTextRightPadding =
    data.cie10Code && canShowDeliveryRoute
      ? canShowClinicalInitialBlockEditor
        ? 'pr-32'
        : 'pr-24'
      : canShowDeliveryRoute || canShowClinicalInitialBlockEditor || data.cie10Code
        ? 'pr-16'
        : undefined;
  const hasPathologyError =
    !PatientInputSchema.pick({ pathology: true }).safeParse({ pathology: data.pathology })
      .success && !!data.pathology;

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 min-w-[160px]" />;
  }

  // CIE-10 Mode
  if (diagnosisMode === 'cie10') {
    return (
      <React.Suspense fallback={<DiagnosisCie10CellFallback readOnlyReason={readOnlyReason} />}>
        <DiagnosisCie10Cell
          data={data}
          isSubRow={isSubRow}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          onChange={onChange}
          onMultipleUpdate={onMultipleUpdate}
          canShowClinicalInitialBlockEditor={canShowClinicalInitialBlockEditor}
          freshnessPause={freshnessPause}
        />
      </React.Suspense>
    );
  }

  // Free Text Mode
  return (
    <td
      className="census-diagnosis-cell py-0.5 px-1 border-r border-slate-200 min-w-[160px]"
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
            freeTextRightPadding,
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
