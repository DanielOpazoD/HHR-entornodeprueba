import type { PatientData } from '@/types/domain/patient';

import { BEDS } from '@/constants/beds';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

import { clonePatient, createEmptyPatient } from '@/domain/patient/patientFactory';
import { parsePatientDataWithDefaults } from '@/schemas/zodSchemas';
import { mapPatientToFhir } from '@/services/utils/fhirMappers';
import { createDailyRecordAggregate } from '@/services/repositories/dailyRecordAggregate';
import {
  inheritPatientHandoffNotes,
  inheritPatientMedicalHandoff,
} from '@/services/repositories/dailyRecordHandoffDomainService';
import { normalizePatientUpcForBed } from '@/shared/census/upcBedPolicy';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';

const hasCarryoverIdentity = (patient: PatientData): boolean =>
  Boolean((patient.patientName?.trim() || patient.rut?.trim()) && patient.admissionDate?.trim());

const resetCarryoverCudyr = (patient: PatientData): void => {
  patient.cudyr = undefined;
  if (patient.clinicalCrib) {
    patient.clinicalCrib.cudyr = undefined;
  }
};

const resetCarryoverRayenClinicalFields = (patient: PatientData): void => {
  RAYEN_OWNED_CLINICAL_FIELDS.forEach(field => {
    if (field === 'devices') {
      patient.devices = [];
      return;
    }
    delete patient[field];
  });

  if (patient.clinicalCrib) {
    resetCarryoverRayenClinicalFields(patient.clinicalCrib);
  }
};

const shouldClonePreviousPatient = (prevPatient: PatientData): boolean =>
  Boolean(prevPatient.isBlocked || hasCarryoverIdentity(prevPatient));

export const preparePatientForCarryover = (
  sourcePatient: PatientData,
  targetBedId = sourcePatient.bedId
): PatientData => {
  const clonedPatient = parsePatientDataWithDefaults(clonePatient(sourcePatient), targetBedId);
  resetCarryoverCudyr(clonedPatient);
  resetCarryoverRayenClinicalFields(clonedPatient);
  inheritPatientHandoffNotes(clonedPatient, sourcePatient);
  inheritPatientMedicalHandoff(clonedPatient, sourcePatient);

  if (clonedPatient.clinicalCrib && sourcePatient.clinicalCrib) {
    inheritPatientHandoffNotes(clonedPatient.clinicalCrib, sourcePatient.clinicalCrib);
    inheritPatientMedicalHandoff(clonedPatient.clinicalCrib, sourcePatient.clinicalCrib);
  }

  return normalizePatientUpcForBed(clonedPatient, targetBedId);
};

export const buildEmptyClinicalBeds = (): Record<string, PatientData> => {
  const initialBeds: Record<string, PatientData> = {};
  BEDS.forEach(bed => {
    initialBeds[bed.id] = createEmptyPatient(bed.id);
  });
  return initialBeds;
};

export const buildClinicalBedsFromPreviousRecord = (
  initialBeds: Record<string, PatientData>,
  prevRecord: DailyRecord
): Record<string, PatientData> => {
  const nextBeds = { ...initialBeds };
  const aggregate = createDailyRecordAggregate(prevRecord);

  BEDS.forEach(bed => {
    const prevPatient = aggregate.clinical.getPatient(bed.id);
    if (!prevPatient) return;

    if (shouldClonePreviousPatient(prevPatient)) {
      nextBeds[bed.id] = preparePatientForCarryover(prevPatient);
    } else {
      const currentBed = nextBeds[bed.id];
      if (currentBed) {
        currentBed.bedMode = prevPatient.bedMode || currentBed.bedMode;
        currentBed.hasCompanionCrib = prevPatient.hasCompanionCrib || false;
      }
    }

    const targetBed = nextBeds[bed.id];
    if (prevPatient.location && bed.isExtra && targetBed) {
      targetBed.location = prevPatient.location;
    }
  });

  return nextBeds;
};

