import { useMemo, useEffect, useCallback, useState } from 'react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useDailyRecordCudyrActions } from '@/context/useDailyRecordScopedActions';
import type { CudyrBatchUpdate, CudyrScore, CudyrScorePatch } from '@/types/domain/cudyr';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { useAuditContext } from '@/context/AuditContext';
import { useAuth } from '@/context/AuthContext';
import { buildDailyCudyrSummary, resolveVisibleCudyrBeds } from '@/services/cudyr/cudyrSummary';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { resolveCudyrEligibility } from '@/features/cudyr/controllers/cudyrEligibilityController';
import { canEditCudyrRecord } from '@/features/cudyr/controllers/cudyrEditAccessController';
import { useNotification } from '@/context/UIContext';
import { resolveCudyrRecordCompletion } from '@/domain/cudyr/cudyrCompletion';

type CudyrDraft = {
  beds: NonNullable<CudyrBatchUpdate['beds']>;
  clinicalCribs: NonNullable<CudyrBatchUpdate['clinicalCribs']>;
};

const createEmptyCudyrDraft = (): CudyrDraft => ({
  beds: {},
  clinicalCribs: {},
});

const countDraftFields = (draft: CudyrDraft): number =>
  [...Object.values(draft.beds), ...Object.values(draft.clinicalCribs)].reduce(
    (total, fields) => total + Object.keys(fields).length,
    0
  );

const isEmptyPatch = (fields: CudyrScorePatch | undefined): boolean =>
  !fields || Object.keys(fields).length === 0;

const updateDraftField = (
  draft: CudyrDraft,
  group: keyof CudyrDraft,
  bedId: string,
  field: keyof CudyrScore,
  value: number,
  persistedValue: number | undefined
): CudyrDraft => {
  const nextGroup = { ...draft[group] };
  const nextFields: CudyrScorePatch = { ...(nextGroup[bedId] ?? {}) };

  if (persistedValue !== undefined && value === persistedValue) {
    delete nextFields[field];
  } else {
    nextFields[field] = value;
  }

  if (isEmptyPatch(nextFields)) {
    delete nextGroup[bedId];
  } else {
    nextGroup[bedId] = nextFields;
  }

  return {
    ...draft,
    [group]: nextGroup,
  };
};

const applyCudyrDraftToRecord = (
  record: DailyRecord | null,
  draft: CudyrDraft
): DailyRecord | null => {
  if (!record || countDraftFields(draft) === 0) {
    return record;
  }

  const beds = { ...record.beds };

  Object.entries(draft.beds).forEach(([bedId, fields]) => {
    const patient = beds[bedId];
    if (!patient) return;
    beds[bedId] = {
      ...patient,
      cudyr: {
        ...(patient.cudyr ?? {}),
        ...fields,
      } as CudyrScore,
    };
  });

  Object.entries(draft.clinicalCribs).forEach(([bedId, fields]) => {
    const patient = beds[bedId];
    if (!patient?.clinicalCrib) return;
    beds[bedId] = {
      ...patient,
      clinicalCrib: {
        ...patient.clinicalCrib,
        cudyr: {
          ...(patient.clinicalCrib.cudyr ?? {}),
          ...fields,
        } as CudyrScore,
      },
    };
  });

  return {
    ...record,
    beds,
  };
};

const buildCudyrBatchAuditDetails = (
  record: DailyRecord,
  draft: CudyrDraft
): Record<string, unknown> => {
  const bedIds = Object.keys(draft.beds);
  const clinicalCribBedIds = Object.keys(draft.clinicalCribs);
  const patientSummaries = [
    ...bedIds.map(bedId => ({
      bedId,
      patientName: record.beds[bedId]?.patientName,
      rut: record.beds[bedId]?.rut,
      fields: Object.keys(draft.beds[bedId] ?? {}),
    })),
    ...clinicalCribBedIds.map(bedId => ({
      bedId: `${bedId}-crib`,
      patientName: record.beds[bedId]?.clinicalCrib?.patientName,
      rut: record.beds[bedId]?.clinicalCrib?.rut,
      fields: Object.keys(draft.clinicalCribs[bedId] ?? {}),
    })),
  ].filter(summary => summary.fields.length > 0);

  return {
    event: 'cudyr_batch_saved',
    fieldCount: countDraftFields(draft),
    bedIds,
    clinicalCribBedIds,
    patientCount: patientSummaries.length,
    patients: patientSummaries,
  };
};

