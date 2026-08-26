import type { PatientData } from './patient';

/** Clinical fields whose persisted value is authoritative in the Rayen enrichment pipeline. */
export const RAYEN_OWNED_CLINICAL_FIELDS = [
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
] as const satisfies readonly (keyof PatientData)[];

export type RayenOwnedClinicalField = (typeof RAYEN_OWNED_CLINICAL_FIELDS)[number];
