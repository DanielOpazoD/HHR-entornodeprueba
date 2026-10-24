import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import { ClinicalDerivedEpisodeDocSchema } from '@/schemas/zod/clinicalDerived';
import {
  CLINICAL_DERIVED_MOVED_FIELDS,
  applyMovedFields,
  isClinicalDerivedDocId,
  overlayClinicalDerived,
  readClinicalDerivedLayout,
} from '@/services/storage/clinicalDerivedContract';
import type { ClinicalDerivedDayRestore } from '@/services/exporters/clinicalDerivedBackupSection';

/**
 * Restore of a split day from a JSON backup (D10 and D14 of
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md). The backup's `clinicalDerived` section
 * holds each episode's document; a client never writes those documents, so the restore embeds
 * their moved fields back into the day, the form a recreated day starts in until each episode's
 * first split write. Each document goes to the holders of its own `clinicalEpisodeId`, never to a
 * bed: an active bed patient or clinical crib (the D4 overlay, so mother and newborn stay apart)
 * and the snapshot of a live discharge, transfer or CMA. Loaded on demand
 * (`loadClinicalDerivedDayRestore`).
 */

type MovedField = (typeof CLINICAL_DERIVED_MOVED_FIELDS)[number];
type PlainObject = Record<string, unknown>;

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

/** Per episode id, the moved fields its bed, crib or live movement snapshot holds. */
const carriedMovedFields = (record: DailyRecord): Map<string, Set<MovedField>> => {
  const carried = new Map<string, Set<MovedField>>();
  const visit = (holder: unknown, episodeId = episodeIdOf(holder)) => {
    if (!episodeId || !isPlainObject(holder)) return;
    const fields = carried.get(episodeId) ?? new Set<MovedField>();
    CLINICAL_DERIVED_MOVED_FIELDS.forEach(field => {
      if (holder[field] !== undefined && holder[field] !== null) fields.add(field);
    });
    carried.set(episodeId, fields);
  };
  Object.values(isPlainObject(record.beds) ? record.beds : {}).forEach(bed => {
    visit(bed);
    if (isPlainObject(bed)) visit(bed.clinicalCrib);
  });
  MOVEMENT_LISTS.forEach(list => {
    const movements: unknown = record[list];
    (Array.isArray(movements) ? movements : []).forEach((movement: unknown) => {
      const snapshot = snapshotOf(movement);
      if (snapshot) visit(snapshot, snapshotEpisodeId(movement as PlainObject, snapshot));
    });
  });
  return carried;
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
 * Whether `saved` still holds what was brought back: it kept the backup's generation, so its
 * server documents are the current copies, or each episode still carries every expected moved
 * field. An existing day the server keeps as stored, or a recreated one whose clinical fields it
 * dropped, does not.
 */
const keepsRestore = (
  layoutGeneration: string,
  expected: ReadonlyMap<string, ReadonlySet<MovedField>>,
  saved: DailyRecord | undefined
): boolean => {
  if (!saved) return false;
  const savedLayout = readClinicalDerivedLayout(saved);
  if (savedLayout.status === 'marked' && savedLayout.layout.generation === layoutGeneration) {
    return true;
  }
  const carried = carriedMovedFields(saved);
  return [...expected].every(([id, fields]) =>
    [...fields].every(field => carried.get(id)?.has(field) === true)
  );
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
  if (!allUsable || placed.size < docsById.size) return { kind: 'incomplete', record: restored };

  const carried = carriedMovedFields(restored);
  const expected = new Map(
    [...placed]
      .map(id => [id, carried.get(id) ?? new Set<MovedField>()] as const)
      .filter(([, fields]) => fields.size > 0)
  );
  return {
    kind: 'embedded',
    record: restored,
    needsConfirmation: expected.size > 0,
    isKeptBy: saved =>
      expected.size === 0 || keepsRestore(layout.layout.generation, expected, saved),
  };
};
