import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { ApplicationIssue } from '@/shared/contracts/applicationOutcomeTypes';

/**
 * JSON backups of split days (docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md, D10): the day
 * no longer holds each episode's moved fields, so the backup carries a `clinicalDerived` section
 * (`CLINICAL_DERIVED_BACKUP_SECTION`) with the episode documents of every marked day, read from
 * the server and keyed by date. A day that could not be read is listed as `unavailable`, never left
 * out, and the export reports it. Importers embed the documents' moved fields back into their
 * days (clinicalDerivedBackupRestore): only the server writes episode documents.
 */

export type ClinicalDerivedBackupDay =
  | { status: 'exported'; layoutGeneration: string; docs: ClinicalDerivedEpisodeDoc[] }
  | { status: 'unavailable'; reason: string };

export type ClinicalDerivedBackupSection = Record<string, ClinicalDerivedBackupDay>;

/** What restoring one day of a backup brings back of its section (clinicalDerivedBackupRestore). */
export type ClinicalDerivedDayRestore =
  /** An unmarked day the section does not cover: it has no per-episode data. */
  | { kind: 'absent' }
  /** Some of it is missing or has no single place in the day; `record` carries what was embedded. */
  | { kind: 'incomplete'; record: DailyRecord }
  /** Every document of the day found its episode; `record` carries their moved fields. */
  | {
      kind: 'embedded';
      record: DailyRecord;
      /** Some episode got its document back: check the server's day (`confirmClinicalDerivedDayRestore`). */
      needsConfirmation: boolean;
      /** Whether `day` and its current episode documents hold each restored episode's values. */
      isKeptBy: (day: DailyRecord, docs: readonly ClinicalDerivedEpisodeDoc[]) => boolean;
    };

type EmbeddedDayRestore = Extract<ClinicalDerivedDayRestore, { kind: 'embedded' }>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const READ_CONCURRENCY = 4;
const READ_PATH_UNAVAILABLE = 'read_failed';

type ReadService = typeof import('@/services/repositories/dailyRecordClinicalDerivedReadService');

const loadReadService = (): Promise<ReadService | null> =>
  import('@/services/repositories/dailyRecordClinicalDerivedReadService').catch(() => null);

const readBackupDay = async (
  readService: ReadService | null,
  record: DailyRecord
): Promise<ClinicalDerivedBackupDay> => {
  if (!readService) return { status: 'unavailable', reason: READ_PATH_UNAVAILABLE };
  const result = await readService.readClinicalDerivedDayDocs(record);
  if (result.status === 'resolved') {
    return { status: 'exported', layoutGeneration: result.layoutGeneration, docs: result.docs };
  }
  return {
    status: 'unavailable',
    reason: result.status === 'unavailable' ? result.reason : 'unmarked',
  };
};

/**
 * The section for these records, or `undefined` when none is marked: then nothing is loaded or
 * read and the backup keeps its previous shape.
 */
export const buildClinicalDerivedBackupSection = async (
  records: readonly DailyRecord[]
): Promise<ClinicalDerivedBackupSection | undefined> => {
  const marked = records.filter(record => record.clinicalDerivedLayout != null);
  if (marked.length === 0) return undefined;
  const readService = await loadReadService();
  const byDate = new Map<string, ClinicalDerivedBackupDay>();
  const pending = [...marked];
  const worker = async () => {
    for (let record = pending.shift(); record; record = pending.shift()) {
      byDate.set(record.date, await readBackupDay(readService, record));
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, pending.length) }, worker));
  return Object.fromEntries([...byDate].sort(([left], [right]) => left.localeCompare(right)));
};

/**
 * A day the backup's section has no entry for. The export writes one for every marked day (same
 * test as `buildClinicalDerivedBackupSection`), so a marked day without it comes from a file that
 * does not say where its per-episode data was: incomplete, never a day without such data.
 */
export const restoreWithoutSectionEntry = (record: DailyRecord): ClinicalDerivedDayRestore =>
  record.clinicalDerivedLayout != null ? { kind: 'incomplete', record } : { kind: 'absent' };

/**
 * The restore of each day of a backup whose file carries `section`. The restore loads on demand,
 * only when the section has entries; if it cannot, a day the section covers comes back
 * `incomplete`, never as a day without per-episode data.
 */
export const loadClinicalDerivedDayRestore = async (
  section: unknown
): Promise<(record: DailyRecord) => ClinicalDerivedDayRestore> => {
  const entries = isPlainObject(section) ? section : {};
  const restoreDay =
    Object.keys(entries).length === 0
      ? null
      : await import('@/services/exporters/clinicalDerivedBackupRestore')
          .then(module => module.restoreClinicalDerivedBackupDay)
          .catch(() => null);
  return record => {
    if (entries[record.date] === undefined) return restoreWithoutSectionEntry(record);
    return restoreDay ? restoreDay(record, entries) : { kind: 'incomplete', record };
  };
};

/**
 * Whether the server holds what `restore` embedded, once its save reached the server
 * (`savedRemotely`; until then nothing is read). The day is read back from the server with the
 * episode documents of its current generation, in one coherent read: on a stored split day the
 * server keeps their values instead of the embedded ones, and another writer may recreate the day
 * after the save. A read that fails, a day that changed while it was read or no longer exists, or
 * a day that does not hold every restored episode's values, is not a confirmation.
 */
export const confirmClinicalDerivedDayRestore = async (
  restore: EmbeddedDayRestore,
  { savedRemotely }: { savedRemotely: boolean }
): Promise<boolean> => {
  if (!restore.needsConfirmation) return true;
  if (!savedRemotely) return false;
  const readService = await loadReadService();
  const read = await readService?.readClinicalDerivedDaySnapshot(restore.record.date);
  return read?.status === 'resolved' && restore.isKeptBy(read.day, read.docs);
};

/**
 * The warning of a backup whose section lists unreadable days: the file is still written, but it
 * is not a complete recovery copy of those days. `undefined` when every marked day was exported.
 */
export const describeIncompleteClinicalDerivedBackup = (
  section: ClinicalDerivedBackupSection | undefined
): ApplicationIssue | undefined => {
  const dates = Object.entries(section ?? {})
    .filter(([, backupDay]) => backupDay.status === 'unavailable')
    .map(([date]) => date);
  if (dates.length === 0) return undefined;
  const userSafeMessage =
    `El respaldo se generó sin los datos clínicos por episodio de ${dates.length} ` +
    `${dates.length === 1 ? 'día' : 'días'} (${dates.join(', ')}). ` +
    'Vuelve a exportarlo con conexión al servidor.';
  return {
    kind: 'unknown',
    code: 'clinical_derived_backup_incomplete',
    message: `clinicalDerived backup section incomplete for ${dates.join(', ')}`,
    userSafeMessage,
    severity: 'warning',
    retryable: true,
  };
};
