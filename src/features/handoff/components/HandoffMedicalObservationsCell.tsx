import React from 'react';
import { flushSync } from 'react-dom';
import type { PatientData } from '@/domain/handoff/patientContracts';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';
import { MedicalHandoffObservationEntry } from './MedicalHandoffObservationEntry';
import {
  pruneResolvedPendingMedicalEntryDrafts,
  type PendingMedicalEntryDraft,
  resolveMedicalObservationCellState,
  resolveNextPendingMedicalEntryDrafts,
  shouldAttemptPendingMedicalDraftPrune,
} from '@/features/handoff/controllers/handoffRowCellsController';
import { getMedicalHandoffSpecialtyOptions } from '@/domain/handoff/patientEntries';
import { resolveMedicalObservationEntries } from '@/domain/handoff/patientView';

interface HandoffMedicalObservationsCellProps {
  patient: PatientData;
  reportDate: string;
  isFieldReadOnly: boolean;
  primaryNoteValue: string;
  onPrimaryNoteChange: (value: string) => void;
  onCreatePrimaryEntry?: () => void;
  onEntryNoteChange: (entryId: string, value: string) => void;
  onEntrySpecialtyChange?: (entryId: string, specialty: string) => void;
  onAddEntry?: () => void;
  onDeleteEntry?: (entryId: string) => void;
  onRefreshAsCurrent?: (entryId: string) => void;
}

const specialtyOptions = getMedicalHandoffSpecialtyOptions();
const MEDICAL_DRAFT_CONTINUITY_MS = 2500;

export const HandoffMedicalObservationsCell: React.FC<HandoffMedicalObservationsCellProps> = ({
  patient,
  reportDate,
  isFieldReadOnly,
  primaryNoteValue,
  onPrimaryNoteChange,
  onCreatePrimaryEntry,
  onEntryNoteChange,
  onEntrySpecialtyChange,
  onAddEntry,
  onDeleteEntry,
  onRefreshAsCurrent,
}) => {
  const entries = resolveMedicalObservationEntries({
    patient,
    isFieldReadOnly,
    hasCreatePrimaryEntryAction: Boolean(onCreatePrimaryEntry),
  });
  const [pendingEntryDrafts, setPendingEntryDrafts] = React.useState<
    Record<string, PendingMedicalEntryDraft>
  >({});

  // Track outstanding prune timers so they are cleared on unmount (they call
  // setState, which would otherwise fire on a gone component).
  const pruneTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  React.useEffect(
    () => () => {
      pruneTimersRef.current.forEach(timerId => clearTimeout(timerId));
      pruneTimersRef.current.clear();
    },
    []
  );

  const prunePendingEntryDraft = React.useCallback((entryId: string, expiresAt: number) => {
    const previousTimer = pruneTimersRef.current.get(entryId);
    if (previousTimer !== undefined) clearTimeout(previousTimer);
    const timerId = setTimeout(() => {
      pruneTimersRef.current.delete(entryId);
      setPendingEntryDrafts(current => {
        const pendingDraft = current[entryId];
        if (!pendingDraft || pendingDraft.expiresAt !== expiresAt) {
          return current;
        }

        const next = { ...current };
        delete next[entryId];
        return next;
      });
    }, MEDICAL_DRAFT_CONTINUITY_MS);
    pruneTimersRef.current.set(entryId, timerId);
  }, []);

  const registerPendingEntryDraft = React.useCallback(
    (entryId: string, value: string) => {
      const expiresAt = Date.now() + MEDICAL_DRAFT_CONTINUITY_MS;
      setPendingEntryDrafts(current =>
        resolveNextPendingMedicalEntryDrafts({
          currentDrafts: current,
          entryId,
          value,
          entries,
          patient,
          specialtyOptions,
          expiresAt,
        })
      );
      prunePendingEntryDraft(entryId, expiresAt);
    },
    [entries, patient, prunePendingEntryDraft]
  );

  React.useEffect(() => {
    if (!shouldAttemptPendingMedicalDraftPrune(pendingEntryDrafts)) {
      return;
    }

    const now = Date.now();
    setPendingEntryDrafts(current => {
      const next = pruneResolvedPendingMedicalEntryDrafts({
        entries,
        pendingEntryDrafts: current,
        now,
      });
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [entries, pendingEntryDrafts]);

  // Draft changes and their expiry timers already drive rendering; no periodic tick is needed.
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    setNow(Date.now());
    for (const [entryId, timerId] of pruneTimersRef.current) {
      if (!pendingEntryDrafts[entryId]) {
        clearTimeout(timerId);
        pruneTimersRef.current.delete(entryId);
      }
    }
  }, [pendingEntryDrafts]);

  const medicalObservationCellState = React.useMemo(
    () =>
      resolveMedicalObservationCellState({
        entries,
        isFieldReadOnly,
        pendingEntryDrafts,
        hasCreatePrimaryEntryAction: Boolean(onCreatePrimaryEntry),
        now,
      }),
    [entries, isFieldReadOnly, onCreatePrimaryEntry, pendingEntryDrafts, now]
  );
  const { displayEntries, emptyState, showPrimaryNoteFallback } = medicalObservationCellState;

  return (
    <td className="p-1.5 w-full min-w-[280px] align-top print:w-auto print:min-w-0 print:text-[8px] print:p-0.5">
      <div className="space-y-2">
        {displayEntries.length === 0 ? (
          emptyState === 'create-entry' && onCreatePrimaryEntry ? (
            <button
              type="button"
              onClick={onCreatePrimaryEntry}
              data-testid="medical-handoff-create-entry-button"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 print:hidden"
            >
              + Crear entrega
            </button>
          ) : emptyState === 'primary-note' && showPrimaryNoteFallback ? (
            <>
              <div className="print:hidden">
                <DebouncedTextarea
                  value={primaryNoteValue}
                  onChangeValue={onPrimaryNoteChange}
                  className="w-full p-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 focus:outline-none bg-white"
                  minRows={2}
                  debounceMs={1500}
                  placeholder="Registrar entrega médica..."
                />
              </div>
              <div className="hidden print:block w-full whitespace-pre-wrap break-words text-slate-800 print:text-[8px] print:leading-tight">
                {primaryNoteValue}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400 italic print:text-[8px]">
              Sin entrega registrada
            </div>
          )
        ) : (
          displayEntries.map((entry, index) => (
            <MedicalHandoffObservationEntry
              key={entry.id}
              entry={entry}
              patient={patient}
              reportDate={reportDate}
              index={index}
              entriesCount={displayEntries.length}
              isFieldReadOnly={isFieldReadOnly}
              specialtyOptions={specialtyOptions}
              canEditSpecialty={Boolean(onEntrySpecialtyChange)}
              onEntryNoteChange={(entryId, value) => {
                flushSync(() => {
                  registerPendingEntryDraft(entryId, value);
                });
                onEntryNoteChange(entryId, value);
              }}
              onEntrySpecialtyChange={onEntrySpecialtyChange}
              onAddEntry={onAddEntry}
              onDeleteEntry={onDeleteEntry}
              onRefreshAsCurrent={onRefreshAsCurrent}
            />
          ))
        )}
      </div>
    </td>
  );
};
