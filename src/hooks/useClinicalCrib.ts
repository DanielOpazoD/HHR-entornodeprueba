/**
 * useClinicalCrib Hook
 * Manages clinical crib (nested patient) operations.
 * Extracted from useBedManagement for better separation of concerns.
 */

import { useCallback } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  DailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecordBedsState } from '@/application/shared/dailyRecordBedContracts';
import { PatientData } from '@/hooks/contracts/patientHookContracts';
import { PatientFieldValue } from '@/types/valueTypes';
import { clinicalCribLogger } from '@/hooks/hookLoggers';
import {
  buildClinicalCribMultiplePatch,
  buildClinicalCribPatch,
  buildRemoveClinicalCribPatch,
  isClinicalCribFieldUpdateAllowed,
  sanitizeClinicalCribUpdates,
} from '@/hooks/controllers/clinicalCribController';
import { buildConfirmedBedOccupantIdentity } from '@/hooks/controllers/intentionalBedClearController';

export interface ClinicalCribActions {
  createCrib: (bedId: string) => Promise<void>;
  removeCrib: (bedId: string) => Promise<void>;
  updateCribField: (
    bedId: string,
    field: keyof PatientData,
    value: PatientFieldValue
  ) => Promise<void>;
  updateCribMultiple: (bedId: string, updates: Partial<PatientData>) => Promise<void>;
}

export const useClinicalCrib = (
  record: (DailyRecordBedsState & Pick<DailyRecord, 'lastUpdated'>) | null,
  _saveAndUpdate: PersistDailyRecord,
  patchRecord: ApplyDailyRecordPatch
): ClinicalCribActions => {
  /**
   * Create a new clinical crib for a patient bed
   */
  const createCrib = useCallback(
    (bedId: string) => {
      if (!record) return Promise.resolve();

      const parentPatient = record.beds[bedId];

      // Validation: Cannot add crib to empty bed
      if (!parentPatient.patientName) {
        clinicalCribLogger.warn(`Cannot add clinical crib to empty bed ${bedId}`);
        return Promise.resolve();
      }

      return patchRecord(buildClinicalCribPatch(bedId, parentPatient), {
        consistency: 'remote_confirmed',
        optimisticRemoteConfirmed: true,
        clinicalCribCreate: {
          bedId,
          confirmedLastUpdated: record.lastUpdated,
          confirmedParent: buildConfirmedBedOccupantIdentity(parentPatient),
        },
      }).catch(error => {
        clinicalCribLogger.warn('Clinical crib create failed', error);
      });
    },
    [record, patchRecord]
  );

  /**
   * Remove clinical crib from a patient bed
   */
  const removeCrib = useCallback(
    (bedId: string) => {
      if (!record) return Promise.resolve();

      return patchRecord(buildRemoveClinicalCribPatch(bedId)).catch(error => {
        clinicalCribLogger.warn('Clinical crib remove failed', error);
      });
    },
    [record, patchRecord]
  );

  /**
   * Update a field on the clinical crib
   */
  const updateCribField = useCallback(
    (bedId: string, field: keyof PatientData, value: PatientFieldValue) => {
      if (!record) return Promise.resolve();

      if (!isClinicalCribFieldUpdateAllowed(field, value)) {
        clinicalCribLogger.warn('Cannot set admission date to future');
        return Promise.resolve();
      }

      const parentPatient = record.beds[bedId];
      if (!parentPatient.clinicalCrib) return Promise.resolve();

      return patchRecord({
        [`beds.${bedId}.clinicalCrib.${field}`]: value,
      } as DailyRecordPatch).catch(error => {
        clinicalCribLogger.warn('Clinical crib field update failed', error);
      });
    },
    [record, patchRecord]
  );

  /**
   * Update multiple clinical crib fields atomically
   */
  const updateCribMultiple = useCallback(
    (bedId: string, updates: Partial<PatientData>) => {
      if (!record) return Promise.resolve();

      const parentPatient = record.beds[bedId];
      if (!parentPatient.clinicalCrib) return Promise.resolve();

      const sanitizedUpdates = sanitizeClinicalCribUpdates(updates);
      if (updates.admissionDate && !sanitizedUpdates.admissionDate) {
        clinicalCribLogger.warn('Cannot set admission date to future');
      }

      return patchRecord(buildClinicalCribMultiplePatch(bedId, sanitizedUpdates)).catch(error => {
        clinicalCribLogger.warn('Clinical crib multiple update failed', error);
      });
    },
    [record, patchRecord]
  );

  return {
    createCrib,
    removeCrib,
    updateCribField,
    updateCribMultiple,
  };
};
