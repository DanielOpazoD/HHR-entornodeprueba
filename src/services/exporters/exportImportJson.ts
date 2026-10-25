import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import {
  getRecordForDateStrict,
  saveRecordsStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { hasStructuralRepairs, parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';
import { withStoredIdentity } from '@/shared/census/patientIdentityReview';
import { CLINICAL_DERIVED_BACKUP_SECTION } from '@/services/storage/clinicalDerivedConstants';
import { jsonImportLogger } from '@/services/exporters/exporterLoggers';
import { isClinicalDerivedLayoutRegression } from '@/services/storage/clinicalDerivedImportGuard';
import { loadClinicalDerivedDayRestore } from '@/services/exporters/clinicalDerivedBackupSection';

export interface JsonImportResult {
  success: boolean;
  outcome: 'clean' | 'repaired' | 'partial' | 'blocked';
  importedCount: number;
  repairedCount: number;
  skippedEntries: string[];
  /**
   * Imported split days whose per-episode data (vitals history, Rayen checkpoint) did not come
   * back; such an import is `partial`. Absent when there are none.
   */
  clinicalDerivedIncompleteDates?: string[];
}

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve((event.target?.result as string) || '');
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });

const persistImportedRecords = async (records: DailyRecord[]): Promise<boolean> => {
  const result = await saveRecordsStrict(records);
  if (!result.ok) {
    jsonImportLogger.error('JSON import local persistence failed', result.error);
    return false;
  }

  return true;
};

const parseImportPayload = (text: string): Record<string, unknown> => {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('El archivo JSON debe contener un objeto de registros por fecha.');
  }
  return parsed as Record<string, unknown>;
};

export const importDataJSONDetailed = async (file: File): Promise<JsonImportResult> => {
  try {
    const text = await readFileAsText(file);
    const payload = parseImportPayload(text);

    const importedRecords: DailyRecord[] = [];
    const skippedEntries: string[] = [];
    let repairedCount = 0;
    const clinicalDerivedSection = payload[CLINICAL_DERIVED_BACKUP_SECTION];

    Object.entries(payload).forEach(([key, value]) => {
      // The episode documents of split days are not a day: they go back into their days below.
      if (key === CLINICAL_DERIVED_BACKUP_SECTION) return;
      try {
        // A file holds the day as this client read it: a review gives back what storage held.
        const parsed = parseDailyRecordWithDefaultsReport(withStoredIdentity(value), key);
        importedRecords.push(parsed.record);

        if (hasStructuralRepairs(parsed.report)) {
          repairedCount += 1;
        }
      } catch (_error) {
        skippedEntries.push(key);
      }
    });

    // A local split day is never replaced by a copy that is not newer and lost (or changed) its
    // marker (D10). Such a date, or one whose local copy cannot be read, is reported as skipped.
    const acceptedRecords: DailyRecord[] = [];
    for (const record of importedRecords) {
      const local = await getRecordForDateStrict(record.date).catch((error: unknown) => {
        jsonImportLogger.warn(`JSON import could not read the local day ${record.date}`, error);
        return undefined;
      });
      if (local === undefined || isClinicalDerivedLayoutRegression(local, record)) {
        skippedEntries.push(record.date);
      } else {
        acceptedRecords.push(record);
      }
    }

    if (acceptedRecords.length === 0) {
      // No raw alert here: the caller (executeImportJsonBackup +
      // UI consumer) already presents the failure via useNotification
      // based on the outcome contract below.
      return {
        success: false,
        outcome: 'blocked',
        importedCount: 0,
        repairedCount: 0,
        skippedEntries,
      };
    }

    // Each split day gets its episodes' vitals history and Rayen checkpoint back, embedded where
    // each episode lives; only the server writes episode documents.
    const restoreClinicalDerivedDay = await loadClinicalDerivedDayRestore(clinicalDerivedSection);
    const clinicalDerivedIncompleteDates: string[] = [];
    const restoredRecords = acceptedRecords.map(record => {
      const restore = restoreClinicalDerivedDay(record);
      if (restore.kind === 'absent') return record;
      if (restore.kind === 'incomplete') clinicalDerivedIncompleteDates.push(record.date);
      return restore.record;
    });

    const persisted = await persistImportedRecords(restoredRecords);
    if (!persisted) {
      return {
        success: false,
        outcome: 'blocked',
        importedCount: 0,
        repairedCount: 0,
        skippedEntries,
      };
    }

    const outcome =
      skippedEntries.length > 0 || clinicalDerivedIncompleteDates.length > 0
        ? 'partial'
        : repairedCount > 0
          ? 'repaired'
          : 'clean';
    return {
      success: true,
      outcome,
      importedCount: acceptedRecords.length,
      repairedCount,
      skippedEntries,
      ...(clinicalDerivedIncompleteDates.length > 0 ? { clinicalDerivedIncompleteDates } : {}),
    };
  } catch (error) {
    jsonImportLogger.error('JSON import failed', error);
    // No raw alert: the caller maps this to ApplicationOutcome 'failed'
    // and presents the message through useNotification.
    return {
      success: false,
      outcome: 'blocked',
      importedCount: 0,
      repairedCount: 0,
      skippedEntries: [],
    };
  }
};

export const importDataJSON = async (file: File): Promise<boolean> => {
  const result = await importDataJSONDetailed(file);
  return result.success;
};
