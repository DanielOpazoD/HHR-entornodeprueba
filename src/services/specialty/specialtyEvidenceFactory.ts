/**
 * Construye la evidencia cerrada del episodio desde el registro vigente.
 * Solo estructura lo que el censo ya conoce: diagnóstico principal validado,
 * señal del médico tratante resuelta contra el catálogo y contexto
 * estructurado. Nunca inventa umbrales ni deduce códigos desde texto libre.
 */
import type { PatientData } from '@/types/domain/patient';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import type {
  DiagnosisEvidence,
  EpisodeContext,
  EpisodeEvidence,
} from '@/domain/specialtyAssignment/evidence';
import { normalizeCie10Code } from '@/domain/specialtyAssignment/cie10';
import { buildProfessionalSignals } from '@/domain/specialtyAssignment/professionalEligibility';

/** Edad del censo ("45", "45 años", "8m", "2 días") → años, o undefined. */
export const parseCensusAgeYears = (age: string | undefined): number | undefined => {
  const raw = String(age ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return undefined;
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s*(a(?:ños?)?|y|m|mes(?:es)?|d(?:ías?)?)?$/);
  if (!match) return undefined;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const unit = match[2] ?? 'a';
  if (unit.startsWith('m')) return Math.floor(amount / 12);
  if (unit.startsWith('d')) return 0;
  return Math.floor(amount);
};

const diagnosisEvidenceOf = (patient: PatientData): DiagnosisEvidence => {
  const raw = String(patient.cie10Code ?? '').trim();
  if (!raw) return { status: 'absent' };
  const code = normalizeCie10Code(raw);
  if (!code) return { status: 'invalid', raw };
  return {
    status: 'present',
    code,
    description: String(patient.cie10Description ?? '').trim() || undefined,
  };
};

const contextOf = (patient: PatientData, bedType?: string): EpisodeContext => ({
  ageYears: parseCensusAgeYears(patient.age),
  sex:
    patient.biologicalSex === 'Masculino'
      ? 'M'
      : patient.biologicalSex === 'Femenino'
        ? 'F'
        : undefined,
  isObstetric: patient.ginecobstetriciaType === 'Obstétrica' ? true : undefined,
  bedType,
  admissionOrigin: patient.admissionOrigin,
});

export interface EpisodeEvidenceInput {
  patient: PatientData;
  facilityId: string;
  catalog: ProfessionalCatalogItem[];
  ruleSetVersion: string;
  professionalCatalogVersion: string;
  capturedAt: string;
  bedType?: string;
}

/**
 * Captura la evidencia del episodio del paciente. Devuelve `null` si no hay
 * identidad de episodio estable (sin `clinicalEpisodeId` no hay autoridad).
 */
export const captureEpisodeEvidence = (input: EpisodeEvidenceInput): EpisodeEvidence | null => {
  const episodeId = String(input.patient.clinicalEpisodeId ?? '').trim();
  if (!episodeId) return null;
  return {
    episodeId,
    facilityId: input.facilityId,
    capturedAt: input.capturedAt,
    ruleSetVersion: input.ruleSetVersion,
    professionalCatalogVersion: input.professionalCatalogVersion,
    diagnosis: diagnosisEvidenceOf(input.patient),
    professionals: buildProfessionalSignals(input.catalog, [
      {
        practitionerId: input.patient.treatingPhysicianId,
        displayName: input.patient.treatingPhysicianName,
      },
    ]),
    context: contextOf(input.patient, input.bedType),
  };
};
