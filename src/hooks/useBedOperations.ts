/**
 * useBedOperations Hook
 * Handles bed-level operations: block, extra beds, move/copy, clear.
 * Extracted from useBedManagement for better separation of concerns.
 *
 * Five mutations (`clearPatient`, `toggleBlockBed`, `updateBlockedReason`,
 * `toggleExtraBed`, `toggleBedType`) now return a typed
 * `ApplicationOutcome<BedOperationResultPayload>` instead of `void`. The
 * payload's `outcome` field discriminates `applied` vs `noop`, with an
 * optional `warning` carried for noops (e.g., empty source for a move,
 * unknown bed). Existing callers that ignore the return value are
 * unchanged; new callers can react to the outcome the same way the
 * canonical commands do.
 */

import { useCallback } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  DailyRecordPatch,
} from '@/application/shared/dailyRecordCoreContracts';
import { useAuditContext } from '@/context/AuditContext';
import { bedOperationsLogger } from '@/hooks/hookLoggers';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { buildClearAllBedsPatch, buildClearPatientPatch } from './useBedOperationsController';
import {
  resolveBlockedReasonUpdate,
  resolveMoveOrCopyOperation,
  resolveToggleBedTypeOperation,
  resolveToggleBlockedOperation,
  resolveToggleExtraBedOperation,
  toBedOperationAuditArgs,
  type BedOperationResolution,
} from '@/hooks/controllers/bedOperationsAuditController';

export interface BedOperationResultPayload {
  outcome: 'applied' | 'noop';
  warning?: string;
}

export type BedOperationOutcome = ApplicationOutcome<BedOperationResultPayload>;

const NO_RECORD_OUTCOME: BedOperationOutcome = createApplicationFailed(
  { outcome: 'noop' as const, warning: 'no_record_available' },
  [{ kind: 'not_found', message: 'No hay registro diario activo para esta operación.' }]
);

const APPLIED_OUTCOME: BedOperationOutcome = createApplicationSuccess({
  outcome: 'applied',
});

const buildNoopOutcome = (warning: string): BedOperationOutcome =>
  createApplicationSuccess({ outcome: 'noop', warning });

// ============================================================================
// Types
// ============================================================================

export interface BedOperationsActions {
  /**
   * Clear patient data from a bed (reset to empty). Returns a typed
   * outcome so callers can react to noops (e.g., bed unknown / no
   * patient to clear).
   */
  clearPatient: (bedId: string) => BedOperationOutcome;

  /**
   * Clear all beds in the record. Returns void because there is no
   * meaningful per-bed outcome to surface.
   */
  clearAllBeds: () => void;

  /**
   * Move or copy a patient from one bed to another.
   */
  moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;

  /**
   * Toggle bed blocked status.
   */
  toggleBlockBed: (bedId: string, reason?: string) => BedOperationOutcome;
  updateBlockedReason: (bedId: string, reason: string) => BedOperationOutcome;

  /**
   * Toggle extra bed activation.
   */
  toggleExtraBed: (bedId: string) => BedOperationOutcome;

  /**
   * Toggle bed type (UTI/UCI).
   */
  toggleBedType: (bedId: string) => BedOperationOutcome;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export const useBedOperations = (
  record: DailyRecord | null,
  patchRecord: ApplyDailyRecordPatch
): BedOperationsActions => {
  const { logEvent, logPatientCleared } = useAuditContext();

  const persistBedOperationPatch = useCallback(
    (patch: DailyRecordPatch, onSuccess?: () => void): void => {
      void patchRecord(patch)
        .then(() => {
          onSuccess?.();
        })
        .catch(error => {
          bedOperationsLogger.warn('Bed operation patch failed', error);
        });
    },
    [patchRecord]
  );

  const applyResolvedOperation = useCallback(
    (resolvedOperation: BedOperationResolution): BedOperationOutcome => {
      if (resolvedOperation.kind === 'noop') {
        return buildNoopOutcome(resolvedOperation.warning);
      }
      persistBedOperationPatch(resolvedOperation.patch, () => {
        logEvent(...toBedOperationAuditArgs(resolvedOperation));
      });
      return APPLIED_OUTCOME;
    },
    [logEvent, persistBedOperationPatch]
  );

  // ========================================================================
  // Clear Operations
  // ========================================================================

  const clearPatient = useCallback(
    (bedId: string): BedOperationOutcome => {
      if (!record) return NO_RECORD_OUTCOME;

      const bed = record.beds[bedId];
      if (!bed) return buildNoopOutcome(`unknown_bed:${bedId}`);

      const { patch } = buildClearPatientPatch(record, bedId);

      const patientName = bed.patientName;
      persistBedOperationPatch(patch, () => {
        if (patientName) {
          logPatientCleared(bedId, patientName, bed.rut, record.date);
        }
      });
      return APPLIED_OUTCOME;
    },
    [record, persistBedOperationPatch, logPatientCleared]
  );

  const clearAllBeds = useCallback(() => {
    if (!record) return;
    persistBedOperationPatch(buildClearAllBedsPatch(record));
  }, [record, persistBedOperationPatch]);

  // ========================================================================
  // Move/Copy Operations
  // ========================================================================

  const moveOrCopyPatient = useCallback(
    (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => {
      if (!record) return;
      const resolvedOperation = resolveMoveOrCopyOperation(record, type, sourceBedId, targetBedId);
      applyResolvedOperation(resolvedOperation);
    },
    [applyResolvedOperation, record]
  );

  // ========================================================================
  // Block/Extra Bed Operations
  // ========================================

  const toggleBlockBed = useCallback(
    (bedId: string, reason?: string): BedOperationOutcome => {
      if (!record) return NO_RECORD_OUTCOME;
      return applyResolvedOperation(resolveToggleBlockedOperation(record, bedId, reason));
    },
    [applyResolvedOperation, record]
  );

  /**
   * Update the blocked reason for an already blocked bed without toggling the block state.
   */
  const updateBlockedReason = useCallback(
    (bedId: string, reason: string): BedOperationOutcome => {
      if (!record) return NO_RECORD_OUTCOME;
      return applyResolvedOperation(resolveBlockedReasonUpdate(record, bedId, reason));
    },
    [applyResolvedOperation, record]
  );

  const toggleExtraBed = useCallback(
    (bedId: string): BedOperationOutcome => {
      if (!record) return NO_RECORD_OUTCOME;
      return applyResolvedOperation(resolveToggleExtraBedOperation(record, bedId));
    },
    [applyResolvedOperation, record]
  );

  const toggleBedType = useCallback(
    (bedId: string): BedOperationOutcome => {
      if (!record) return NO_RECORD_OUTCOME;
      return applyResolvedOperation(resolveToggleBedTypeOperation(record, bedId));
    },
    [applyResolvedOperation, record]
  );

  // ========================================================================
  // Return API
  // ========================================================================

  return {
    clearPatient,
    clearAllBeds,
    moveOrCopyPatient,
    toggleBlockBed,
    updateBlockedReason,
    toggleExtraBed,
    toggleBedType,
  };
};
