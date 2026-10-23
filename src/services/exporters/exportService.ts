import { getAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import { downloadBlob } from '@/services/exporters/exportDownload';
import { buildDailyRecordCsv } from '@/services/exporters/exportCsvSerialization';
import {
  buildClinicalDerivedBackupSection,
  describeIncompleteClinicalDerivedBackup,
} from '@/services/exporters/clinicalDerivedBackupSection';
import { CLINICAL_DERIVED_BACKUP_SECTION } from '@/services/storage/clinicalDerivedConstants';
import {
  importDataJSON as importDataJSONFile,
  importDataJSONDetailed as importDataJSONDetailedFile,
  JsonImportResult,
} from '@/services/exporters/exportImportJson';
import type {
  DailyRecordCsvExportState,
  DailyRecordDateRef,
} from '@/services/contracts/dailyRecordServiceContracts';
import {
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import { exportServiceLogger } from '@/services/exporters/exporterLoggers';
import { getTodayISO } from '@/utils/dateCoreUtils';

export const exportDataJSON = async () => {
  const result = await exportDataJSONWithResult();
  if (result.status !== 'success') {
    return;
  }
};

export const exportDataJSONWithResult = async (): Promise<
  ApplicationOutcome<{ exported: boolean }>
> => {
  const data = await getAllRecords();
  const clinicalDerived = await buildClinicalDerivedBackupSection(Object.values(data));
  const jsonString = JSON.stringify(
    clinicalDerived ? { ...data, [CLINICAL_DERIVED_BACKUP_SECTION]: clinicalDerived } : data,
    null,
    2
  );
  const blob = new Blob([jsonString], { type: 'application/json' });
  downloadBlob(blob, `hanga_roa_respaldo_${getTodayISO()}.json`);
  // A split day whose episode documents could not be read is flagged in the file and here.
  const incomplete = describeIncompleteClinicalDerivedBackup(clinicalDerived);
  return incomplete
    ? createApplicationPartial({ exported: true }, [incomplete], {
        userSafeMessage: incomplete.userSafeMessage,
        severity: 'warning',
      })
    : createApplicationSuccess({ exported: true });
};

type DailyRecordCsvExportInput = DailyRecordCsvExportState & DailyRecordDateRef;

export const exportDataCSV = (record: DailyRecordCsvExportInput | null) => {
  const result = exportDataCSVWithResult(record);
  if (result.status !== 'success') {
    return;
  }
};

export const exportDataCSVWithResult = (
  record: DailyRecordCsvExportInput | null
): ApplicationOutcome<{ exported: boolean }> => {
  if (!record) {
    return createApplicationFailed({ exported: false }, [
      {
        kind: 'validation',
        message: 'No hay datos del censo para exportar.',
        userSafeMessage: 'No hay datos del censo para exportar.',
      },
    ]);
  }
  const csvString = buildDailyRecordCsv(record);
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Censo_HangaRoa_${record.date}.csv`);
  return createApplicationSuccess({ exported: true });
};

export const importDataJSON = async (file: File): Promise<boolean> => {
  const result = await importDataJSONWithResult(file);
  return result.status === 'success' ? result.data.imported : false;
};

export const importDataJSONDetailed = async (file: File): Promise<JsonImportResult> => {
  return importDataJSONDetailedFile(file);
};

export const importDataCSV = async (_file: File): Promise<boolean> => {
  const result = await importDataCSVWithResult(_file);
  return result.status === 'success' ? result.data.imported : false;
};

export const importDataJSONWithResult = async (
  file: File
): Promise<ApplicationOutcome<{ imported: boolean }>> => {
  try {
    const imported = await importDataJSONFile(file);
    if (!imported) {
      return createApplicationFailed({ imported: false }, [
        {
          kind: 'validation',
          message: 'No se pudo importar el respaldo JSON.',
          userSafeMessage: 'No se pudo importar el respaldo JSON.',
        },
      ]);
    }
    return createApplicationSuccess({ imported: true });
  } catch (error) {
    return createApplicationFailed({ imported: false }, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo importar el respaldo JSON.',
        userSafeMessage: 'No se pudo importar el respaldo JSON.',
      },
    ]);
  }
};

export const importDataCSVWithResult = async (
  _file: File
): Promise<ApplicationOutcome<{ imported: boolean }>> => {
  exportServiceLogger.warn('CSV import is not fully implemented. Use JSON.');
  return createApplicationFailed({ imported: false }, [
    {
      kind: 'validation',
      message: 'La importación CSV no está disponible. Usa JSON.',
      userSafeMessage: 'La importación CSV no está disponible. Usa JSON.',
    },
  ]);
};
