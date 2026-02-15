/**
 * DiagnosisInput - Diagnosis input with CIE-10 and free text modes
 */

import React from 'react';
import clsx from 'clsx';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { TerminologySuggestor } from '@/components/shared/TerminologySuggestor';
import { DeliveryRoutePopover } from './DeliveryRoutePopover';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import { getCIE10Description } from '@/services/terminology/terminologyService';
import { PatientData } from '@/types';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';

interface DiagnosisInputProps extends BaseCellProps {
  diagnosisMode: DiagnosisMode;
  onChange: DebouncedTextHandler;
  onMultipleUpdate?: (fields: Partial<PatientData>) => void;
  onDeliveryRouteChange?: (
    route: 'Vaginal' | 'Cesárea' | undefined,
    date: string | undefined
  ) => void;
}

export const DiagnosisInput: React.FC<DiagnosisInputProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  diagnosisMode,
  onChange,
  onMultipleUpdate,
  onDeliveryRouteChange,
}) => {
  const isGinecobstetricia = data.specialty === 'Ginecobstetricia';
  const hasPathologyError =
    !PatientInputSchema.pick({ pathology: true }).safeParse({ pathology: data.pathology })
      .success && !!data.pathology;

  if (isEmpty && !isSubRow) {
    return (
      <td className="py-0.5 px-1 border-r border-slate-200 min-w-[160px]">
        <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">
          -
        </div>
      </td>
    );
  }

  // CIE-10 Mode
  if (diagnosisMode === 'cie10') {
    return (
      <td className="py-0.5 px-1 border-r border-slate-200 min-w-[160px]">
        <div className="relative w-full flex flex-col gap-0.5">
          <TerminologySuggestor
            className={clsx(
              'w-full border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-[13px] h-7',
              'border-slate-200 focus:ring-medical-500/20 focus:border-medical-500',
              isSubRow && 'text-xs h-6'
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
          />
        </div>
      </td>
    );
  }

  // Free Text Mode
  return (
    <td className="py-0.5 px-1 border-r border-slate-200 min-w-[160px]">
      <div className="relative w-full">
        <DebouncedInput
          type="text"
          className={clsx(
            'w-full border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-[13px] h-7 px-2',
            hasPathologyError
              ? 'border-red-400 focus:ring-red-200 focus:border-red-500'
              : 'border-slate-200 focus:ring-medical-500/20 focus:border-medical-500',
            isSubRow && 'text-xs h-6',
            data.cie10Code && 'pr-16',
            isGinecobstetricia && 'pr-8' // Always leave space for birth icon in Gyn
          )}
          placeholder="Diagnóstico (texto libre)"
          value={data.pathology || ''}
          onChange={onChange('pathology')}
          disabled={readOnly}
        />

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {/* Delivery Route icon for Ginecobstetricia (Free Text mode ONLY) */}
          {isGinecobstetricia && onDeliveryRouteChange && (
            <DeliveryRoutePopover
              deliveryRoute={data.deliveryRoute}
              deliveryDate={data.deliveryDate}
              onSave={onDeliveryRouteChange}
              disabled={readOnly}
            />
          )}

          {/* CIE-10 badge */}
          {data.cie10Code && (
            <span
              className="text-[9px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200"
              title={`Código CIE-10: ${data.cie10Code}`}
            >
              {data.cie10Code}
            </span>
          )}
        </div>
      </div>
    </td>
  );
};
