import { useCallback } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useNotification } from '@/context/UIContext';
import {
  prepareRecordExport,
  type ExportReadiness,
} from '@/hooks/controllers/exportReadinessController';
import { createScopedLogger } from '@/services/utils/loggerScope';

const censusMasterExportFlowLogger = createScopedLogger('CensusMasterExportFlow');

const loadCensusMasterExcelExporter = async () =>
  import('@/services/exporters/censusMasterExport').then(
    module => module.generateCensusMasterExcel
  );

interface UseCensusMasterExcelExportParams {
  currentDateString: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  flushBeforeExport: () => Promise<ExportReadiness>;
  readRecord: () => DailyRecord | null;
}

export const useCensusMasterExcelExport = ({
  currentDateString,
  selectedYear,
  selectedMonth,
  selectedDay,
  flushBeforeExport,
  readRecord,
}: UseCensusMasterExcelExportParams): (() => Promise<void>) => {
  const { error: notifyError, info: notifyInfo, warning } = useNotification();

  return useCallback(async () => {
    const prepared = await prepareRecordExport({
      expectedDate: currentDateString,
      flushBeforeExport,
      readRecord,
      warning,
      allowEmptyRecord: true,
    });
    if (!prepared) return;
    const generateCensusMasterExcel = await loadCensusMasterExcelExporter();
    const result = await generateCensusMasterExcel(selectedYear, selectedMonth, selectedDay);
    if (result.outcome === 'no_data') {
      notifyInfo('Sin datos para exportar', result.userSafeMessage);
      return;
    }
    if (result.outcome === 'failed') {
      censusMasterExportFlowLogger.error(`Census master export failed: ${result.reason}`);
      notifyError('No se pudo exportar el censo', result.userSafeMessage);
    }
  }, [
    currentDateString,
    flushBeforeExport,
    notifyError,
    notifyInfo,
    readRecord,
    selectedDay,
    selectedMonth,
    selectedYear,
    warning,
  ]);
};
