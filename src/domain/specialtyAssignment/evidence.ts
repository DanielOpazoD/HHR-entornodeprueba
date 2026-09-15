/**
 * Evidencia cerrada del episodio que alimenta el resolver determinista.
 *
 * La captura construye un conjunto coherente: diagnóstico principal activo
 * validado, señales profesionales ya resueltas a elegibilidad, contexto
 * estructurado y versiones de catálogo/reglas. El fingerprint deduplica
 * trabajo: misma huella + misma decisión = nada que reevaluar.
 */
import type { AutomaticSpecialty } from './contracts';

export type DiagnosisEvidence =
  | { status: 'present'; code: string; description?: string }
  | { status: 'absent' }
  | { status: 'invalid'; raw?: string }
  | { status: 'read_error' }
  | { status: 'contradictory' };

export type ProfessionalEligibility =
  | { status: 'eligible'; specialty: AutomaticSpecialty }
  | {
      status: 'excluded';
      reason:
        | 'unknown_id'
        | 'ambiguous_name'
        | 'missing_identity'
        | 'no_specialty'
        | 'general'
        | 'off_catalog_specialty';
    }
  | { status: 'unknown' };

/** Señal profesional deduplicada por identidad estable del autor clínico. */
export interface ProfessionalSignal {
  /** Clave estable: `id:<practitionerId>` o `name:<normalized>`. Nunca el importador. */
  key: string;
  identityKind: 'id' | 'name';
  eligibility: ProfessionalEligibility;
}

export interface EpisodeContext {
  ageYears?: number;
  sex?: 'M' | 'F' | 'X';
  isObstetric?: boolean;
  bedType?: string;
  admissionOrigin?: string;
}

export interface EpisodeEvidence {
  episodeId: string;
  facilityId: string;
  capturedAt: string;
  /** Revisión del catálogo de reglas (incluye la memoria) al capturar. */
  ruleSetVersion: string;
  /** Versión del catálogo profesional usado para resolver elegibilidad. */
  professionalCatalogVersion: string;
  diagnosis: DiagnosisEvidence;
  professionals: ProfessionalSignal[];
  context: EpisodeContext;
}

/** Especialidades elegibles distintas aportadas por la evidencia profesional. */
export const eligibleProfessionalSpecialties = (
  evidence: Pick<EpisodeEvidence, 'professionals'>
): AutomaticSpecialty[] => {
  const found = new Set<AutomaticSpecialty>();
  for (const signal of evidence.professionals) {
    if (signal.eligibility.status === 'eligible') {
      found.add(signal.eligibility.specialty);
    }
  }
  return [...found];
};

const sortObjectKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => [key, sortObjectKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
};

/**
 * Huella estable (FNV-1a 32-bit hex) del conjunto de evidencia y versiones.
 * No es criptográfica: deduplica evaluaciones y detecta trabajo obsoleto.
 */
export const evidenceFingerprint = (evidence: EpisodeEvidence): string => {
  const canonical = {
    diagnosis:
      evidence.diagnosis.status === 'present'
        ? { status: 'present', code: evidence.diagnosis.code }
        : { status: evidence.diagnosis.status },
    professionals: evidence.professionals
      .map(signal => ({
        key: signal.key,
        specialty: signal.eligibility.status === 'eligible' ? signal.eligibility.specialty : null,
        status: signal.eligibility.status,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    context: evidence.context,
    ruleSetVersion: evidence.ruleSetVersion,
    professionalCatalogVersion: evidence.professionalCatalogVersion,
  };
  const serialized = JSON.stringify(sortObjectKeys(canonical));
  let hash = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
