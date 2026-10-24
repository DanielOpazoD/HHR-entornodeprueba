import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import { ClinicalDerivedEpisodeDocSchema } from '@/schemas/zod/clinicalDerived';
import {
  applyMovedFields,
  isClinicalDerivedDocId,
  overlayClinicalDerived,
  readClinicalDerivedLayout,
} from '@/services/storage/clinicalDerivedContract';

/**
 * Restore of a split day from a JSON backup (D10 and D14 of
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md). The backup's `clinicalDerived` section
 * holds each episode's document; a client never writes those documents, so the restore embeds
 * their moved fields back into the day, the form a recreated day starts in until each episode's
 * first split write. Each document goes to the holders of its own `clinicalEpisodeId`, never to a
 * bed: an active bed patient or clinical crib (the D4 overlay, so mother and newborn stay apart)
 * and the snapshot of a live discharge, transfer or CMA. Loaded on demand by the importers.
 */

type PlainObject = Record<string, unknown>;

export type ClinicalDerivedDayRestore =
  /** The backup holds no per-episode data for this day. */
  | { kind: 'absent' }
  /** Some of it is missing or has no place in the day; `record` carries what could be embedded. */
  | { kind: 'incomplete'; record: DailyRecord }
  /** Every document of the day found its episode. */
  | { kind: 'embedded'; record: DailyRecord };

const MOVEMENT_LISTS = ['discharges', 'transfers', 'cma'] as const;

const isPlainObject = (value: unknown): value is PlainObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const episodeIdOf = (holder: unknown): string =>
  isPlainObject(holder) && typeof holder.clinicalEpisodeId === 'string'
    ? holder.clinicalEpisodeId.trim()
    : '';

/** A movement whose snapshot can be restored: not deleted, with the patient it took out. */
const snapshotOf = (movement: unknown): PlainObject | undefined =>
  isPlainObject(movement) && !movement.deletedAt && isPlainObject(movement.originalData)
    ? movement.originalData
    : undefined;

const snapshotEpisodeId = (movement: PlainObject, snapshot: PlainObject): string =>
  episodeIdOf(snapshot) || episodeIdOf(movement);

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

/** `record` with the documents' moved fields in the live movement snapshots of their episode. */
const embedInMovements = (
  record: DailyRecord,
  docsById: ReadonlyMap<string, ClinicalDerivedEpisodeDoc>,
  placed: Set<string>
): DailyRecord => {
  const next: PlainObject = { ...record };
  MOVEMENT_LISTS.forEach(list => {
    const movements: unknown = record[list];
    if (!Array.isArray(movements)) return;
    next[list] = movements.map((movement: unknown) => {
      const snapshot = snapshotOf(movement);
      const doc = snapshot && docsById.get(snapshotEpisodeId(movement as PlainObject, snapshot));
      if (!snapshot || !doc) return movement;
      placed.add(doc.clinicalEpisodeId);
      return { ...(movement as PlainObject), originalData: applyMovedFields(snapshot, doc) };
    });
  });
  return next as unknown as DailyRecord;
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
  if (entry === undefined) return { kind: 'absent' };
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
  const docsById = new Map(usable.map(doc => [doc.clinicalEpisodeId, doc]));
  const overlay = overlayClinicalDerived(record, usable);
  const placed = new Set(overlay.matchedEpisodeIds);
  const restored = embedInMovements(overlay.record, docsById, placed);
  return allUsable && placed.size === docsById.size
    ? { kind: 'embedded', record: restored }
    : { kind: 'incomplete', record: restored };
};
