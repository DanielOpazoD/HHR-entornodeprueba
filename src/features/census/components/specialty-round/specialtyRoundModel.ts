import { normalizeDiagnosisCode } from './specialtyRulesHistoryModel';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import type { SpecialtyTarget } from '@/services/specialty/specialtyJevClient';
import type { SpecialtyCatalogRule } from '@/services/specialty/specialtyJevClient';

export interface SpecialtyRoundCandidate {
  key: string;
  scope: SpecialtyTarget | null;
  bedName: string;
  patientName: string;
  cie10Code: string;
  cie10Description: string;
  diagnosis: string;
  decisionId: string | null;
}

export const roundPatient = (
  beds: Record<string, PatientData> | null | undefined,
  candidate: SpecialtyRoundCandidate
): PatientData | undefined => {
  const scope = candidate.scope;
  if (!scope) return undefined;
  const bed = beds?.[scope.bedId];
  return scope.target === 'clinicalCrib' ? bed?.clinicalCrib : bed;
};

export const isCurrentSpecialtyCandidate = (
  beds: Record<string, PatientData> | null | undefined,
  candidate: SpecialtyRoundCandidate
): boolean => {
  const patient = roundPatient(beds, candidate);
  return Boolean(
    patient?.patientName?.trim() &&
    !patient.isBlocked &&
    !beds?.[candidate.scope!.bedId]?.isBlocked &&
    patient.clinicalEpisodeId === candidate.scope?.episodeId &&
    !patient.specialty?.trim() &&
    !patient.specialtyAssignment &&
    (patient.cie10Code ?? '').trim().toUpperCase().replace(/\s+/g, '') === candidate.cie10Code &&
    (patient.cie10Description ?? '').trim() === candidate.cie10Description
  );
};

export const buildSpecialtyRoundCandidates = (
  beds: Record<string, PatientData> | null | undefined,
  date: string
): SpecialtyRoundCandidate[] =>
  Object.entries(beds ?? {}).flatMap(([bedId, bed]) => {
    const make = (patient: PatientData | undefined, target: SpecialtyTarget['target']) => {
      if (
        bed.isBlocked ||
        patient?.isBlocked ||
        !patient?.patientName?.trim() ||
        patient.specialty?.trim() ||
        patient.specialtyAssignment
      )
        return [];
      const episodeId = patient.clinicalEpisodeId?.trim();
      return [
        {
          key: `${bedId}:${target}`,
          scope: episodeId ? { date, bedId, target, episodeId } : null,
          bedName:
            target === 'clinicalCrib' ? `${bed.bedName || bedId} · cuna` : bed.bedName || bedId,
          patientName: patient.patientName.trim(),
          cie10Code: (patient.cie10Code ?? '').trim().toUpperCase().replace(/\s+/g, ''),
          cie10Description: (patient.cie10Description ?? '').trim(),
          diagnosis: (patient.cie10Description || patient.pathology || '').trim(),
          decisionId: null,
        },
      ];
    };
    return [...make(bed, 'bed'), ...make(bed.clinicalCrib, 'clinicalCrib')];
  });

export const resolveSpecialtyRoundRule = (
  rules: SpecialtyCatalogRule[],
  code: string,
  memory: SpecialtyCatalogRule[] = []
): string | null => {
  const normalized = normalizeDiagnosisCode(code);
  const explicit = rules.filter(rule => normalizeDiagnosisCode(rule.cie10Code) === normalized);
  if (explicit.some(rule => rule.kind === 'review')) return null;
  const remembered = memory.filter(rule => normalizeDiagnosisCode(rule.cie10Code) === normalized);
  const matches = remembered.length ? remembered : explicit;
  if (matches.some(rule => rule.kind === 'review')) return null;
  const values = [
    ...new Set(
      matches
        .filter(rule => rule.kind === 'assign')
        .map(rule => rule.specialty)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  return values.length === 1 ? values[0] : null;
};
