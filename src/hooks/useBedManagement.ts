import { useCallback, useRef, useEffect } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { PatientData } from '@/hooks/contracts/patientHookContracts';
import type { CudyrBatchUpdate, CudyrScore, CudyrScorePatch } from '@/types/domain/cudyr';
import { PatientFieldValue } from '@/types/valueTypes';
import { usePatientValidation } from './usePatientValidation';
import { useBedAudit } from './useBedAudit';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import { useBedManagementActionCreators } from '@/hooks/useBedManagementActionCreators';
import type { StaleDayEditGuard } from '@/hooks/useStaleDayEditGuard';

/**
 * Interface defining the actions available for bed management.
 */
export interface BedManagementActions {
  /**
   * Updates a single field for a patient in a specific bed.
   * Includes validation and audit logging for admissions.
   */
  updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;

  /**
   * Updates multiple patient fields atomically.
   */
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;

  /**
   * Updates a specific field in the CUDYR score for a patient.
   */
  updateCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;
  updateCudyrMultiple: (bedId: string, fields: CudyrScorePatch) => void;
  updateCudyrBatch: (changes: CudyrBatchUpdate) => Promise<boolean>;

  /**
   * Manages clinical crib operations (create, remove, or update fields).
   */
  updateClinicalCrib: (
    bedId: string,
    field: keyof PatientData | 'create' | 'remove',
    value?: PatientFieldValue
  ) => void;

  /**
   * Updates multiple clinical crib fields atomically.
   */
  updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;

  /**
   * Updates a specific field in the CUDYR score for a clinical crib.
   */
  updateClinicalCribCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;
  updateClinicalCribCudyrMultiple: (bedId: string, fields: CudyrScorePatch) => void;

  /**
   * Clears patient data from a bed (Discharge/Cleanup).
   */
  clearPatient: (bedId: string) => void;

  /**
   * Clears all beds in the current record.
   */
  clearAllBeds: () => void;

  /**
   * Moves or copies a patient from one bed to another.
   */
  moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;

  /**
   * Toggles the blocked status of a bed with an optional reason.
   */
  toggleBlockBed: (bedId: string, reason?: string) => void;
  updateBlockedReason: (bedId: string, reason: string) => void;

  /**
   * Toggles an extra bed visibility.
   */
  toggleExtraBed: (bedId: string) => void;

  /**
   * Toggles bed level of care (UTI/UCI)
   */
  toggleBedType: (bedId: string) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useBedManagement Hook
 *
 * Orchestrates all bed-related operations using a Redux-style reducer pattern.
 * This simplifies delegation and makes state transitions predictable.
 */
export const useBedManagement = (
  record: DailyRecord | null,
  _saveAndUpdate: PersistDailyRecord, // Kept for legacy compat
  patchRecord: ApplyDailyRecordPatch,
  // Injected from a layer that has the UI + audit providers (the authenticated
  // runtime). Optional so lower-level tests can render this hook without them.
  ensureStaleDayEditAllowed?: StaleDayEditGuard
): BedManagementActions => {
  const validation = usePatientValidation();
  const bedAudit = useBedAudit(record);

  // Use a ref to keep record stable in callbacks
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  // ========================================================================
  // Dispatcher
  // ========================================================================

  const dispatchAndWait = useCallback(
    (action: BedAction): Promise<boolean> =>
      executeBedManagementAction({
        currentRecord: recordRef.current,
        action,
        validation,
        bedAudit,
        patchRecord,
        ensureStaleDayEditAllowed,
      }),
    [validation, patchRecord, bedAudit, ensureStaleDayEditAllowed]
  );

  const dispatch = useCallback(
    (action: BedAction) => {
      void dispatchAndWait(action);
    },
    [dispatchAndWait]
  );

  return useBedManagementActionCreators(dispatch, dispatchAndWait);
};
