import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';

/**
 * JSON backups of split days (docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md, D10): the day
 * no longer holds each episode's moved fields, so the backup carries a `clinicalDerived` section
 * with the episode documents of every marked day, read from the server and keyed by date. A day
 * that could not be read is listed as `unavailable`, never left out. Importers skip the section:
 * only the server writes episode documents.
 */
export const CLINICAL_DERIVED_BACKUP_SECTION = 'clinicalDerived';

export type ClinicalDerivedBackupDay =
  | { status: 'exported'; layoutGeneration: string; docs: ClinicalDerivedEpisodeDoc[] }
  | { status: 'unavailable'; reason: string };

export type ClinicalDerivedBackupSection = Record<string, ClinicalDerivedBackupDay>;

const READ_CONCURRENCY = 4;
const READ_PATH_UNAVAILABLE = 'read_failed';

type DayDocsReader =
  typeof import('@/services/repositories/dailyRecordClinicalDerivedReadService').readClinicalDerivedDayDocs;

const readBackupDay = async (
  readDayDocs: DayDocsReader | null,
  record: DailyRecord
): Promise<ClinicalDerivedBackupDay> => {
  if (!readDayDocs) return { status: 'unavailable', reason: READ_PATH_UNAVAILABLE };
  const result = await readDayDocs(record);
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
  const readDayDocs = await import('@/services/repositories/dailyRecordClinicalDerivedReadService')
    .then(module => module.readClinicalDerivedDayDocs)
    .catch(() => null);
  const byDate = new Map<string, ClinicalDerivedBackupDay>();
  const pending = [...marked];
  const worker = async () => {
    for (let record = pending.shift(); record; record = pending.shift()) {
      byDate.set(record.date, await readBackupDay(readDayDocs, record));
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, pending.length) }, worker));
  return Object.fromEntries([...byDate].sort(([left], [right]) => left.localeCompare(right)));
};
