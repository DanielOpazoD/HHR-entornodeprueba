import type { PatientData } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  clinicalFieldValuesEqual,
  type CanonicalClinicalField,
} from './clinicalFieldCanonicalization';

interface ClinicalPatientPatchResult {
  patch: DailyRecordPatch;
  checkpointChanged: boolean;
  clinicalFieldCount: number;
}

/** Builds the allowlisted patient delta and classifies clinical vs checkpoint-only changes. */
export const buildClinicalPatientPatch = (
  patient: PatientData,
  merged: PatientData,
  bedId: string,
  clinicalCrib: boolean
): ClinicalPatientPatchResult => {
  const patch: DailyRecordPatch = {};
  const prefix = `beds.${bedId}${clinicalCrib ? '.clinicalCrib' : ''}`;
  const copyChanged = (field: CanonicalClinicalField): void => {
    if (!clinicalFieldValuesEqual(field, merged[field], patient[field])) {
      patch[`${prefix}.${field}`] = merged[field];
    }
  };
  copyChanged('devices');
  copyChanged('deviceDetails');
  copyChanged('deviceInstanceHistory');
  copyChanged('evaluationScores');
  copyChanged('vitalSigns');
  copyChanged('vitalSignsHistory');
  copyChanged('clinicalSyncCheckpoint');

  const checkpointPath = `${prefix}.clinicalSyncCheckpoint`;
  const checkpointChanged = Object.prototype.hasOwnProperty.call(patch, checkpointPath);
  return {
    patch,
    checkpointChanged,
    clinicalFieldCount: Object.keys(patch).filter(path => path !== checkpointPath).length,
  };
};
