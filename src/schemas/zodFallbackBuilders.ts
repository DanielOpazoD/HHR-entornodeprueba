import type { ZodIssue } from 'zod';
import type { PatientData } from '@/types/domain/patient';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { CudyrScoreSchema, PatientDataSchema } from '@/schemas/zod/patient';
import { UpcChecklistSchema } from '@/schemas/zod/upc';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';

export interface FallbackPatientDataOptions {
  /**
   * Set on a split day: its moved clinical fields are found by episode id (overlay and direct
   * writes), so a salvaged bed or crib must keep it or it would read empty and a full save would
   * drop its embedded copy. Also applies to the legacy fallback for invalid identity fields.
   */
  keepClinicalEpisodeId?: boolean;
}

const buildLegacyFallbackPatientData = (
  data: unknown,
  bedId: string,
  options: FallbackPatientDataOptions = {}
): PatientData => {
  const fallback = createEmptyPatient(bedId);
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

  if (options.keepClinicalEpisodeId && typeof raw.clinicalEpisodeId === 'string') {
    fallback.clinicalEpisodeId = raw.clinicalEpisodeId;
  }
  if (typeof raw.patientName === 'string') fallback.patientName = raw.patientName;
  if (typeof raw.rut === 'string') fallback.rut = raw.rut;
  if (typeof raw.pathology === 'string') fallback.pathology = raw.pathology;
  if (typeof raw.age === 'string') fallback.age = raw.age;
  if (typeof raw.admissionDate === 'string') fallback.admissionDate = raw.admissionDate;
  if (typeof raw.admissionTime === 'string') fallback.admissionTime = raw.admissionTime;
  if (raw.isBlocked === true) fallback.isBlocked = true;
  if (raw.bedMode === 'Cama' || raw.bedMode === 'Cuna') fallback.bedMode = raw.bedMode;
  if (raw.hasCompanionCrib === true) fallback.hasCompanionCrib = true;
  const upc = UpcChecklistSchema.safeParse(raw.upcChecklist);
  if (upc.success) fallback.upcChecklist = upc.data;
  fallback.isUPC = resolveEffectiveUpcState({
    bedId,
    isUPC: raw.isUPC === true,
    checklist: fallback.upcChecklist,
  }).isUpc;

  const cudyr = CudyrScoreSchema.safeParse(raw.cudyr);
  if (cudyr.success) {
    fallback.cudyr = cudyr.data;
  }

  if (raw.clinicalCrib && typeof raw.clinicalCrib === 'object') {
    fallback.clinicalCrib = buildLegacyFallbackPatientData(raw.clinicalCrib, bedId, options);
  }

  return fallback;
};

const identityFields = new Set([
  'documentType',
  'rut',
  'clinicalEpisodeId',
  'identityStatus',
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'admissionDate',
  'admissionTime',
]);

export const buildFallbackPatientDataReport = (
  data: unknown,
  bedId: string,
  options: FallbackPatientDataOptions = {}
): { patient: PatientData; droppedListItems: number } => {
  const candidate: Record<string, unknown> = {
    ...createEmptyPatient(bedId),
    ...(data && typeof data === 'object' ? data : {}),
    bedId,
  };
  const initial = PatientDataSchema.safeParse(candidate);
  if (
    !initial.success &&
    initial.error.issues.some(issue => identityFields.has(String(issue.path[0])))
  ) {
    // Identity corruption keeps the legacy fallback until the separate identity-repair change.
    return { patient: buildLegacyFallbackPatientData(data, bedId, options), droppedListItems: 0 };
  }

  let droppedListItems = 0;
  let clinicalCrib: PatientData | undefined;
  if (candidate.clinicalCrib && typeof candidate.clinicalCrib === 'object') {
    const crib = buildFallbackPatientDataReport(candidate.clinicalCrib, bedId, options);
    clinicalCrib = crib.patient;
    candidate.clinicalCrib = clinicalCrib;
    droppedListItems += crib.droppedListItems;
  }

  const parsed = PatientDataSchema.safeParse(candidate);
  if (!parsed.success) {
    const defaults: Record<string, unknown> = { ...createEmptyPatient(bedId) };
    const issuesByField = new Map<string, ZodIssue[]>();
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string') {
        const issues = issuesByField.get(field) ?? [];
        issues.push(issue);
        issuesByField.set(field, issues);
      }
    }
    for (const [field, issues] of issuesByField) {
      const list = candidate[field];
      if (Array.isArray(list) && issues.every(issue => typeof issue.path[1] === 'number')) {
        const invalidIndexes = new Set(issues.map(issue => issue.path[1]));
        candidate[field] = list.filter((_, index) => !invalidIndexes.has(index));
        droppedListItems += invalidIndexes.size;
      } else {
        candidate[field] = defaults[field];
      }
    }
  }

  const patient = parsed.success ? parsed.data : PatientDataSchema.parse(candidate);
  return {
    patient: {
      ...patient,
      ...(clinicalCrib ? { clinicalCrib } : {}),
      isUPC: resolveEffectiveUpcState({
        bedId,
        isUPC: patient.isUPC,
        checklist: patient.upcChecklist,
      }).isUpc,
    },
    droppedListItems,
  };
};

export const buildFallbackPatientData = (
  data: unknown,
  bedId: string,
  options: FallbackPatientDataOptions = {}
): PatientData => buildFallbackPatientDataReport(data, bedId, options).patient;
