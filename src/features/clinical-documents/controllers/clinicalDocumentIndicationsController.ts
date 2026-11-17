export type ClinicalDocumentIndicationSpecialtyId =
  | 'tmt'
  | 'cirugia'
  | 'medicina_interna'
  | 'psiquiatria'
  | 'ginecobstetricia'
  | 'pediatria';

const normalizeSearchValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Resolves a free-text specialty label to a known specialty ID using fuzzy matching.
 * @param specialtyLabel - Raw specialty name (may be null/undefined). Falls back to "cirugia".
 * @returns The matched {@link ClinicalDocumentIndicationSpecialtyId}.
 */
export const resolveClinicalDocumentIndicationSpecialty = (
  specialtyLabel: string | null | undefined
): ClinicalDocumentIndicationSpecialtyId => {
  const normalized = normalizeSearchValue(specialtyLabel || '');

  if (
    normalized.includes('trauma') ||
    normalized === 'tmt' ||
    normalized.includes('traumatologia')
  ) {
    return 'tmt';
  }

  if (normalized.includes('cirugia')) {
    return 'cirugia';
  }

  if (normalized.includes('psiqu')) {
    return 'psiquiatria';
  }

  if (normalized.includes('gine') || normalized.includes('obstet') || normalized === 'gyo') {
    return 'ginecobstetricia';
  }

  if (normalized.includes('pediatr')) {
    return 'pediatria';
  }

  if (normalized.includes('medicina')) {
    return 'medicina_interna';
  }

  return 'cirugia';
};

/** Normalizes an indication text into a lowercase, accent-stripped key for deduplication. */
export const normalizeClinicalDocumentIndicationTextKey = (value: string): string =>
  normalizeSearchValue(value);
