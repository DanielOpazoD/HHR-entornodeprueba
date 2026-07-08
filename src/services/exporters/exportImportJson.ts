import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import { saveRecordsStrict } from '@/services/storage/indexeddb/indexedDbRecordService';
import { hasStructuralRepairs, parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';
import { jsonImportLogger } from '@/services/exporters/exporterLoggers';

export interface JsonImportResult {
  success: boolean;
  outcome: 'clean' | 'repaired' | 'partial' | 'blocked';
  importedCount: number;
  repairedCount: number;
  skippedEntries: string[];
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

    Object.entries(payload).forEach(([key, value]) => {
      try {
        const parsed = parseDailyRecordWithDefaultsReport(value, key);
        importedRecords.push(parsed.record);

        if (hasStructuralRepairs(parsed.report)) {
          repairedCount += 1;
        }
      } catch (_error) {
        skippedEntries.push(key);
      }
    });

    if (importedRecords.length === 0) {
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

    const persisted = await persistImportedRecords(importedRecords);
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
      skippedEntries.length > 0 ? 'partial' : repairedCount > 0 ? 'repaired' : 'clean';
    return {
      success: true,
      outcome,
      importedCount: importedRecords.length,
      repairedCount,
      skippedEntries,
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
