import { useCallback, useMemo, useRef, useState } from 'react';
import { resolveUpcClassification } from '@/domain/upc/upcClassification';
import type { UpcChecklistRecord, UpcChecklistAuditActor } from '@/domain/upc/upcContracts';
import {
  sanitizeCriterionIds,
  isValidUciCriterionId,
  isValidUtiCriterionId,
  normalizeUciCriterionId,
} from '@/domain/upc/upcCriteria';
import { assignedUpcNurses } from '@/shared/census/upcEvaluationPolicy';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';
import { appendUpcEvaluation, upcCriterionLabels } from '@/domain/upc/upcEvaluationHistory';

export interface UpcEvaluationContext {
  date: string;
  bedId: string;
  nursesDayShift: string[];
  nursesNightShift: string[];
}

export interface UseUpcChecklistStateParams {
  checklist: UpcChecklistRecord | undefined;
  onSave: (record: UpcChecklistRecord) => Promise<boolean>;
  uciAllowed: boolean;
  actor: UpcChecklistAuditActor | null;
  evaluationContext: UpcEvaluationContext;
}

const toggleInSet = (prev: Set<string>, id: string): Set<string> => {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** Drafts never write on toggle, close or unmount. One explicit, awaited evaluation. */
export const useUpcChecklistState = ({
  checklist,
  onSave,
  uciAllowed,
  actor,
  evaluationContext,
}: UseUpcChecklistStateParams) => {
  const [draftUci, setDraftUci] = useState(new Set<string>());
  const [draftUti, setDraftUti] = useState(new Set<string>());
  const [nurseName, setNurseName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const reviewedChecklist = useRef(checklist);
  const retryRecord = useRef<UpcChecklistRecord | null>(null);
  const nurses = assignedUpcNurses([
    ...evaluationContext.nursesDayShift,
    ...evaluationContext.nursesNightShift,
  ]);
  const validResponsible = Boolean(
    nurseName.trim() && (!nurses.length || nurses.includes(nurseName.trim()))
  );

  const resetFromPersisted = useCallback(() => {
    if (savingRef.current) return;
    reviewedChecklist.current = checklist;
    retryRecord.current = null;
    setDraftUci(
      new Set(
        uciAllowed
          ? sanitizeCriterionIds(checklist?.uciCriteria, isValidUciCriterionId).map(
              normalizeUciCriterionId
            )
          : []
      )
    );
    setDraftUti(new Set(sanitizeCriterionIds(checklist?.utiCriteria, isValidUtiCriterionId)));
    setNurseName('');
    setSaveError('');
    setSaved(false);
  }, [checklist, uciAllowed]);

  const draftClassification = useMemo(
    () =>
      resolveUpcClassification({
        uciCriteria: draftUci,
        utiCriteria: draftUti,
      }),
    [draftUci, draftUti]
  );

  const saveEvaluation = async (): Promise<void> => {
    if (savingRef.current || !validResponsible || !actor?.uid) return;
    if (!arePatchValuesDeepEqual(reviewedChecklist.current, checklist)) {
      setSaveError(
        'La evaluación cambió en otra sesión. Cierra y vuelve a abrir para revisar los datos vigentes.'
      );
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    setSaved(false);
    const evaluation: UpcChecklistRecord = {
      evaluationId: crypto.randomUUID(),
      uciCriteria: [...draftUci],
      utiCriteria: [...draftUti],
      classification: draftClassification,
      evaluatedAt: new Date().toISOString(),
      evaluatedBy: actor,
      evaluatedForDate: evaluationContext.date,
      evaluatedBedId: evaluationContext.bedId,
      reviewRequired: false,
      responsibleNurse: {
        name: nurseName.trim(),
        source: nurses.length ? 'assigned' : 'manual',
      },
    };
    const newRecord = appendUpcEvaluation(checklist, {
      ...evaluation,
      criterionLabels: upcCriterionLabels(evaluation),
    });
    // Retrying an unchanged draft is the same signing, not another historical evaluation.
    const retry = retryRecord.current;
    const record =
      retry?.evaluatedForDate === evaluationContext.date &&
      retry.evaluatedBedId === evaluationContext.bedId &&
      retry.evaluatedBy?.uid === actor.uid
        ? retry
        : newRecord;
    retryRecord.current = record;
    try {
      if ((await onSave(record)) !== true) throw new Error('Unconfirmed evaluation');
      reviewedChecklist.current = record;
      retryRecord.current = null;
      setSaved(true);
    } catch {
      setSaveError(
        'No se pudo confirmar el guardado. Conservamos tu borrador; comprueba la conexión y vuelve a intentar.'
      );
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return {
    persistedChecklist: checklist,
    draftUci,
    draftUti,
    draftClassification,
    hasDraftCriteria: draftUci.size > 0 || draftUti.size > 0,
    resetFromPersisted,
    toggleUciCriterion: (id: string) => {
      if (!savingRef.current && uciAllowed && isValidUciCriterionId(id)) {
        retryRecord.current = null;
        setDraftUci(prev => toggleInSet(prev, normalizeUciCriterionId(id)));
        setSaved(false);
      }
    },
    toggleUtiCriterion: (id: string) => {
      if (!savingRef.current && isValidUtiCriterionId(id)) {
        retryRecord.current = null;
        setDraftUti(prev => toggleInSet(prev, id));
        setSaved(false);
      }
    },
    selectedNurseName: nurseName,
    assignedNurseOptions: nurses,
    isSaving,
    saveError,
    saved,
    canSave: validResponsible && Boolean(actor?.uid) && !isSaving && !saved,
    saveDisabledReason: !actor?.uid
      ? 'Inicia sesión para registrar la evaluación.'
      : !validResponsible
        ? nurses.length
          ? 'Elige el responsable para habilitar Guardar.'
          : 'Escribe tu nombre para habilitar Guardar.'
        : null,
    setNurseName: (value: string) => {
      retryRecord.current = null;
      setNurseName(value);
      setSaved(false);
    },
    saveEvaluation,
  };
};
