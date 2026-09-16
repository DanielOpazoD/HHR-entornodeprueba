import React, { useCallback, useMemo, useRef, useState } from 'react';
import { CheckCheck, LoaderCircle, ShieldCheck } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useDailyRecordBedActions } from '@/context/useDailyRecordScopedActions';
import { useDailyRecordBeds, useDailyRecordStaff } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';
import { assignedUpcNurses } from '@/shared/census/upcEvaluationPolicy';
import { UpcBedCriteriaDraftPanel } from './UpcBedCriteriaDraftPanel';
import {
  buildUpcClassificationRows,
  buildUpcDraftRecords,
  resolveUpcEpisodeIdentity,
  resolveUpcQuickEvaluationAvailability,
  sanitizeUpcCriteriaDraft,
  type PendingUpcDraftRecord,
  type UpcClassificationRow,
} from './upcClassificationWindowModel';
import { UpcClassificationRowItem } from './UpcClassificationRowItem';
import { UpcRoundNurseControl } from './UpcRoundNurseControl';
interface UpcClassificationWindowProps {
  currentDateString: string;
  readOnly?: boolean;
  /** Bed the operator clicked in the UPC column; the window opens focused on it. */
  initialBedId?: string | null;
  onClose: () => void;
}
export const UpcClassificationWindow: React.FC<UpcClassificationWindowProps> = ({
  currentDateString,
  readOnly = false,
  initialBedId = null,
  onClose,
}) => {
  const beds = useDailyRecordBeds();
  const staff = useDailyRecordStaff();
  const { updatePatientMultiple, updateClinicalCribMultiple } = useDailyRecordBedActions();
  const { currentUser } = useAuth();
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(initialBedId);
  const [noCriteriaSelection, setNoCriteriaSelection] = useState<Record<string, boolean>>({});
  const [criteriaDrafts, setCriteriaDrafts] = useState<
    Record<string, { uci: string[]; uti: string[]; episodeIdentity: string }>
  >({});
  const [nurseName, setNurseName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const pendingRecords = useRef<Record<string, PendingUpcDraftRecord> | null>(null);
  const episodeSnapshots = useRef<Record<string, string>>({});
  const bedsRef = useRef(beds);
  bedsRef.current = beds;

  const actor = useMemo(
    () =>
      currentUser
        ? { uid: currentUser.uid, displayName: currentUser.displayName || currentUser.email || '' }
        : null,
    [currentUser]
  );
  const assignedNurses = useMemo(
    () => assignedUpcNurses([...(staff?.nursesDayShift ?? []), ...(staff?.nursesNightShift ?? [])]),
    [staff?.nursesDayShift, staff?.nursesNightShift]
  );
  const rows = useMemo(
    () => buildUpcClassificationRows(beds, currentDateString),
    [beds, currentDateString]
  );
  const checklistOf = useCallback(
    (row: { bedId: string; isCrib: boolean }): UpcChecklistRecord | undefined =>
      (row.isCrib ? beds?.[row.bedId]?.clinicalCrib : beds?.[row.bedId])?.upcChecklist,
    [beds]
  );

  /** Criterios en borrador de una fila: lo ya marcado o lo que trae la evaluación vigente. */
  const criteriaOf = useCallback(
    (row: UpcClassificationRow): { uci: string[]; uti: string[] } =>
      criteriaDrafts[row.key] ??
      sanitizeUpcCriteriaDraft(row, {
        uci: checklistOf(row)?.uciCriteria,
        uti: checklistOf(row)?.utiCriteria,
      }),
    [checklistOf, criteriaDrafts]
  );

  const hasCriteriaChanges = useCallback(
    (row: { key: string; bedId: string; isCrib: boolean }): boolean => {
      const draft = criteriaDrafts[row.key];
      if (!draft) return false;
      const persisted = checklistOf(row);
      const same = (left: string[], right: string[] = []) =>
        [...left].sort().join('|') === [...right].sort().join('|');
      return !same(draft.uci, persisted?.uciCriteria) || !same(draft.uti, persisted?.utiCriteria);
    },
    [checklistOf, criteriaDrafts]
  );

  const dirtyRows = useMemo(
    () => rows.filter(row => Boolean(noCriteriaSelection[row.key]) || hasCriteriaChanges(row)),
    [hasCriteriaChanges, noCriteriaSelection, rows]
  );
  const selectedCount = dirtyRows.length;

  const quickAvailability = resolveUpcQuickEvaluationAvailability({
    hasPatient: true,
    readOnly,
    hasActor: Boolean(actor?.uid),
    nurseName,
    assignedNurses,
  });

  const closeWithoutChanges = useCallback(() => {
    setNoCriteriaSelection({});
    setCriteriaDrafts({});
    pendingRecords.current = null;
    episodeSnapshots.current = {};
    onClose();
  }, [onClose]);

  const invalidateRecords = useCallback(() => {
    pendingRecords.current = null;
  }, []);

  const requestClose = useCallback(() => {
    if (selectedCount > 0) {
      setMessage(
        'Tienes marcaciones sin confirmar: pulsa «Confirmar cambios» o «Cancelar» para cerrar.'
      );
      return;
    }
    closeWithoutChanges();
  }, [closeWithoutChanges, selectedCount]);

  const toggleDraftUci = useCallback(
    (row: UpcClassificationRow) => (id: string) => {
      episodeSnapshots.current[row.key] ??= row.episodeIdentity;
      invalidateRecords();
      setCriteriaDrafts(current => {
        const draft = current[row.key] ?? criteriaOf(row);
        const uci = draft.uci.includes(id)
          ? draft.uci.filter(item => item !== id)
          : [...draft.uci, id];
        return {
          ...current,
          [row.key]: { uci, uti: draft.uti, episodeIdentity: episodeSnapshots.current[row.key] },
        };
      });
    },
    [criteriaOf, invalidateRecords]
  );

  const toggleDraftUti = useCallback(
    (row: UpcClassificationRow) => (id: string) => {
      episodeSnapshots.current[row.key] ??= row.episodeIdentity;
      invalidateRecords();
      setCriteriaDrafts(current => {
        const draft = current[row.key] ?? criteriaOf(row);
        const uti = draft.uti.includes(id)
          ? draft.uti.filter(item => item !== id)
          : [...draft.uti, id];
        return {
          ...current,
          [row.key]: { uci: draft.uci, uti, episodeIdentity: episodeSnapshots.current[row.key] },
        };
      });
    },
    [criteriaOf, invalidateRecords]
  );

  const toggleNoCriteria = useCallback(
    (row: UpcClassificationRow, nextMarked: boolean) => {
      if (nextMarked) episodeSnapshots.current[row.key] ??= row.episodeIdentity;
      else if (!criteriaDrafts[row.key]) delete episodeSnapshots.current[row.key];
      invalidateRecords();
      setNoCriteriaSelection(current => ({ ...current, [row.key]: nextMarked }));
    },
    [criteriaDrafts, invalidateRecords]
  );

  const saveForBed = useCallback(
    async (
      row: UpcClassificationRow,
      pending: PendingUpcDraftRecord
    ): Promise<'saved' | 'failed' | 'episode-changed'> => {
      if (readOnly || !actor) return 'failed';
      const liveSubject = row.isCrib
        ? bedsRef.current?.[row.bedId]?.clinicalCrib
        : bedsRef.current?.[row.bedId];
      if (resolveUpcEpisodeIdentity(liveSubject, row.bedId) !== pending.episodeIdentity) {
        return 'episode-changed';
      }
      const { record } = pending;
      if (record.evaluatedForDate !== currentDateString || record.evaluatedBedId !== row.bedId) {
        return 'failed';
      }
      const patch = { upcChecklist: record, isUPC: record.classification !== null };
      try {
        return (await (row.isCrib
          ? updateClinicalCribMultiple(row.bedId, patch)
          : updatePatientMultiple(row.bedId, patch))) === true
          ? 'saved'
          : 'failed';
      } catch {
        return 'failed';
      }
    },
    [actor, currentDateString, readOnly, updateClinicalCribMultiple, updatePatientMultiple]
  );

  const confirmChanges = useCallback(async () => {
    if (!actor || selectedCount === 0) return;
    if (!quickAvailability.allowed) {
      setMessage(quickAvailability.reason ?? 'Falta el responsable de la ronda.');
      return;
    }

    // Los registros se arman una vez: reintentar la confirmación firma la misma evaluación.
    if (!pendingRecords.current) {
      pendingRecords.current = buildUpcDraftRecords({
        rows: dirtyRows,
        checklistOf,
        criteriaOf,
        noCriteriaSelection,
        actor,
        date: currentDateString,
        nurseName,
        nurseFromShift: assignedNurses.includes(nurseName.trim()),
        episodeIdentityOf: row => episodeSnapshots.current[row.key] ?? row.episodeIdentity,
      });
    }

    setMessage('');
    setIsSaving(true);
    const records = pendingRecords.current;
    const failed: string[] = [];
    const changedEpisode: string[] = [];
    try {
      for (const row of dirtyRows) {
        const pending = records[row.key];
        const result = pending ? await saveForBed(row, pending) : 'failed';
        if (result === 'failed') failed.push(row.key);
        if (result === 'episode-changed') changedEpisode.push(row.key);
      }
    } finally {
      setIsSaving(false);
    }

    if (failed.length > 0 || changedEpisode.length > 0) {
      setNoCriteriaSelection(current =>
        Object.fromEntries(Object.entries(current).filter(([key]) => failed.includes(key)))
      );
      setCriteriaDrafts(current =>
        Object.fromEntries(Object.entries(current).filter(([key]) => failed.includes(key)))
      );
      episodeSnapshots.current = Object.fromEntries(
        Object.entries(episodeSnapshots.current).filter(([key]) => failed.includes(key))
      );
      pendingRecords.current = Object.fromEntries(
        Object.entries(records).filter(([key]) => failed.includes(key))
      );
      setMessage(
        changedEpisode.length
          ? 'Cambió el paciente de una cama mientras la ventana estaba abierta. Se descartó esa marcación; revisa la lista antes de continuar.'
          : `No se pudo confirmar ${failed.length === 1 ? 'una cama' : `${failed.length} camas`}. Revisa la conexión y reintenta: no se perdió ninguna marcación.`
      );
      return;
    }

    closeWithoutChanges();
  }, [
    actor,
    assignedNurses,
    checklistOf,
    closeWithoutChanges,
    currentDateString,
    noCriteriaSelection,
    nurseName,
    quickAvailability.allowed,
    quickAvailability.reason,
    saveForBed,
    selectedCount,
    criteriaOf,
    dirtyRows,
  ]);

  const selectedRow = rows.find(row => row.key === selectedRowKey) ?? null;
  const selectedPatient = selectedRow
    ? selectedRow.isCrib
      ? beds?.[selectedRow.bedId]?.clinicalCrib
      : beds?.[selectedRow.bedId]
    : undefined;

  return (
    <BaseModal
      isOpen
      onClose={requestClose}
      title={`Clasificación UPC · ${rows.length} ${rows.length === 1 ? 'cama ocupada' : 'camas ocupadas'}`}
      icon={<ShieldCheck size={16} className="text-medical-700" aria-hidden="true" />}
      size="5xl"
      closeOnBackdrop
      headerActions={
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>
            {selectedCount > 0
              ? `${selectedCount} ${selectedCount === 1 ? 'cama' : 'camas'} por confirmar`
              : 'marca sin criterios o ajusta criterios y confirma al final'}
          </span>
          <UpcRoundNurseControl
            assignedNurses={assignedNurses}
            nurseName={nurseName}
            disabled={isSaving}
            onChange={name => {
              invalidateRecords();
              setNurseName(name);
            }}
          />
        </div>
      }
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
              isSelected={row.key === selectedRowKey}
              isMarked={Boolean(noCriteriaSelection[row.key])}
              readOnly={readOnly || isSaving}
              onToggleMark={(_rowKey, nextMarked) => toggleNoCriteria(row, nextMarked)}
              onSelect={setSelectedRowKey}
            />
          ))}
          {rows.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-slate-500">
              No hay pacientes en camas clasificables (R1–R4, Neo 1-2).
            </li>
          )}
        </ul>

        <div className="flex min-h-0 flex-col items-center overflow-y-auto p-3">
          {selectedRow && selectedPatient && actor ? (
            <UpcBedCriteriaDraftPanel
              row={selectedRow}
              criteria={criteriaOf(selectedRow)}
              readOnly={readOnly}
              saving={isSaving}
              onToggleUci={toggleDraftUci(selectedRow)}
              onToggleUti={toggleDraftUti(selectedRow)}
              onClose={() => setSelectedRowKey(null)}
              patient={selectedPatient}
              date={currentDateString}
            />
          ) : (
            <p className="px-2 py-6 text-center text-xs text-slate-500">
              Marca «Sin criterios UPC» en las camas que no requieren clasificación y confirma al
              final. Usa «Ver detalle» cuando el paciente sí tenga criterios.
            </p>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={closeWithoutChanges}
          disabled={isSaving}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void confirmChanges()}
          disabled={isSaving || selectedCount === 0 || !quickAvailability.allowed}
          title={quickAvailability.reason ?? 'Confirmar las camas marcadas sin criterios UPC'}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:text-emerald-800 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-emerald-200"
        >
          {isSaving ? (
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck size={13} aria-hidden="true" />
          )}
          {isSaving
            ? 'Confirmando…'
            : selectedCount > 0
              ? `Confirmar cambios (${selectedCount})`
              : 'Confirmar cambios'}
        </button>
      </footer>
    </BaseModal>
  );
};
