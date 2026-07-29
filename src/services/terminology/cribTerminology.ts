const LEGACY_CLINICAL_CRIB_LABEL = /cuna\s+cl[ií]nica/giu;

/** Keeps historical records readable without migrating their persisted payloads. */
export const normalizeCribDisplayText = (value: string | undefined): string =>
  (value ?? '').replace(LEGACY_CLINICAL_CRIB_LABEL, 'Cuna RN');
