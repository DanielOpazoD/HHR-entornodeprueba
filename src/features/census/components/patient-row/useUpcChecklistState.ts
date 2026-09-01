/**
 * useUpcChecklistState — Draft state management for the UPC checklist.
 *
 * Isolated from positioning and portal concerns. Pure state logic:
 * toggle criteria, compute classification, save, clear, reset.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveUpcClassification } from '@/domain/upc/upcClassification';
import type { UpcClassification } from '@/domain/upc/upcClassification';
import type { UpcChecklistRecord, UpcChecklistAuditActor } from '@/domain/upc/upcContracts';
import {
  sanitizeCriterionIds,
  isValidUciCriterionId,
  isValidUtiCriterionId,
} from '@/domain/upc/upcCriteria';

interface UseUpcChecklistStateParams {
  checklist: UpcChecklistRecord | undefined;
  onSave: (record: UpcChecklistRecord) => void;
  uciAllowed: boolean;
  actor: UpcChecklistAuditActor | null;
}

/**
 * «Se guarda al seleccionar» generaba UNA escritura por checkbox: marcar dos
 * criterios seguidos lanzaba dos escrituras al callable clínico (~1-2 s cada
 * una) que se pisaban por versión — la segunda se perdía y «había que
 * seleccionarlo dos veces». La ráfaga se coalesce: la UI sigue optimista al
 * instante y una única escritura viaja con el estado FINAL; al desmontar el
 * popover se descarga lo pendiente sin esperar el timer.
 */
export const UPC_SAVE_COALESCE_MS = 400;

export interface UpcChecklistDraftState {
  persistedChecklist: UpcChecklistRecord | undefined;
  draftUci: ReadonlySet<string>;
  draftUti: ReadonlySet<string>;
  draftClassification: UpcClassification;
  hasDraftCriteria: boolean;
  toggleUciCriterion: (id: string) => void;
  toggleUtiCriterion: (id: string) => void;
  resetFromPersisted: () => void;
}

const toggleInSet = (prev: Set<string>, id: string): Set<string> => {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export const useUpcChecklistState = ({
  checklist,
  onSave,
  uciAllowed,
  actor,
}: UseUpcChecklistStateParams): UpcChecklistDraftState => {
  const [draftUci, setDraftUci] = useState<Set<string>>(new Set());
  const [draftUti, setDraftUti] = useState<Set<string>>(new Set());
  const [persistedChecklist, setPersistedChecklist] = useState<UpcChecklistRecord | undefined>(
    checklist
  );

  useEffect(() => {
    setPersistedChecklist(checklist);
  }, [checklist]);

  const resetFromPersisted = useCallback(() => {
    const safeUci = uciAllowed
      ? sanitizeCriterionIds(persistedChecklist?.uciCriteria, isValidUciCriterionId)
      : [];
    const safeUti = sanitizeCriterionIds(persistedChecklist?.utiCriteria, isValidUtiCriterionId);
    setDraftUci(new Set(safeUci));
    setDraftUti(new Set(safeUti));
  }, [persistedChecklist, uciAllowed]);

  const draftClassification = useMemo(
    () => resolveUpcClassification({ uciCriteria: draftUci, utiCriteria: draftUti }),
    [draftUci, draftUti]
  );

  const hasDraftCriteria = useMemo(
    () => draftUci.size > 0 || draftUti.size > 0,
    [draftUci, draftUti]
  );

  const buildRecord = useCallback(
    (
      uci: Set<string>,
      uti: Set<string>,
      classification: UpcClassification
    ): UpcChecklistRecord => ({
      uciCriteria: Array.from(uci),
      utiCriteria: Array.from(uti),
      classification,
      evaluatedAt: new Date().toISOString(),
      ...(actor ? { evaluatedBy: { uid: actor.uid, displayName: actor.displayName } } : {}),
    }),
    [actor]
  );

  const pendingSaveRef = useRef<UpcChecklistRecord | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    onSaveRef.current(pending);
  }, []);

  useEffect(() => flushPendingSave, [flushPendingSave]);

  const persistDraft = useCallback(
    (nextUci: Set<string>, nextUti: Set<string>) => {
      const nextClassification = resolveUpcClassification({
        uciCriteria: nextUci,
        utiCriteria: nextUti,
      });
      const nextRecord = buildRecord(nextUci, nextUti, nextClassification);
      setPersistedChecklist(nextRecord);
      pendingSaveRef.current = nextRecord;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushPendingSave, UPC_SAVE_COALESCE_MS);
    },
    [buildRecord, flushPendingSave]
  );

  const toggleUciCriterion = useCallback(
    (id: string) =>
      setDraftUci(prev => {
        const nextUci = toggleInSet(prev, id);
        setDraftUti(currentUti => {
          persistDraft(nextUci, currentUti);
          return currentUti;
        });
        return nextUci;
      }),
    [persistDraft]
  );

  const toggleUtiCriterion = useCallback(
    (id: string) =>
      setDraftUti(prev => {
        const nextUti = toggleInSet(prev, id);
        setDraftUci(currentUci => {
          persistDraft(currentUci, nextUti);
          return currentUci;
        });
        return nextUti;
      }),
    [persistDraft]
  );

  return {
    persistedChecklist,
    draftUci,
    draftUti,
    draftClassification,
    hasDraftCriteria,
    toggleUciCriterion,
    toggleUtiCriterion,
    resetFromPersisted,
  };
};
