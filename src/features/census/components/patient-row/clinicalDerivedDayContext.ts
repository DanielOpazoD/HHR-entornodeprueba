import { createContext, useContext, useMemo } from 'react';
import { CLINICAL_DERIVED_LAYOUT_VERSION } from '@/services/storage/clinicalDerivedConstants';

/**
 * The census day's clinicalDerived marker (docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md,
 * D10), for row cells that read an episode document on demand: its generation and the episode ids
 * active more than once that day, which no holder reads (D4). Undefined on an unmarked day, outside
 * the census table or for a marker version this client does not understand (cells keep the
 * embedded copy).
 */
export interface ClinicalDerivedDayLayout {
  generation: string;
  duplicateEpisodeIds: ReadonlySet<string>;
}

const ClinicalDerivedDayContext = createContext<ClinicalDerivedDayLayout | undefined>(undefined);

export const ClinicalDerivedDayProvider = ClinicalDerivedDayContext.Provider;

/** The generation one row's episode reads its document with, or undefined to keep the day's copy. */
export const useClinicalDerivedEpisodeGeneration = (
  clinicalEpisodeId: string | undefined
): string | undefined => {
  const day = useContext(ClinicalDerivedDayContext);
  const episodeId = clinicalEpisodeId?.trim();
  return day && episodeId && !day.duplicateEpisodeIds.has(episodeId) ? day.generation : undefined;
};

/** Readers validate the generation again before any read. */
export const resolveClinicalDerivedDayGeneration = (marker: unknown): string | undefined => {
  if (!marker || typeof marker !== 'object') return undefined;
  const { version, generation } = marker as { version?: unknown; generation?: unknown };
  return version === CLINICAL_DERIVED_LAYOUT_VERSION && typeof generation === 'string'
    ? generation
    : undefined;
};

const activeEpisodeIdOf = (holder: unknown): string => {
  if (!holder || typeof holder !== 'object') return '';
  const { isBlocked, clinicalEpisodeId } = holder as {
    isBlocked?: unknown;
    clinicalEpisodeId?: unknown;
  };
  return !isBlocked && typeof clinicalEpisodeId === 'string' ? clinicalEpisodeId.trim() : '';
};

/**
 * Ids active more than once among the bed patients and their clinical cribs (sorted). Same holders
 * as `collectClinicalDerivedEpisodes` (clinicalDerivedContract.ts), which loads on demand only.
 */
export const collectDuplicateActiveEpisodeIds = (beds: unknown): string[] => {
  const counts = new Map<string, number>();
  const count = (holder: unknown) => {
    const episodeId = activeEpisodeIdOf(holder);
    if (episodeId) counts.set(episodeId, (counts.get(episodeId) ?? 0) + 1);
  };
  Object.values(beds && typeof beds === 'object' ? beds : {}).forEach((bed: unknown) => {
    count(bed);
    if (bed && typeof bed === 'object') count((bed as { clinicalCrib?: unknown }).clinicalCrib);
  });
  return [...counts]
    .filter(([, total]) => total > 1)
    .map(([episodeId]) => episodeId)
    .sort();
};

/**
 * The census table's provider value: only for the record of the date it shows, and stable while
 * the generation and the repeated ids stay the same, so rows do not re-render for it.
 */
export const useCensusClinicalDerivedDay = (
  record: { date?: string; beds?: unknown; clinicalDerivedLayout?: unknown } | null | undefined,
  currentDateString: string
): ClinicalDerivedDayLayout | undefined => {
  const generation =
    record?.date === currentDateString
      ? resolveClinicalDerivedDayGeneration(record.clinicalDerivedLayout)
      : undefined;
  const duplicatesKey = generation
    ? JSON.stringify(collectDuplicateActiveEpisodeIds(record?.beds))
    : '[]';
  return useMemo(
    () =>
      generation
        ? { generation, duplicateEpisodeIds: new Set(JSON.parse(duplicatesKey) as string[]) }
        : undefined,
    [generation, duplicatesKey]
  );
};
