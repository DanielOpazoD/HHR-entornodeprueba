import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, ChevronRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useDailyRecordBedActions } from '@/context/useDailyRecordScopedActions';
import { useDailyRecordBeds } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import type { UpcChecklistAuditActor, UpcRoundEvaluation } from '@/domain/upc/upcContracts';
import { resolveUpcEpisodeIdentity } from '@/domain/upc/upcRoundSubject';
import { UpcBedCriteriaDraftPanel } from './UpcBedCriteriaDraftPanel';
import { UpcClassificationRowItem } from './UpcClassificationRowItem';
import {
  buildUpcClassificationRows,
  buildUpcRoundEvaluation,
  createUpcRowDraft,
  hasUpcDraftChanges,
  upcDraftStillMatches,
  type UpcClassificationRow,
  type UpcRowDraft,
} from './upcClassificationWindowModel';

interface UpcClassificationWindowProps {
  currentDateString: string;
  readOnly?: boolean;
  initialBedId?: string | null;
  onClose: () => void;
}

export const UpcClassificationWindow: React.FC<UpcClassificationWindowProps> = props => {
  const { currentUser } = useAuth();
  const epoch = useSessionEpoch();
  const actor = currentUser?.uid
    ? {
        uid: currentUser.uid,
        displayName:
          currentUser.displayName?.trim() || currentUser.email?.trim() || currentUser.uid,
      }
    : null;
  return (
    <UpcRound key={`${props.currentDateString}:${actor?.uid}:${epoch}`} {...props} actor={actor} />
  );
};

const UpcRound: React.FC<
  UpcClassificationWindowProps & { actor: UpcChecklistAuditActor | null }
