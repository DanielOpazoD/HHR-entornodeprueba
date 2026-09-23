/**
 * Resolución de la señal profesional a elegibilidad de especialidad.
 *
 * Replica la semántica del catálogo vigente (`treatingPhysicianCatalog`):
 * - ID estable conocido → resuelve exacto.
 * - ID estable desconocido → NO cae al nombre (un homónimo conocido no prueba
 *   identidad).
 * - Sin ID → solo un nombre exacto, normalizado y ÚNICO en el catálogo.
 * - Generales, sin especialidad, ambiguos o mapeados fuera del catálogo
 *   elegible (`Otro`, Anestesia, Kinesiología…) → excluidos: no aportan votos
 *   ni se convierten silenciosamente a Med Interna.
 */
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import type { AutomaticSpecialty } from './contracts';
import { isAutomaticSpecialty } from './contracts';
import type { ProfessionalSignal } from './evidence';
import {
  normalizedName,
  professionalCatalogKey,
  professionalSpecialtyToPatientSpecialty,
} from '@/services/staff/treatingPhysicianCatalog';

export interface ProfessionalIdentity {
  practitionerId?: string;
  displayName?: string;
}

const GENERAL_PRACTICE_LABELS = new Set([
  'general',
  'medicina general',
  'medico general',
  'generalista',
  'medicina familiar',
  'medico familiar',
  'medicina familiar y comunitaria',
]);

const classifyCatalogSpecialty = (
  specialty: string | undefined
):
  | { eligible: AutomaticSpecialty }
  | { excluded: 'no_specialty' | 'general' | 'off_catalog_specialty' } => {
  const raw = (specialty ?? '').trim();
  if (!raw) return { excluded: 'no_specialty' };
  const mapped = professionalSpecialtyToPatientSpecialty(raw);
  if (isAutomaticSpecialty(mapped)) return { eligible: mapped };
  if (GENERAL_PRACTICE_LABELS.has(normalizedName(raw))) return { excluded: 'general' };
  return { excluded: 'off_catalog_specialty' };
};

const resolveByUniqueName = (
  catalog: ProfessionalCatalogItem[],
  displayName: string | undefined
): { item?: ProfessionalCatalogItem; ambiguous: boolean } => {
  const key = normalizedName(displayName);
  if (!key) return { ambiguous: false };
  const matches = catalog.filter(item => normalizedName(item.name) === key);
  if (matches.length === 1) return { item: matches[0], ambiguous: false };
  return { ambiguous: matches.length > 1 };
};

/**
 * Resuelve la elegibilidad de una identidad profesional.
 *
 * - Con ID: autoritativo. Conocido → su especialidad catalogada; desconocido →
 *   excluido `unknown_id` sin fallback por nombre.
 * - Sin ID: nombre único exacto normalizado; homónimos → `ambiguous_name`;
 *   ausente → `missing_identity`.
 */
export const resolveProfessionalEligibility = (
  catalog: ProfessionalCatalogItem[],
  identity: ProfessionalIdentity
): { signal: ProfessionalSignal; item?: ProfessionalCatalogItem } => {
  const practitionerId = identity.practitionerId?.trim();
  const displayName = (identity.displayName ?? '').replace(/\s+/g, ' ').trim();

  if (practitionerId) {
    const item = catalog.find(entry => entry.rayenPractitionerId === practitionerId);
    const key = `id:${practitionerId}`;
    if (!item) {
      return {
        signal: {
          key,
          identityKind: 'id',
          eligibility: { status: 'excluded', reason: 'unknown_id' },
        },
      };
    }
    const classified = classifyCatalogSpecialty(item.specialty);
    return {
      item,
      signal: {
        key,
        identityKind: 'id',
        eligibility:
          'eligible' in classified
            ? { status: 'eligible', specialty: classified.eligible }
            : { status: 'excluded', reason: classified.excluded },
      },
    };
  }

  if (!displayName) {
    return {
      signal: {
        key: 'none',
        identityKind: 'name',
        eligibility: { status: 'excluded', reason: 'missing_identity' },
      },
    };
  }

  const { item, ambiguous } = resolveByUniqueName(catalog, displayName);
  const key = `name:${normalizedName(displayName)}`;
  if (ambiguous) {
    return {
      signal: {
        key,
        identityKind: 'name',
        eligibility: { status: 'excluded', reason: 'ambiguous_name' },
      },
    };
  }
  if (!item) {
    return {
      signal: {
        key,
        identityKind: 'name',
        eligibility: { status: 'excluded', reason: 'missing_identity' },
      },
    };
  }
  const classified = classifyCatalogSpecialty(item.specialty);
  return {
    item,
    signal: {
      key: professionalCatalogKey(item),
      identityKind: 'name',
      eligibility:
        'eligible' in classified
          ? { status: 'eligible', specialty: classified.eligible }
          : { status: 'excluded', reason: classified.excluded },
    },
  };
};

/** Deduplica señales por clave estable de identidad (un autor = una señal). */
export const buildProfessionalSignals = (
  catalog: ProfessionalCatalogItem[],
  identities: ProfessionalIdentity[]
): ProfessionalSignal[] => {
  const byKey = new Map<string, ProfessionalSignal>();
  for (const identity of identities) {
    const { signal } = resolveProfessionalEligibility(catalog, identity);
    if (signal.key === 'none') continue;
    if (!byKey.has(signal.key)) byKey.set(signal.key, signal);
  }
  return [...byKey.values()];
};
