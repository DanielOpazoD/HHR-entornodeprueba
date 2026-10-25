import { buildLegacyClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

import type { SpecialistHandoffTarget } from '@/types/domain/specialistHandoffTarget';
export type { SpecialistHandoffTarget } from '@/types/domain/specialistHandoffTarget';

export type SpecialistHandoffIdentity = Omit<SpecialistHandoffTarget, 'bedId' | 'target'>;

/** Patient plus episode, as the server checks them. Rows, drafts and queue keys all use this. */
export const buildSpecialistHandoffIdentity = (
  patient?: PatientData
): SpecialistHandoffIdentity => ({
  clinicalEpisodeId: patient
    ? patient.clinicalEpisodeId?.trim() || buildLegacyClinicalEpisodeId(patient) || ''
    : '',
  rut: patient?.rut?.trim() ?? '',
  documentType: patient?.documentType ?? 'RUT',
  patientName: patient?.patientName?.trim() ?? '',
});

export const specialistHandoffIdentityKey = (identity: SpecialistHandoffIdentity): string =>
  JSON.stringify([
    identity.documentType,
    identity.rut,
    identity.patientName,
    identity.clinicalEpisodeId,
  ]);

/**
 * A patient's note text as the server compares it before a specialist write: the note and each
 * entry's id and text. The callable builds the same string.
 */
export const specialistHandoffTextState = (
  patient?: Pick<PatientData, 'medicalHandoffNote' | 'medicalHandoffEntries'>
): string =>
  JSON.stringify([
    String(patient?.medicalHandoffNote ?? ''),
    (Array.isArray(patient?.medicalHandoffEntries) ? patient.medicalHandoffEntries : []).map(
      entry => [String(entry?.id ?? ''), String(entry?.note ?? '')]
    ),
  ]);

/**
 * Freeze the identities, and the note text each edit started from, from the edited record,
 * never from a retry's fresh occupant.
 */
export const buildSpecialistHandoffTargets = (
  record: DailyRecord,
  patch: object
): SpecialistHandoffTarget[] => {
  const targets = new Map<string, SpecialistHandoffTarget>();
  for (const path of Object.keys(patch)) {
    const [root, bedId, field] = path.split('.');
    if (root !== 'beds' || !bedId) continue;
    const target = field === 'clinicalCrib' ? 'clinicalCrib' : 'bed';
    const bed = record.beds?.[bedId];
    const patient = target === 'clinicalCrib' ? bed?.clinicalCrib : bed;
    targets.set(`${bedId}.${target}`, {
      bedId,
      target,
      ...buildSpecialistHandoffIdentity(patient),
      handoffBases: [specialistHandoffTextState(patient)],
    });
  }
  return [...targets.values()];
};

export const sameSpecialistHandoffTarget = (
  left: SpecialistHandoffTarget,
  right: SpecialistHandoffTarget
): boolean =>
  left.bedId === right.bedId &&
  left.target === right.target &&
  left.clinicalEpisodeId === right.clinicalEpisodeId &&
  left.rut === right.rut &&
  left.documentType === right.documentType &&
  left.patientName === right.patientName;
