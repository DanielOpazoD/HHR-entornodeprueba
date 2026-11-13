import { isSameDocument, normalizeRut } from '@/utils/rutUtils';
import type { EloisaManualPatientPayload } from './eloisaPatientCode';

interface CensusPatientIdentity {
  patientName?: string;
  rut?: string;
  clinicalEpisodeId?: string;
}

interface CensusIdentitySnapshot {
  beds?: Record<string, CensusPatientIdentity>;
}

export type ManualPatientDuplicate =
  | { kind: 'rut'; bedId: string }
  | { kind: 'episode'; bedId: string };

export const findManualPatientDuplicate = (
  record: CensusIdentitySnapshot | null | undefined,
  payload: Pick<EloisaManualPatientPayload, 'rut' | 'encounterId'>
): ManualPatientDuplicate | null => {
  const candidateEpisode = String(payload.encounterId || '').trim();
  for (const [bedId, patient] of Object.entries(record?.beds ?? {})) {
    if (!patient?.patientName?.trim()) continue;
    // A marker such as «SIN RUT» carries no digits: it names nobody, so it never matches.
    if (normalizeRut(payload.rut) && isSameDocument(patient.rut, payload.rut))
      return { kind: 'rut', bedId };
    if (candidateEpisode && String(patient.clinicalEpisodeId || '').trim() === candidateEpisode) {
      return { kind: 'episode', bedId };
    }
  }
  return null;
};
