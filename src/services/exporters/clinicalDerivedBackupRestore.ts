import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type {
  ClinicalDerivedEpisodeDoc,
  ClinicalDerivedTarget,
} from '@/types/domain/clinicalDerived';
import { ClinicalDerivedEpisodeDocSchema } from '@/schemas/zod/clinicalDerived';
import {
  CLINICAL_DERIVED_MOVED_FIELDS,
  applyMovedFields,
  collectClinicalDerivedEpisodes,
  isClinicalDerivedDocId,
  readClinicalDerivedLayout,
} from '@/services/storage/clinicalDerivedContract';
import {
  restoreWithoutSectionEntry,
  type ClinicalDerivedDayRestore,
} from '@/services/exporters/clinicalDerivedBackupSection';

/**
 * Restore of a split day from a JSON backup (D10 and D14 of
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md). The backup's `clinicalDerived` section
 * holds each episode's document; a client never writes those documents, so the restore embeds
 * their moved fields back into the day, the form a recreated day starts in until each episode's
 * first split write. Each document goes to the single holder of its own `clinicalEpisodeId`, never
 * to a bed: an active bed patient or clinical crib (the D4 notion, so mother and newborn stay
 * apart) or the snapshot of a live discharge, transfer or CMA. An id more than one holder carries
 * is ambiguous: none of them gets the document. Loaded on demand (`loadClinicalDerivedDayRestore`).
 */

type PlainObject = Record<string, unknown>;

const MOVEMENT_LISTS = ['discharges', 'transfers', 'cma'] as const;

/** Where an episode lives in a day. */
type HolderLocation =
  | { kind: ClinicalDerivedTarget; bedId: string }
  | { kind: 'movement'; list: (typeof MOVEMENT_LISTS)[number]; index: number };

/** Each episode's only holder in a day, or `ambiguous` when more than one carries its id. */
type EpisodeHolders = Map<string, { location: HolderLocation; holder: unknown } | 'ambiguous'>;

const isPlainObject = (value: unknown): value is PlainObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const episodeIdOf = (holder: unknown): string =>
  isPlainObject(holder) && typeof holder.clinicalEpisodeId === 'string'
    ? holder.clinicalEpisodeId.trim()
    : '';

/** The patient a live (not deleted) movement took out, with that patient's episode id. */
const liveSnapshotOf = (movement: unknown): { snapshot: PlainObject; episodeId: string } | null => {
  if (!isPlainObject(movement) || movement.deletedAt || !isPlainObject(movement.originalData)) {
    return null;
  }
  const episodeId = episodeIdOf(movement.originalData) || episodeIdOf(movement);
  return episodeId ? { snapshot: movement.originalData, episodeId } : null;
};

const holdersByEpisode = (record: DailyRecord): EpisodeHolders => {
  const holders: EpisodeHolders = new Map();
  const add = (episodeId: string, location: HolderLocation, holder: unknown) =>
    holders.set(episodeId, holders.has(episodeId) ? 'ambiguous' : { location, holder });
  const { episodes, duplicateEpisodeIds } = collectClinicalDerivedEpisodes(record);
  episodes.forEach(({ bedId, target, clinicalEpisodeId }) => {
    const bed: unknown = record.beds[bedId];
    const holder = target === 'bed' ? bed : isPlainObject(bed) ? bed.clinicalCrib : undefined;
    add(clinicalEpisodeId, { kind: target, bedId }, holder);
  });
  duplicateEpisodeIds.forEach(episodeId => holders.set(episodeId, 'ambiguous'));
  MOVEMENT_LISTS.forEach(list => {
    const movements: unknown = record[list];
    (Array.isArray(movements) ? movements : []).forEach((movement: unknown, index) => {
      const live = liveSnapshotOf(movement);
      if (live) add(live.episodeId, { kind: 'movement', list, index }, live.snapshot);
    });
  });
  return holders;
};

/** `record` with `holder` in place of the one at `location`. Never mutates `record`. */
const withHolderAt = (
  record: DailyRecord,
  location: HolderLocation,
  holder: PlainObject
): DailyRecord => {
  const next: PlainObject = { ...record };
  if (location.kind === 'movement') {
    const movements: unknown[] = record[location.list];
    next[location.list] = movements.map((movement, index) =>
      index === location.index && isPlainObject(movement)
        ? { ...movement, originalData: holder }
        : movement
    );
  } else {
    const bed = record.beds[location.bedId];
    next.beds = {
      ...record.beds,
      [location.bedId]: location.kind === 'bed' ? holder : { ...bed, clinicalCrib: holder },
    };
  }
  return next as unknown as DailyRecord;
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!isPlainObject(value)) return JSON.stringify(value) ?? 'null';
  const keys = Object.keys(value)
    .filter(key => value[key] !== undefined)
    .sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