export const syncPatientFhirResource = (patient: PatientData | undefined): void => {
  if (!patient?.patientName?.trim()) {
    return;
  }

  patient.fhir_resource = mapPatientToFhir(patient);
};

export const syncDailyRecordClinicalResources = (record: DailyRecord): void => {
  createDailyRecordAggregate(record).clinical.forEachPatient(patient => {
    syncPatientFhirResource(patient);
    syncPatientFhirResource(patient.clinicalCrib);
  });
};

export const collectDailyRecordPatientsForMasterSync = (record: DailyRecord): PatientData[] => {
  const patientsToSync: PatientData[] = [];

  createDailyRecordAggregate(record).clinical.forEachPatient(patient => {
    if (patient.patientName?.trim() && patient.rut?.trim()) {
      patientsToSync.push(patient);
    }

    if (patient.clinicalCrib?.patientName?.trim() && patient.clinicalCrib.rut?.trim()) {
      patientsToSync.push(patient.clinicalCrib);
    }
  });

  return patientsToSync;
};

const getTouchedBedIds = (patch: DailyRecordPatch): string[] =>
  Array.from(
    new Set(
      Object.keys(patch)
        .filter(key => key.startsWith('beds.'))
        .map(key => key.split('.')[1])
        .filter((bedId): bedId is string => Boolean(bedId))
    )
  );

const getTouchedBedPaths = (patch: DailyRecordPatch, bedId: string): string[] =>
  Object.keys(patch)
    .filter(key => key.startsWith(`beds.${bedId}.`))
    .map(key => key.slice(`beds.${bedId}.`.length));

const CLINICAL_EVENTS_BED_PATH_PREFIXES = ['clinicalEvents', 'clinicalCrib.clinicalEvents'];

const CLINICAL_EVENTS_RECORD_KEYS = ['lastUpdated', 'dateTimestamp'];

const isClinicalEventsOnlyBedPatch = (patch: DailyRecordPatch, bedId: string): boolean => {
  const touchedPaths = getTouchedBedPaths(patch, bedId);
  if (touchedPaths.length === 0) {
    return false;
  }

  return touchedPaths.every(path =>
    CLINICAL_EVENTS_BED_PATH_PREFIXES.some(
      prefix => path === prefix || path.startsWith(`${prefix}.`)
    )
  );
};

/** One bed's clinical events alone: written as they come, without structural normalization. */
export const isClinicalEventsOnlyDailyRecordPatch = (patch: DailyRecordPatch): boolean => {
  const touchedBedIds = getTouchedBedIds(patch);
  const nonBedKeys = Object.keys(patch).filter(key => !key.startsWith('beds.'));

  if (!nonBedKeys.every(key => CLINICAL_EVENTS_RECORD_KEYS.includes(key))) {
    return false;
  }

  const [singleBedId] = touchedBedIds;
  return (
    touchedBedIds.length === 1 &&
    singleBedId !== undefined &&
    isClinicalEventsOnlyBedPatch(patch, singleBedId)
  );
};

export const addClinicalFhirPatchesForTouchedBeds = (
  mergedPatches: DailyRecordPatch,
  validatedRecord: DailyRecord
): void => {
  getTouchedBedIds(mergedPatches).forEach(bedId => {
    if (isClinicalEventsOnlyDailyRecordPatch(mergedPatches)) {
      return;
    }

    const patient = validatedRecord.beds[bedId];
    if (!patient) {
      return;
    }

    if (patient.patientName?.trim()) {
      mergedPatches[`beds.${bedId}.fhir_resource`] = mapPatientToFhir(patient);
    }

    if (patient.clinicalCrib?.patientName?.trim()) {
      mergedPatches[`beds.${bedId}.clinicalCrib.fhir_resource`] = mapPatientToFhir(
        patient.clinicalCrib
      );
    }
  });
};
