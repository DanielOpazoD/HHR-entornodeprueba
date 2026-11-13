import type { JsonImportResult } from '@/services/exporters/exportImportJson';
import type { BackupType } from '@/hooks/backupFileBrowserContracts';
import type { BaseStoredFile } from '@/services/backup/baseStorageService';
import type { StoredPdfFile } from '@/services/backup/pdfStorageService';
import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import {
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import { runMonthlyBackfill } from '@/services/backup/monthlyBackfillService';

export const executeImportJsonBackup = async (
  file: File
): Promise<ApplicationOutcome<JsonImportResult>> => {
  try {
    const result = await importDataJSONDetailed(file);
    if (!result.success) {
      return createApplicationFailed(result, [
        {
          kind: 'validation',
          message: result.pendingDates?.length
            ? `Hay cambios sin enviar en: ${result.pendingDates.join(', ')}. Reintente cuando sus envíos terminen.`
            : 'No se pudo importar el archivo JSON.',
        },
      ]);
    }
    if (result.outcome === 'partial' || result.outcome === 'repaired') {
      return createApplicationPartial(result, [
        {
          kind: 'unknown',
          message:
            result.outcome === 'partial'
              ? 'La importación se realizó parcialmente.'
              : 'La importación se realizó con reparaciones automáticas.',
        },
      ]);
    }
    return createApplicationSuccess(result);
  } catch (error) {
    return createApplicationFailed(
      {
        success: false,
        outcome: 'blocked',
        importedCount: 0,
        repairedCount: 0,
        skippedEntries: [],
      },
      [
        {
          kind: 'unknown',
          message: error instanceof Error ? error.message : 'Error al procesar el archivo JSON.',
        },
      ]
    );
  }
};

export interface RunMonthlyBackfillInput {
  backupType: BackupType;
  year: number;
  monthNumber: number;
  existingFiles: Array<BaseStoredFile | StoredPdfFile>;
  onProgress?: (progress: { completed: number; total: number; currentLabel?: string }) => void;
}

export const executeRunMonthlyBackfill = async (input: RunMonthlyBackfillInput) => {
  try {
    const result = await runMonthlyBackfill(input);
    if (result.totalPlanned === 0) {
      return createApplicationSuccess(result);
    }
    if (result.failed > 0) {
      return createApplicationPartial(result, [
        {
          kind: 'unknown',
          message: `${result.failed} respaldo(s) fallaron durante la ejecución masiva.`,
        },
      ]);
    }
    return createApplicationSuccess(result);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message:
          error instanceof Error ? error.message : 'Error al ejecutar respaldo masivo del mes',
      },
    ]);
  }
};
