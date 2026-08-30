import { createEmptyPatient } from '@/services/factories/patientFactory';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import type { ClinicalCribCreateRequest } from '@/types/domain/intentionalBedClear';
import { resolveClinicalEpisodeIdForAdmission } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import {
  buildConfirmedBedOccupantIdentity,
  canRebaseIntentionalBedClear,
} from '@/hooks/controllers/intentionalBedClearController';

const isFutureDate = (value: string): boolean => {
  const selectedDate = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return selectedDate > today;
};

export const resolveMotherLabel = (patient: PatientData): string => {
  const fullNameFromParts = [patient.firstName, patient.lastName, patient.secondLastName]
    .map(part => (part || '').trim())
    .filter(Boolean)
    .join(' ');
  const fallbackName = (patient.patientName || '').trim();
  return fullNameFromParts || fallbackName || 'Madre';
};

export const buildClinicalCribDraft = (bedId: string, parentPatient: PatientData): PatientData => {
  const newCrib = createEmptyPatient(bedId);
  newCrib.bedMode = 'Cuna';
  newCrib.identityStatus = 'provisional';
  newCrib.patientName = `RN de ${resolveMotherLabel(parentPatient)}`;
  newCrib.firstName = '';
  newCrib.lastName = '';
  newCrib.secondLastName = '';
  newCrib.rut = '';
  newCrib.documentType = 'RUT';
  // A manually-created crib is its own clinical episode. Persisting the identifier in the
  // original command lets later destructive actions distinguish this crib from a replacement
  // that happens to receive the same generated display name.
  newCrib.clinicalEpisodeId = resolveClinicalEpisodeIdForAdmission(newCrib);
  return newCrib;
};

export const buildClinicalCribPatch = (
  bedId: string,
  parentPatient: PatientData
): DailyRecordPatch => {
  return {
    [`beds.${bedId}.clinicalCrib`]: buildClinicalCribDraft(bedId, parentPatient),
    [`beds.${bedId}.hasCompanionCrib`]: false,
  } as DailyRecordPatch;
};

export const canApplyClinicalCribCreate = (
  request: ClinicalCribCreateRequest,
  candidate: DailyRecord | null | undefined
): candidate is DailyRecord =>
  canRebaseIntentionalBedClear(
    {
      bedId: request.bedId,
      confirmedLastUpdated: request.confirmedLastUpdated,
      confirmedOccupant: request.confirmedParent,
      confirmedAssociatedCrib: null,
    },
    candidate
  );

export const rebaseClinicalCribCreate = (
  request: ClinicalCribCreateRequest,
  candidate: DailyRecord
): ClinicalCribCreateRequest => ({
  ...request,
  confirmedLastUpdated: candidate.lastUpdated,
  confirmedParent: buildConfirmedBedOccupantIdentity(candidate.beds[request.bedId]),
});

export const rebaseClinicalCribCreatePatch = (
  patch: DailyRecordPatch,
  request: ClinicalCribCreateRequest,
  candidate: DailyRecord
): DailyRecordPatch => {
  const cribPath = `beds.${request.bedId}.clinicalCrib`;
  const cribDraft = patch[cribPath];
  const parent = candidate.beds[request.bedId];
  if (!parent || !cribDraft || typeof cribDraft !== 'object' || Array.isArray(cribDraft)) {
    return patch;
  }
  return {
    ...patch,
    [cribPath]: {
      ...cribDraft,
      patientName: `RN de ${resolveMotherLabel(parent)}`,
    },
  } as DailyRecordPatch;
};

export const buildRemoveClinicalCribPatch = (bedId: string): DailyRecordPatch =>
  ({
    [`beds.${bedId}.clinicalCrib`]: null,
  }) as DailyRecordPatch;

export const isClinicalCribFieldUpdateAllowed = (
  field: keyof PatientData,
  value: unknown
): boolean => !(field === 'admissionDate' && typeof value === 'string' && isFutureDate(value));

export const sanitizeClinicalCribUpdates = (
  updates: Partial<PatientData>
): Partial<PatientData> => {
  const nextUpdates = { ...updates };

  if (
    nextUpdates.admissionDate &&
    typeof nextUpdates.admissionDate === 'string' &&
    isFutureDate(nextUpdates.admissionDate)
  ) {
    delete nextUpdates.admissionDate;
  }

  return nextUpdates;
};

export const buildClinicalCribMultiplePatch = (
  bedId: string,
  updates: Partial<PatientData>
): DailyRecordPatch => {
  const patches: DailyRecordPatch = {};
  Object.entries(updates).forEach(([key, value]) => {
    (patches as Record<string, unknown>)[`beds.${bedId}.clinicalCrib.${key}`] = value;
  });
  return patches;
};
