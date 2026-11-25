import type { CesareanLabor, DeliveryRoute, PatientData } from '@/types/domain/patient';

/**
 * DiagnosisInput - Free-text diagnosis input with Eloísa CIE-10 badge and clinical block editor
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

import { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { ClinicalInitialBlockEditor } from './ClinicalInitialBlockEditor';
import { DiagnosisCodeBadge } from './DiagnosisCodeBadge';

interface DiagnosisInputProps extends BaseCellProps {
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
  onChange,
  onMultipleUpdate,
  onDeliveryRouteChange,
}) => {
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
    Boolean(data.pathology) &&
    !PatientInputSchema.shape.pathology.safeParse(data.pathology).success;

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 min-w-[160px]" />;
  }

  return (
    <td
      className="census-diagnosis-cell py-0.5 px-1 border-r border-slate-200 min-w-[160px]"
      title={readOnlyReason}
    >
      <div className="relative w-full">
        <DebouncedInput
          type="text"
          className={clsx(
            'census-inline-field w-full border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-[13px] h-7 px-2',
            hasPathologyError
              ? 'border-red-400 focus:ring-red-200 focus:border-red-500'
              : 'border-slate-200 focus:ring-medical-500/20 focus:border-medical-500',
            isSubRow && 'text-xs h-6',
            freeTextRightPadding
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
      </div>
    </td>
  );
};
