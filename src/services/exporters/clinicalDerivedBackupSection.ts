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
