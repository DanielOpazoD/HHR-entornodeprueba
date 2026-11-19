import { createScopedLoggerMap } from '@/services/utils/loggerScope';

export const { censusMasterExportLogger, excelFileDownloadLogger, jsonImportLogger } =
  createScopedLoggerMap({
    censusMasterExportLogger: 'CensusMasterExport',
    excelFileDownloadLogger: 'ExcelFileDownload',
    jsonImportLogger: 'JsonImport',
  });
