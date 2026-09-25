import React, { useMemo } from 'react';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import { resolveUpcReviewReason } from '@/shared/census/upcEvaluationPolicy';
import { resolveEffectiveUpcState, isUpcEligibleBedId } from '@/shared/census/upcBedPolicy';
import {
  resolveUpcClassificationLabel,
  resolveUpcBadgeColor,
} from '@/domain/upc/upcClassification';
import type { UpcChecklistRecord } from '@/features/census/contracts/censusUpcContracts';
import type { BaseCellProps } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { useClinicalFieldFreshnessPause } from './useClinicalFieldFreshnessPause';
import { useUpcClassificationWindowOpener } from './UpcClassificationWindowContext';

interface UpcChecklistCellProps extends BaseCellProps {
  currentDateString: string;
  checklist: UpcChecklistRecord | undefined;
}

/**
 * UPC cell of the census row. It shows the classification badge and opens the day-level UPC panel
 * (never an anchored popover) with this bed already focused.
 */
export const UpcChecklistCell: React.FC<UpcChecklistCellProps> = ({
  data,
  currentDateString,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  readOnlyReason,
  clinicalPause,
  checklist,
}) => {
  const freshnessPause = useClinicalFieldFreshnessPause(clinicalPause);
  const { openUpcWindow } = useUpcClassificationWindowOpener();
  const eligible = isUpcEligibleBedId(data.bedId);
  const reviewReason = resolveUpcReviewReason(checklist, data.bedId, currentDateString);

  const { label, colors } = useMemo(() => {
    const classification = resolveEffectiveUpcState({
      bedId: data.bedId,
      isUPC: data.isUPC,
      checklist,
    }).classification;
    return {
      label: resolveUpcClassificationLabel(classification),
      colors: resolveUpcBadgeColor(classification),
    };
  }, [checklist, data.bedId, data.isUPC]);

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="p-0.5 text-center w-[26px]" />;
  }

  if (!eligible) {
    return (
      <td className="p-0.5 text-center w-[26px]" title="UPC disponible solo en R1-R4, Neo 1-2">
        <span className="text-slate-300 text-[9px]">—</span>
      </td>
    );
  }

  return (
    <td className="p-0.5 text-center w-[26px] relative">
      <button
        type="button"
        onClick={event => {
          if (freshnessPause.acknowledge(event)) return;
          openUpcWindow(data.bedId, { crib: isSubRow });
        }}
        aria-label={
          readOnly ? 'Consultar clasificación UPC del día' : reviewReason || 'Editar evaluación UPC'
        }
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex min-h-8 min-w-8 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[10px] font-semibold leading-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-700',
          !reviewReason && 'min-w-[56px]',
          readOnly && 'cursor-default',
          freshnessPause.pauseClassName,
          reviewReason
            ? 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            : label
              ? clsx(colors.text, colors.bg, !readOnly && 'hover:opacity-80')
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
        )}
        title={
          readOnlyReason ||
          reviewReason ||
          (label
            ? `UPC-${label} — Click para editar criterios`
            : 'Sin criterios UPC — Click para revisar la clasificación del día')
        }
      >
        {label && <span>{label}</span>}
        {reviewReason ? (
          <AlertCircle size={15} aria-hidden="true" />
        ) : !label ? (
          <span>Sin criterios</span>
        ) : null}
      </button>
      {freshnessPause.hint}
    </td>
  );
};
