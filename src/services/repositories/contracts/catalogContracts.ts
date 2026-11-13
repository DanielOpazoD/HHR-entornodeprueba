import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

const normalizeString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

/** Shown while nobody configured a catalog; never elements the server confirmed. */
export const NURSE_CATALOG_EXAMPLES = ['Enfermero/a 1', 'Enfermero/a 2'] as const;
export const TENS_CATALOG_EXAMPLES = ['TENS 1', 'TENS 2', 'TENS 3'] as const;

const exampleLists = new WeakSet<object>();
/** A read that found no saved list returns the examples marked as such, never as saved names. */
export const catalogExamples = (examples: readonly string[]): string[] => {
  const list = [...examples];
  exampleLists.add(list);
  return list;
};
export const isCatalogExampleList = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && exampleLists.has(value);

export const normalizeStringCatalog = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeString(entry);
    if (normalized) unique.add(normalized);
  }

  return Array.from(unique);
};

const SPECIALTY_ALIAS_MAP: Record<string, ProfessionalCatalogItem['specialty']> = {
  'medicina interna': 'Medicina Interna',
  'med interna': 'Med Interna',
  medicina: 'Medicina Interna',
  medico: 'Medicina Interna',
  medicos: 'Medicina Interna',
  cirugia: 'Cirugía',
  cirugía: 'Cirugía',
  traumatologia: 'Traumatología',
  traumatología: 'Traumatología',
  ginecobstetricia: 'Ginecobstetricia',
  psiquiatria: 'Psiquiatría',
  psiquiatría: 'Psiquiatría',
  pediatria: 'Pediatría',
  pediatría: 'Pediatría',
  odontologia: 'Odontología',
  odontología: 'Odontología',
  otro: 'Otro',
  anestesia: 'Anestesia',
  anestesista: 'Anestesia',
  kinesiologia: 'Kinesiología',
  kinesiología: 'Kinesiología',
  kine: 'Kinesiología',
};

const normalizeSpecialty = (value: unknown): ProfessionalCatalogItem['specialty'] | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  if (!normalized) return null;
  return SPECIALTY_ALIAS_MAP[normalized] || trimmed;
};

const normalizeIso = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toProfessionalCatalogItem = (entry: unknown): ProfessionalCatalogItem | null => {
  if (!entry || typeof entry !== 'object') return null;

  const candidate = entry as Record<string, unknown>;
  const name = normalizeString(candidate.name);
  const phone = normalizeString(candidate.phone);
  const specialty = normalizeSpecialty(candidate.specialty);
  const rayenPractitionerId = normalizeString(candidate.rayenPractitionerId) || undefined;
  const source =
    candidate.source === 'rayen' ? 'rayen' : candidate.source === 'manual' ? 'manual' : undefined;

  if (!name) {
    return null;
  }

  return {
    name,
    phone,
    specialty: specialty || undefined,
    rayenPractitionerId,
    source,
    period: normalizeIso(candidate.period),
    lastUsed: normalizeIso(candidate.lastUsed),
  };
};

export const normalizeProfessionalCatalog = (value: unknown): ProfessionalCatalogItem[] => {
  if (!Array.isArray(value)) return [];

  const unique = new Map<string, ProfessionalCatalogItem>();

  for (const entry of value) {
    const item = toProfessionalCatalogItem(entry);
    if (!item) continue;

    const key = item.rayenPractitionerId
      ? `rayen:${item.rayenPractitionerId}`
      : `${item.name.toLowerCase()}:${item.phone}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return Array.from(unique.values());
};

export const assertCatalogSubscriptionCallback = (callback: unknown, catalogName: string): void => {
  if (typeof callback !== 'function') {
    throw new Error(`[RepositoryContract] ${catalogName} subscription callback must be a function`);
  }
};

/** The catalog change has not been confirmed by the server. */
export class CatalogRemoteSyncError extends Error {
  constructor(cause: unknown) {
    super(
      'El cambio no se guardó. Lo escrito se conserva; vuelva a guardar cuando haya conexión.',
      { cause }
    );
  }
}
