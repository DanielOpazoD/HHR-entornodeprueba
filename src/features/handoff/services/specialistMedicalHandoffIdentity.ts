import { buildLegacyClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import type { PatientData } from '@/types/domain/patient';

import type { SpecialistHandoffTarget } from '@/types/domain/specialistHandoffTarget';

export type SpecialistHandoffIdentity = Omit<SpecialistHandoffTarget, 'bedId' | 'target'>;

/** Patient plus episode: handoff rows and detached day edits are bound to it. */
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
