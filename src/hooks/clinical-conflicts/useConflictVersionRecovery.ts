import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { canManageClinicalConflictCenter } from '@/shared/access/operationalAccessPolicy';
import type { ConflictVersionRestoreAuditDetails } from '@/services/repositories/ports/repositoryAuditPort';
import {
  defaultDailyRecordConflictRecoveryPort,
  type ConflictSnapshotRecoveryEvidence,
  type ConflictVersionSnapshot,
  type DailyRecordConflictRecoveryPort,
} from '@/application/ports/dailyRecordConflictRecoveryPort';

interface UseConflictVersionRecoveryOptions {
  date?: string;
  port?: DailyRecordConflictRecoveryPort;
}

export interface ConflictVersionRecoveryModel {
  canManageClinicalConflicts: boolean;
  isOpen: boolean;
  loading: boolean;
  restoringId: string | null;
  snapshots: ConflictVersionSnapshot[];
  snapshotRecovery: ConflictSnapshotRecoveryEvidence | null;
  open: () => void;
  close: () => void;
  restore: (
    snapshotId: string,
    options?: {
      title?: string;
      message?: string;
      confirmText?: string;
      successTitle?: string;
      successMessage?: string;
      reviewContext?: ConflictVersionRestoreAuditDetails['reviewContext'];
    }
  ) => Promise<void>;
}

const resolveSnapshotListUnavailableReason = (
  error: unknown
): ConflictSnapshotRecoveryEvidence['unavailableReason'] => {
  const code = String((error as { code?: unknown })?.code || '').toLowerCase();
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();
  if (code.includes('permission-denied') || code.includes('permission_denied')) {
    return 'permission_denied';
  }
  if (
    code.includes('failed-precondition') &&
    (message.includes('index') || message.includes('requires an index'))
  ) {
    return 'query_index_missing';
  }
  return 'unknown';
};

/**
 * Recovery model for the clinical conflict center: lists recoverable conflict snapshots for a day
 * and preserves one selected version with confirmation + notifications. Access is limited to
 * administrators. All restores are audited.
 * See docs/ADR_CONFLICT_VERSION_RECOVERY.md.
 */
export const useConflictVersionRecovery = ({
  date,
  port = defaultDailyRecordConflictRecoveryPort,
}: UseConflictVersionRecoveryOptions): ConflictVersionRecoveryModel => {
  const { role } = useAuth();
  const { confirm } = useConfirmDialog();
  const { success, error: notifyError } = useNotification();
  const canManageClinicalConflicts = canManageClinicalConflictCenter(role);

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<ConflictVersionSnapshot[]>([]);
  const [snapshotRecovery, setSnapshotRecovery] = useState<ConflictSnapshotRecoveryEvidence | null>(
    null
  );

  // CensusStaffHeader keeps this hook mounted across day changes (only the `date` prop changes).
  // Reset on date change so a stale, still-open list can never restore an old snapshotId against the
  // new day (the snapshot lives in the previous day's subcollection).
  useEffect(() => {
    setIsOpen(false);
    setLoading(false);
    setRestoringId(null);
    setSnapshots([]);
    setSnapshotRecovery(null);
  }, [date]);

  const load = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    try {
      const [snapshotsResult, recoveryResult] = await Promise.allSettled([
        port.listConflictVersionSnapshots(date),
        port.getLatestConflictSnapshotRecovery?.(date) ?? Promise.resolve(null),
      ]);

      const nextSnapshotRecovery =
        recoveryResult.status === 'fulfilled' ? recoveryResult.value : null;

      if (snapshotsResult.status === 'fulfilled') {
        setSnapshots(snapshotsResult.value);
        setSnapshotRecovery(nextSnapshotRecovery);
        return;
      }

      setSnapshots([]);
      setSnapshotRecovery(
        nextSnapshotRecovery
          ? {
              ...nextSnapshotRecovery,
              unavailableReason: resolveSnapshotListUnavailableReason(snapshotsResult.reason),
            }
          : {
              status: 'failed',
              unavailableReason: resolveSnapshotListUnavailableReason(snapshotsResult.reason),
            }
      );
    } finally {
      setLoading(false);
    }
  }, [date, port]);

  const open = useCallback(() => {
    setIsOpen(true);
    void load();
  }, [load]);

  const close = useCallback(() => setIsOpen(false), []);

  const restore = useCallback(
    async (
      snapshotId: string,
      options?: {
        title?: string;
        message?: string;
        confirmText?: string;
        successTitle?: string;
        successMessage?: string;
        reviewContext?: ConflictVersionRestoreAuditDetails['reviewContext'];
      }
    ) => {
      if (!date) return;
      const confirmed = await confirm({
        title: options?.title || 'Preservar versión clínica',
        message:
          options?.message ||
          'Se reemplazará el registro del día con esta versión. El estado actual quedará ' +
            'guardado en el historial y la acción quedará auditada.',
        confirmText: options?.confirmText || 'Preservar',
        cancelText: 'Cancelar',
        variant: 'warning',
      });
      if (!confirmed) return;

      setRestoringId(snapshotId);
      try {
        const result = await port.restoreDailyRecordVersion(
          date,
          snapshotId,
          options?.reviewContext
        );
        if (result.status === 'restored') {
          success(
            options?.successTitle || 'Versión preservada',
            options?.successMessage || 'El registro del día fue actualizado con la versión elegida.'
          );
          setIsOpen(false);
        } else if (result.status === 'blocked') {
          notifyError(
            `Restauración bloqueada por seguridad clínica: ${result.impactAnalysis.blockingImpactCount} impacto(s) crítico(s).`
          );
          void load();
        } else {
          notifyError('La versión ya no está disponible.');
          void load();
        }
      } catch {
        notifyError('No se pudo restaurar la versión.');
      } finally {
        setRestoringId(null);
      }
    },
    [date, port, confirm, success, notifyError, load]
  );

  return {
    canManageClinicalConflicts,
    isOpen,
    loading,
    restoringId,
    snapshots,
    snapshotRecovery,
    open,
    close,
    restore,
  };
};
