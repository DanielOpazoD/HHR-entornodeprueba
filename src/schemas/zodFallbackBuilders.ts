import type { PatientData } from '@/types/domain/patient';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { CudyrScoreSchema } from '@/schemas/zod/patient';
import { UpcChecklistSchema } from '@/schemas/zod/upc';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';

export interface FallbackPatientDataOptions {
  /**
   * Set on a split day: its moved clinical fields are found by episode id (overlay and direct
   * writes), so a salvaged bed or crib must keep it or it would read empty and a full save would
   * drop its embedded copy. Unmarked days salvage as before.
   */
  keepClinicalEpisodeId?: boolean;
}

export const buildFallbackPatientData = (
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
    fallback.clinicalCrib = buildFallbackPatientData(raw.clinicalCrib, bedId, options);
  }

  return fallback;
};
