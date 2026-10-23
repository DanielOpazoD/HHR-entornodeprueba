import { createContext, useContext } from 'react';
import { CLINICAL_DERIVED_LAYOUT_VERSION } from '@/services/storage/clinicalDerivedConstants';

/**
 * Generation of the census day's clinicalDerived marker (docs/DESIGN_DAILY_RECORD_PHASE1_
 * CLINICAL_DERIVED.md, D10), for row cells that read an episode document on demand. A string, so
 * rows re-render only when the marker changes; undefined on an unmarked day, outside the census
 * table or for a marker version this client does not understand (cells keep the embedded copy).
 */
const ClinicalDerivedDayGenerationContext = createContext<string | undefined>(undefined);

export const ClinicalDerivedDayGenerationProvider = ClinicalDerivedDayGenerationContext.Provider;

export const useClinicalDerivedDayGeneration = (): string | undefined =>
  useContext(ClinicalDerivedDayGenerationContext);

/** Readers validate the generation again before any read. */
export const resolveClinicalDerivedDayGeneration = (marker: unknown): string | undefined => {
  if (!marker || typeof marker !== 'object') return undefined;
  const { version, generation } = marker as { version?: unknown; generation?: unknown };
  return version === CLINICAL_DERIVED_LAYOUT_VERSION && typeof generation === 'string'
    ? generation
    : undefined;
};
