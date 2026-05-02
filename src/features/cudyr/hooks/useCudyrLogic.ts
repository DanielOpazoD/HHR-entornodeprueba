import { useMemo, useEffect, useCallback } from 'react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useDailyRecordCudyrActions } from '@/context/useDailyRecordScopedActions';
import type { CudyrScore } from '@/types/domain/cudyr';
import { useAuditContext } from '@/context/AuditContext';
import { useAuth } from '@/context/AuthContext';
import { buildDailyCudyrSummary, resolveVisibleCudyrBeds } from '@/services/cudyr/cudyrSummary';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { resolveCudyrEligibility } from '@/features/cudyr/controllers/cudyrEligibilityController';
import { canEditCudyrRecord } from '@/features/cudyr/controllers/cudyrEditAccessController';

export const useCudyrLogic = (readOnly: boolean) => {
  const { record } = useDailyRecordData();
  const { updateCudyr, updateClinicalCribCudyr } = useDailyRecordCudyrActions();
  const { logViewEvent, userId } = useAuditContext();
  const { role } = useAuth();

  const handleScoreChange = useCallback(
    (bedId: string, field: keyof CudyrScore, value: number) => {
      updateCudyr(bedId, field, value);
    },
    [updateCudyr]
  );

  const handleCribScoreChange = useCallback(
    (bedId: string, field: keyof CudyrScore, value: number) => {
      updateClinicalCribCudyr(bedId, field, value);
    },
    [updateClinicalCribCudyr]
  );

  const resolvePatientCudyrEligibility = useCallback(
    (patient?: { patientName?: string; admissionDate?: string; admissionTime?: string }) =>
      resolveCudyrEligibility({
        recordDate: record?.date || '',
        patientName: patient?.patientName,
        admissionDate: patient?.admissionDate,
        admissionTime: patient?.admissionTime,
      }),
    [record?.date]
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

  // Calculated Data
  const visibleBeds = useMemo(() => {
    if (!record) return [];
    return resolveVisibleCudyrBeds(record);
  }, [record]);

  const cudyrSummary = useMemo(() => {
    if (!record) return null;
    return buildDailyCudyrSummary(record);
  }, [record]);

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
        recordDate: record?.date,
      }),
    [role, readOnly, record?.date]
  );

  const isEditingLocked = !canEditRecord;

  return {
    record,
    visibleBeds,
    stats,
    cudyrSummary,
    isEditingLocked,
    handleScoreChange,
    handleCribScoreChange,
    resolveCudyrEligibility: resolvePatientCudyrEligibility,
  };
};
