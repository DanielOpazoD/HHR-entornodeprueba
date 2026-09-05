import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import { resolveUpcReviewReason } from '@/shared/census/upcEvaluationPolicy';
import type { UpcEvaluationContext } from './useUpcChecklistState';
import { UpcEvaluationForm } from './UpcEvaluationForm';
import { UpcEvaluationHistoryPanel } from './UpcEvaluationHistoryPanel';
import { useUpcChecklistController } from './useUpcChecklistController';
import type { UpcChecklistAuditActor } from './useUpcChecklistController';
import { UpcChecklistPanel } from './UpcChecklistPanel';
import {
  resolveUpcClassificationLabel,
  resolveUpcBadgeColor,
} from '@/domain/upc/upcClassification';
import { resolveEffectiveUpcState, isUciEligibleBedId } from '@/shared/census/upcBedPolicy';
import type { UpcChecklistRecord } from '@/features/census/contracts/censusUpcContracts';
import type { BaseCellProps } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { useClinicalFieldFreshnessPause } from './useClinicalFieldFreshnessPause';

interface UpcChecklistPopoverProps extends BaseCellProps {
  checklist: UpcChecklistRecord | undefined;
  onSave: (record: UpcChecklistRecord) => Promise<boolean>;
  evaluationContext: UpcEvaluationContext;
  eligible: boolean;
  actor: UpcChecklistAuditActor | null;
}

export const UpcChecklistPopover: React.FC<UpcChecklistPopoverProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  readOnlyReason,
  clinicalPause,
  checklist,
  onSave,
  eligible,
  actor,
  evaluationContext,
}) => {
  const freshnessPause = useClinicalFieldFreshnessPause(clinicalPause);
  const uciAllowed = isUciEligibleBedId(data.bedId);
  const historyPatient = useMemo(() => ({ ...data, upcChecklist: checklist }), [data, checklist]);

  const controller = useUpcChecklistController({
    checklist,
    onSave: record => (readOnly || !eligible ? Promise.resolve(false) : onSave(record)),
    disabled: false,
    uciAllowed,
    actor,
    evaluationContext,
  });
  const reviewReason = resolveUpcReviewReason(checklist, data.bedId, evaluationContext.date);
  const {
    buttonRef,
    popoverRef,
    isOpen,
    popoverPos,
    togglePopover,
    closePopover,
    persistedChecklist,
    draftUci,
    draftUti,
    draftClassification,
    hasDraftCriteria,
    uciAllowed: controllerUciAllowed,
    toggleUciCriterion,
    toggleUtiCriterion,
  } = controller;

  const { label, colors } = useMemo(() => {
    const cls = resolveEffectiveUpcState({
      bedId: data.bedId,
      isUPC: data.isUPC,
      checklist: persistedChecklist,
    }).classification;
    return {
      label: resolveUpcClassificationLabel(cls),
      colors: resolveUpcBadgeColor(cls),
    };
  }, [data.bedId, data.isUPC, persistedChecklist]);

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="p-0.5 text-center w-[26px]" />;
  }

  if (!eligible && !checklist) {
    return (
      <td className="p-0.5 text-center w-[26px]" title="UPC disponible solo en R1-R4, Neo 1-2">
        <span className="text-slate-300 text-[9px]">—</span>
      </td>
    );
  }

  return (
    <td className="p-0.5 text-center w-[26px] relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={event => {
          if (freshnessPause.acknowledge(event)) return;
          togglePopover(event);
        }}
        aria-label={
          readOnly || !eligible
            ? 'Consultar historial UPC'
            : reviewReason || 'Editar evaluación UPC'
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex min-h-8 min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[10px] font-semibold leading-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-700',
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
            : 'Sin criterios UPC — Click para consultar evaluación')
        }
      >
        {label && <span>{label}</span>}
        {reviewReason ? (
          <span className="inline-flex items-center gap-0.5 text-[9px]">
            <AlertCircle size={10} aria-hidden="true" />
            {readOnly || !eligible ? 'Pendiente' : 'Evaluar'}
          </span>
        ) : !label ? (
          <span>Sin criterios</span>
        ) : null}
      </button>
      {freshnessPause.hint}

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[10000]"
            style={{
              top: popoverPos.top,
              left: popoverPos.left,
              maxHeight: `calc(100dvh - ${popoverPos.top + 8}px)`,
            }}
            onClick={e => e.stopPropagation()}
          >
            <UpcChecklistPanel
              bedId={isSubRow ? `${data.bedId} · cuna clínica` : data.bedId}
              readOnly={readOnly || !eligible}
              draftUci={draftUci}
              draftUti={draftUti}
              draftClassification={draftClassification}
              hasDraftCriteria={hasDraftCriteria}
              uciAllowed={controllerUciAllowed}
              onToggleUci={toggleUciCriterion}
              onToggleUti={toggleUtiCriterion}
              onClose={closePopover}
              saving={controller.isSaving}
              historyContent={
                <UpcEvaluationHistoryPanel patient={historyPatient} date={evaluationContext.date} />
              }
              evaluationControls={
                <UpcEvaluationForm
                  state={controller}
                  checklist={checklist}
                  date={evaluationContext.date}
                  reason={reviewReason}
                />
              }
            />
          </div>,
          document.body
        )}
    </td>
  );
};