/** The moved fields a holder carries, comparable across a server round trip (absent = null). */
const movedFieldsKey = (holder: unknown): string =>
  canonical(
    Object.fromEntries(
      CLINICAL_DERIVED_MOVED_FIELDS.map(field => [
        field,
        isPlainObject(holder) ? (holder[field] ?? undefined) : undefined,
      ])
    )
  );

/**
 * Whether the day the server keeps holds, for each restored episode, what the backup carried: the
 * moved fields of its only holder in `saved`, under its current document (D4) when it has one.
 */
const holdsRestoredEpisodes = (
  restored: ReadonlyMap<string, string>,
  saved: DailyRecord,
  savedDocs: readonly ClinicalDerivedEpisodeDoc[]
): boolean => {
  const layout = readClinicalDerivedLayout(saved);
  if (layout.status === 'unsupported') return false;
  const current = new Map(
    savedDocs
      .filter(
        doc =>
          layout.status === 'marked' &&
          doc.date === saved.date &&
          doc.layoutGeneration === layout.layout.generation
      )
      .map(doc => [doc.clinicalEpisodeId, doc])
  );
  const holders = holdersByEpisode(saved);
  return [...restored].every(([episodeId, expected]) => {
    const found = holders.get(episodeId);
    if (!found || found === 'ambiguous') return false;
    const doc = current.get(episodeId);
    return movedFieldsKey(doc ? applyMovedFields(found.holder, doc) : found.holder) === expected;
  });
};

/**
 * The section's documents of this day's layout, parsed. A document that does not parse, belongs to
 * another day or generation, or repeats an episode is left out and makes the day incomplete.
 */
const parseDayDocs = (record: DailyRecord, layoutGeneration: string, docs: unknown[]) => {
  const byId = new Map<string, ClinicalDerivedEpisodeDoc[]>();
  docs.forEach(doc => {
    const parsed = ClinicalDerivedEpisodeDocSchema.safeParse(doc);
    if (
      parsed.success &&
      parsed.data.date === record.date &&
      parsed.data.layoutGeneration === layoutGeneration &&
      isClinicalDerivedDocId(parsed.data.clinicalEpisodeId)
    ) {
      byId.set(parsed.data.clinicalEpisodeId, [
        ...(byId.get(parsed.data.clinicalEpisodeId) ?? []),
        parsed.data,
      ]);
    }
  });
  const usable = [...byId.values()].flatMap(copies => (copies.length === 1 ? copies : []));
  return { usable, allUsable: usable.length === docs.length };
};

/**
 * The day to restore with the backup's per-episode data for `record.date` embedded. `section` is
 * the file's `clinicalDerived` value, untrusted: every document is parsed and must belong to this
 * day and to the generation the backup's day carries.
 */
export const restoreClinicalDerivedBackupDay = (
  record: DailyRecord,
  section: unknown
): ClinicalDerivedDayRestore => {
  const entry = isPlainObject(section) ? section[record.date] : undefined;
  if (entry === undefined) return restoreWithoutSectionEntry(record);
  const layout = readClinicalDerivedLayout(record);
  if (
    !isPlainObject(entry) ||
    entry.status !== 'exported' ||
    !Array.isArray(entry.docs) ||
    layout.status !== 'marked' ||
    entry.layoutGeneration !== layout.layout.generation
  ) {
    return { kind: 'incomplete', record };
  }

  const { usable, allUsable } = parseDayDocs(record, layout.layout.generation, entry.docs);
  const holders = holdersByEpisode(record);
  const restored = new Map<string, string>();
  let next = record;
  usable.forEach(doc => {
    const found = holders.get(doc.clinicalEpisodeId);
    if (!found || found === 'ambiguous') return;
    const holder = applyMovedFields(found.holder, doc);
    next = withHolderAt(next, found.location, holder);
    restored.set(doc.clinicalEpisodeId, movedFieldsKey(holder));
  });
  if (!allUsable || restored.size < usable.length) return { kind: 'incomplete', record: next };

  return {
    kind: 'embedded',
    record: next,
    needsConfirmation: restored.size > 0,
    isKeptBy: (saved, savedDocs) => holdsRestoredEpisodes(restored, saved, savedDocs),
  };
};