export const useCudyrLogic = (readOnly: boolean) => {
  const { record } = useDailyRecordData();
  const { updateCudyrBatch } = useDailyRecordCudyrActions();
  const { logEvent, logViewEvent, userId } = useAuditContext();
  const { role, user } = useAuth();
  const { success, error: notifyError } = useNotification();
  const [draft, setDraft] = useState<CudyrDraft>(createEmptyCudyrDraft);
  const [isSavingCudyrChanges, setIsSavingCudyrChanges] = useState(false);

  useEffect(() => {
    setDraft(createEmptyCudyrDraft());
  }, [record?.date]);

  const draftRecord = useMemo(() => applyCudyrDraftToRecord(record, draft), [record, draft]);
  const pendingCudyrChangeCount = useMemo(() => countDraftFields(draft), [draft]);
  const persistedCompletion = useMemo(
    () => (record ? resolveCudyrRecordCompletion(record) : null),
    [record]
  );

  const handleScoreChange = useCallback(
    (bedId: string, field: keyof CudyrScore, value: number) => {
      if (record?.cudyrLocked || persistedCompletion?.isComplete) return;
      const persistedValue = record?.beds[bedId]?.cudyr?.[field];
      setDraft(current => updateDraftField(current, 'beds', bedId, field, value, persistedValue));
    },
    [persistedCompletion?.isComplete, record?.beds, record?.cudyrLocked]
  );

  const handleCribScoreChange = useCallback(
    (bedId: string, field: keyof CudyrScore, value: number) => {
      if (record?.cudyrLocked || persistedCompletion?.isComplete) return;
      const persistedValue = record?.beds[bedId]?.clinicalCrib?.cudyr?.[field];
      setDraft(current =>
        updateDraftField(current, 'clinicalCribs', bedId, field, value, persistedValue)
      );
    },
    [persistedCompletion?.isComplete, record?.beds, record?.cudyrLocked]
  );

  const saveCudyrChanges = useCallback(async () => {
    if (pendingCudyrChangeCount === 0 || isSavingCudyrChanges) {
      return;
    }

    if (record?.cudyrLocked || persistedCompletion?.isComplete) {
      notifyError(
        'CUDYR cerrado',
        'Otro profesional ya completó este CUDYR. Los resultados quedaron en modo lectura.'
      );
      setDraft(createEmptyCudyrDraft());
      return;
    }

    setIsSavingCudyrChanges(true);
    try {
      const savedAt = new Date().toISOString();
      const savedBy =
        getAttributedAuthors(userId, record, 'night') ||
        user?.displayName?.trim() ||
        user?.email?.trim() ||
        userId;
      const nextRecord = applyCudyrDraftToRecord(record, draft);
      const willComplete = Boolean(
        !record?.cudyrLocked && nextRecord && resolveCudyrRecordCompletion(nextRecord).isComplete
      );
      const didConfirmPersistence = updateCudyrBatch
        ? await updateCudyrBatch({
            ...draft,
            metadata: {
              savedAt,
              savedBy,
              savedById: user?.uid || userId,
              // Ownership is bound to the record selected for night shift D. A later
              // offline synchronization on D + 1 must never reassign it to that census.
              shiftDate: record?.date || '',
            },
          })
        : false;

      if (!didConfirmPersistence || !record) {
        notifyError(
          'CUDYR pendiente',
          'No se pudo confirmar el guardado. Tus cambios siguen pendientes para reintentar.'
        );
        return;
      }

      const savedFieldCount = countDraftFields(draft);
      const authors = getAttributedAuthors(userId, record);
      logEvent(
        'CUDYR_BATCH_SAVED',
        'dailyRecord',
        record.date,
        {
          ...buildCudyrBatchAuditDetails(record, draft),
          shiftDate: record.date,
          completed: willComplete,
          savedAt,
          savedBy,
        },
        undefined,
        record.date,
        authors
      );
      success(
        willComplete ? 'CUDYR completado' : 'CUDYR guardado',
        willComplete
          ? `CUDYR del turno noche ${record.date} guardado y cerrado para edición.`
          : `Se guardaron ${savedFieldCount} ${savedFieldCount === 1 ? 'cambio CUDYR' : 'cambios CUDYR'}.`
      );
      setDraft(createEmptyCudyrDraft());
    } finally {
      setIsSavingCudyrChanges(false);
    }
  }, [
    draft,
    isSavingCudyrChanges,
    pendingCudyrChangeCount,
    persistedCompletion?.isComplete,
    record,
    updateCudyrBatch,
    logEvent,
    notifyError,
    success,
    user,
    userId,
  ]);

  const discardCudyrChanges = useCallback(() => {
    setDraft(createEmptyCudyrDraft());
  }, []);

  const resolvePatientCudyrEligibility = useCallback(
    (patient?: { patientName?: string; admissionDate?: string; admissionTime?: string }) =>
      resolveCudyrEligibility({
        recordDate: draftRecord?.date || '',
        patientName: patient?.patientName,
        admissionDate: patient?.admissionDate,
        admissionTime: patient?.admissionTime,
      }),
    [draftRecord?.date]
  );

  // Logging
  useEffect(() => {
    if (record && record.date) {
      const authors = getAttributedAuthors(userId, record);
      logViewEvent(
        'VIEW_CUDYR',
        'dailyRecord',
        record.date,
        { view: 'cudyr' },
        undefined,
        record.date,
        authors
      );
    }
  }, [record, userId, logViewEvent]);

  useEffect(() => {
    if (pendingCudyrChangeCount === 0) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pendingCudyrChangeCount]);

  // Calculated Data
  const visibleBeds = useMemo(() => {
    if (!draftRecord) return [];
    return resolveVisibleCudyrBeds(draftRecord);
  }, [draftRecord]);

  const cudyrSummary = useMemo(() => {
    if (!draftRecord) return null;
    return buildDailyCudyrSummary(draftRecord);
  }, [draftRecord]);

  const stats = useMemo(
    () => ({
      occupiedCount: cudyrSummary?.occupiedCount ?? 0,
      categorizedCount: cudyrSummary?.categorizedCount ?? 0,
    }),
    [cudyrSummary]
  );

  const canEditRecord = useMemo(
    () =>
      canEditCudyrRecord({
        role,
        readOnly,
        recordDate: draftRecord?.date,
      }),
    [role, readOnly, draftRecord?.date]
  );

  const isCompletionLocked = Boolean(record?.cudyrLocked || persistedCompletion?.isComplete);
  const isEditingLocked = !canEditRecord || isCompletionLocked;

  useEffect(() => {
    if (isCompletionLocked && pendingCudyrChangeCount > 0) {
      setDraft(createEmptyCudyrDraft());
    }
  }, [isCompletionLocked, pendingCudyrChangeCount]);

  return {
    record: draftRecord,
    visibleBeds,
    stats,
    cudyrSummary,
    isEditingLocked,
    isCompletionLocked,
    persistedCompletion,
    pendingCudyrChangeCount,
    isSavingCudyrChanges,
    handleScoreChange,
    handleCribScoreChange,
    saveCudyrChanges,
    discardCudyrChanges,
    resolveCudyrEligibility: resolvePatientCudyrEligibility,
  };
};