> = ({ currentDateString, readOnly = false, initialBedId = null, onClose, actor }) => {
  const beds = useDailyRecordBeds();
  const { confirmUpcRound } = useDailyRecordBedActions();
  const [selection, setSelection] = useState({ key: initialBedId, visit: 0 });
  const selectRow = (key: string) => setSelection(current => ({ key, visit: current.visit + 1 }));
  const [drafts, setDrafts] = useState<Record<string, UpcRowDraft>>({});
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<Record<string, UpcRoundEvaluation>>({});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const rows = useMemo(
    () => buildUpcClassificationRows(beds, currentDateString),
    [beds, currentDateString]
  );
  const [hasVerifiedInitialBed, setHasVerifiedInitialBed] = useState(!initialBedId);
  const initialRowPresent = !initialBedId || rows.some(row => row.key === initialBedId);
  if (!hasVerifiedInitialBed && initialRowPresent) {
    setHasVerifiedInitialBed(true);
  }
  const missingRequestedInitialRow = !hasVerifiedInitialBed && !initialRowPresent;
  useLayoutEffect(() => {
    if (missingRequestedInitialRow) {
      onClose();
    }
  }, [missingRequestedInitialRow, onClose]);
  const selectedRow = missingRequestedInitialRow
    ? undefined
    : (rows.find(row => row.key === selection.key) ??
      rows.find(row => row.pendingReason) ??
      rows[0]);
  if (!missingRequestedInitialRow && selectedRow && selection.key !== selectedRow.key)
    setSelection({ ...selection, key: selectedRow.key });
  const currentDraft = (row: UpcClassificationRow) => {
    const draft = drafts[row.key];
    return draft?.row.episodeIdentity === row.episodeIdentity ? draft : undefined;
  };
  const selectedIndex = selectedRow ? rows.indexOf(selectedRow) : -1;
  const nextPending = [...rows.slice(selectedIndex + 1), ...rows.slice(0, selectedIndex)].find(
    row => row.pendingReason && !currentDraft(row)
  );
  const confirmedCount = rows.filter(row => !row.pendingReason && !currentDraft(row)).length;
  const subjectOf = (row: UpcClassificationRow) =>
    row.isCrib ? beds?.[row.bedId]?.clinicalCrib : beds?.[row.bedId];
  const selectedPatient = selectedRow && subjectOf(selectedRow);
  const selectedCount = Object.keys(drafts).length;
  const canEdit = Boolean(actor && !readOnly);

  const draftFor = (row: UpcClassificationRow) => {
    return currentDraft(row) ?? createUpcRowDraft(row, subjectOf(row)?.upcChecklist);
  };

  const editDraft = (row: UpcClassificationRow, change: (draft: UpcRowDraft) => UpcRowDraft) => {
    if (!canEdit || inFlight.current) return;
    const draft = change(draftFor(row));
    setDrafts(current => {
      const next = { ...current };
      if (hasUpcDraftChanges(draft)) next[row.key] = draft;
      else delete next[row.key];
      return next;
    });
    delete pending.current[row.key];
    setMessage('');
    setRetry(false);
  };
  const toggleCriterion = (row: UpcClassificationRow, level: 'uci' | 'uti', id: string) =>
    editDraft(row, draft => {
      const criteria = draft.noCriteria ? { uci: [], uti: [] } : draft;
      const previous: string[] = criteria[level];
      return {
        ...draft,
        ...criteria,
        noCriteria: false,
        [level]: previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id],
      };
    });

  const requestClose = () => {
    if (inFlight.current) return;
    if (selectedCount)
      setMessage(
        'Tienes marcaciones sin confirmar. Pulsa «Confirmar cambios» o «Cancelar» para cerrar.'
      );
    else onClose();
  };

  const confirmChanges = async () => {
    if (!actor || !canEdit || !selectedCount || inFlight.current) return;
    const changes = Object.values(drafts);
    const stale = changes.filter(
      draft => !upcDraftStillMatches(draft, subjectOf(draft.row), pending.current[draft.row.key])
    );
    const firstStale = stale[0];
    if (firstStale) {
      const next = { ...drafts };
      for (const draft of stale) {
        const { row } = draft;
        const subject = subjectOf(row);
        delete pending.current[row.key];
        if (resolveUpcEpisodeIdentity(subject) !== row.episodeIdentity) delete next[row.key];
        else next[row.key] = { ...draft, previousChecklist: subject?.upcChecklist };
      }
      setDrafts(next);
      selectRow(firstStale.row.key);
      setMessage(
        `Cambió el paciente o la evaluación en ${stale.map(draft => draft.row.bedName).join(', ')}. Revisa la ronda antes de confirmar.`
      );
      return;
    }
    const evaluatedAt = new Date().toISOString();
    const evaluations = changes.map(
      draft =>
        (pending.current[draft.row.key] ??= buildUpcRoundEvaluation(
          draft,
          actor,
          currentDateString,
          evaluatedAt
        ))
    );
    inFlight.current = true;
    setIsSaving(true);
    setMessage('');
    setRetry(false);
    try {
      // The shared census writer presents the single server outcome for this round.
      const confirmed = await confirmUpcRound(evaluations);
      if (!mounted.current) return;
      if (confirmed) onClose();
      else setRetry(true);
    } catch {
      if (mounted.current) setRetry(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };

  const selectedDraft = selectedRow && draftFor(selectedRow);
  if (missingRequestedInitialRow) {
    return null;
  }

  return (
    <BaseModal
      isOpen
      onClose={requestClose}
      title={`Clasificación UPC · ${confirmedCount} de ${rows.length} ${rows.length === 1 ? 'confirmada' : 'confirmadas'}`}
      icon={<ShieldCheck aria-hidden="true" />}
      headerIconColor="text-medical-700"
      size="5xl"
      closeOnBackdrop
      bodyClassName="p-0"
    >
      {message && (
        <p
          role="alert"
          className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800"
        >
          {message}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[340px_1fr]">
        <ul className="min-h-0 overflow-y-auto border-b border-slate-200 md:border-b-0 md:border-r">
          {rows.map(row => (
            <UpcClassificationRowItem
              key={row.key}
              row={row}
              isSelected={row.key === selectedRow?.key}
              draft={currentDraft(row)}
              canEdit={canEdit}
              saving={isSaving}
              onToggleMark={() =>
                editDraft(row, draft => ({ ...draft, noCriteria: !draft.noCriteria }))
              }
              onSelect={selectRow}
            />
          ))}
          {rows.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-slate-500">
              No hay pacientes en camas clasificables (R1–R4, Neo 1-2).
            </li>
          )}
        </ul>

        <div className="flex min-h-0 flex-col items-stretch overflow-y-auto p-3">
          {selectedRow && selectedPatient && selectedDraft ? (
            <UpcBedCriteriaDraftPanel
              key={`${selectedRow.key}:${selectedRow.episodeIdentity}:${selection.visit}`}
              row={selectedRow}
              criteria={selectedDraft.noCriteria ? { uci: [], uti: [] } : selectedDraft}
              readOnly={!canEdit}
              saving={isSaving}
              onToggleUci={id => toggleCriterion(selectedRow, 'uci', id)}
              onToggleUti={id => toggleCriterion(selectedRow, 'uti', id)}
              patient={selectedPatient}
              date={currentDateString}
            />
          ) : (
            <p className="px-2 py-6 text-center text-xs text-slate-500">
              Selecciona una cama para ver su evaluación.
            </p>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={() => nextPending && selectRow(nextPending.key)}
          disabled={!nextPending || isSaving}
          className="mr-auto inline-flex min-h-8 items-center gap-1 rounded px-2 text-xs font-semibold text-teal-800 hover:bg-teal-50 focus-visible:outline-teal-600 disabled:text-slate-400"
        >
          Siguiente pendiente <ChevronRight size={14} aria-hidden="true" />
        </button>
        <span className="sr-only" role="status">
          {selectedRow && `Cama seleccionada: ${selectedRow.bedName}, ${selectedRow.patientName}`}
        </span>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void confirmChanges()}
          disabled={isSaving || selectedCount === 0 || !canEdit}
          className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-teal-50 disabled:text-teal-800 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-emerald-200"
        >
          {isSaving ? (
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck size={13} aria-hidden="true" />
          )}
          {isSaving
            ? 'Confirmando…'
            : selectedCount > 0
              ? `${retry ? 'Reintentar confirmación' : 'Confirmar cambios'} (${selectedCount})`
              : 'Confirmar cambios'}
        </button>
      </footer>
    </BaseModal>
  );
};
