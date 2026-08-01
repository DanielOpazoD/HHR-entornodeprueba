import type { PatientData } from '@/types/domain/patient';

export const SYNC_OWNERSHIP_POLICY_VERSION = '2026-05-daily-record-v2';

export type DailyRecordSyncOwnership =
  | 'remoteCanonical'
  | 'localNarrative'
  | 'adminRemote'
  | 'movementInvariant'
  | 'mergeById'
  | 'derivedProjection'
  | 'default';

const PATIENT_FIELD_OWNERSHIP = {
  firstName: 'remoteCanonical',
  lastName: 'remoteCanonical',
  secondLastName: 'remoteCanonical',
  identityStatus: 'remoteCanonical',
  patientName: 'remoteCanonical',
  rut: 'remoteCanonical',
  documentType: 'remoteCanonical',
  age: 'remoteCanonical',
  birthDate: 'remoteCanonical',
  biologicalSex: 'remoteCanonical',
  insurance: 'remoteCanonical',
  isRapanui: 'remoteCanonical',
  cudyr: 'remoteCanonical',
  evaluationScores: 'remoteCanonical',
  vitalSigns: 'remoteCanonical',
  vitalSignsHistory: 'remoteCanonical',
  pathology: 'remoteCanonical',
  snomedCode: 'remoteCanonical',
  cie10Code: 'remoteCanonical',
  cie10Description: 'remoteCanonical',
  diagnosisComments: 'remoteCanonical',
  treatingPhysicianId: 'remoteCanonical',
  treatingPhysicianName: 'remoteCanonical',
  specialty: 'remoteCanonical',
  secondarySpecialty: 'remoteCanonical',
  status: 'remoteCanonical',
  ginecobstetriciaType: 'remoteCanonical',
  deliveryRoute: 'remoteCanonical',
  deliveryDate: 'remoteCanonical',
  deliveryCesareanLabor: 'remoteCanonical',
  isUPC: 'remoteCanonical',
  isIsolated: 'remoteCanonical',
  isolationType: 'remoteCanonical',
  isolationMicroorganism: 'remoteCanonical',
  upcChecklist: 'remoteCanonical',
  surgicalComplication: 'remoteCanonical',
  firstSeenDate: 'remoteCanonical',
  clinicalEpisodeId: 'remoteCanonical',

  bedId: 'adminRemote',
  bedName: 'adminRemote',
  isBlocked: 'adminRemote',
  blockedReason: 'adminRemote',
  bedMode: 'adminRemote',
  hasCompanionCrib: 'adminRemote',
  location: 'adminRemote',
  admissionDate: 'adminRemote',
  admissionTime: 'adminRemote',
  admissionOrigin: 'adminRemote',
  admissionOriginDetails: 'adminRemote',
  origin: 'adminRemote',
  hasWristband: 'adminRemote',

  handoffNote: 'localNarrative',
  handoffNoteDayShift: 'localNarrative',
  handoffNoteNightShift: 'localNarrative',
  medicalHandoffNote: 'localNarrative',
  medicalHandoffAudit: 'localNarrative',
  clinicalCrib: 'movementInvariant',

  devices: 'mergeById',
  deviceDetails: 'mergeById',
  clinicalEvents: 'mergeById',
  deviceInstanceHistory: 'mergeById',
  medicalHandoffEntries: 'mergeById',
  clinicalSyncCheckpoint: 'mergeById',
  fhir_resource: 'derivedProjection',
} as const satisfies Record<keyof PatientData, DailyRecordSyncOwnership>;

export const PATIENT_SYNC_OWNERSHIP_FIELDS = Object.keys(PATIENT_FIELD_OWNERSHIP) as Array<
  keyof PatientData
>;

const ROOT_OWNERSHIP = {
  discharges: 'mergeById',
  transfers: 'mergeById',
  cma: 'mergeById',
  activeExtraBeds: 'derivedProjection',
} as const satisfies Record<string, DailyRecordSyncOwnership>;

export const resolvePatientFieldSyncOwnership = (field: string): DailyRecordSyncOwnership =>
  PATIENT_FIELD_OWNERSHIP[field as keyof typeof PATIENT_FIELD_OWNERSHIP] ?? 'default';

export const resolveDailyRecordSyncOwnership = (path: string): DailyRecordSyncOwnership => {
  const [root, , patientField] = path.split('.');
  if (root === 'beds' && patientField) {
    return resolvePatientFieldSyncOwnership(patientField);
  }
  return ROOT_OWNERSHIP[root as keyof typeof ROOT_OWNERSHIP] ?? 'default';
};

export const hasPatientFieldSyncOwnership = (
  field: string,
  ownership: DailyRecordSyncOwnership
): boolean => resolvePatientFieldSyncOwnership(field) === ownership;
