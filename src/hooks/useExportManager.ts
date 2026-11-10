import { useState, useCallback, useLayoutEffect, useRef } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';
import { useBackupArchiveStatus } from '@/hooks/useBackupArchiveStatus';
import {
  prepareRecordExport,
  type ExportReadiness,
} from '@/hooks/controllers/exportReadinessController';

const loadExportManagerActions = createCachedRuntimeLoader(
  () => import('@/hooks/controllers/exportManagerActionsRuntime')
);

export interface UseExportManagerProps {
  currentDateString: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  record: DailyRecord | null;
  currentModule: string;
  selectedShift: 'day' | 'night';
  canVerifyArchiveStatus?: boolean;
  flushBeforeExport?: () => Promise<ExportReadiness>;
  getStableRecordForExport?: () => DailyRecord | null;
}

export interface UseExportManagerReturn {
  isArchived: boolean;
  isBackingUp: boolean;
  handleExportPDF: () => Promise<void>;
  handlePrintWithBrowserOptions: () => Promise<void>;
  handleBackupExcel: () => Promise<void>;
  handleBackupHandoff: (skipConfirmation?: boolean) => Promise<void>;
}

export const useExportManager = ({
  currentDateString,
  selectedYear,
  selectedMonth,
  selectedDay,
  record,
  currentModule,
  selectedShift,
  canVerifyArchiveStatus = false,
  flushBeforeExport,
  getStableRecordForExport,
}: UseExportManagerProps): UseExportManagerReturn => {
  const { success, error: notifyError, warning } = useNotification();
  const { confirm } = useConfirmDialog();
  const currentRecordRef = useRef({ date: currentDateString, record });
  useLayoutEffect(() => {
    currentRecordRef.current = { date: currentDateString, record };
    return () => {
      currentRecordRef.current = { date: '', record: null };
    };
  }, [currentDateString, record]);

  const [isBackingUp, setIsBackingUp] = useState(false);
  const { isArchived, setIsArchived } = useBackupArchiveStatus({
    currentDateString,
    currentModule,
    selectedShift,
    canVerifyArchiveStatus,
    warning,
    error: notifyError,
  });
  const prepare = useCallback(
    () =>
      prepareRecordExport({
        expectedDate: currentDateString,
        flushBeforeExport,
        readRecord: () =>
          getStableRecordForExport ? getStableRecordForExport() : currentRecordRef.current.record,
        readDate: () => currentRecordRef.current.date,
        warning,
      }),
    [currentDateString, flushBeforeExport, getStableRecordForExport, warning]
  );

  const runAction = useCallback(
    async (
      action:
        | 'handleExportPDF'
        | 'handlePrintWithBrowserOptions'
        | 'handleBackupExcel'
        | 'handleBackupHandoff',
      skipConfirmation?: boolean
    ) => {
      if (action === 'handleBackupExcel') setIsBackingUp(true);
      let runtime: Awaited<ReturnType<typeof loadExportManagerActions>>;
      try {
        runtime = await loadExportManagerActions();
      } catch {
        if (action === 'handleBackupExcel') setIsBackingUp(false);
        notifyError(
          'No se pudo cargar la exportación',
          'Vuelve a intentar la acción. No se generó ni guardó ningún archivo.'
        );
        return;
      }
      const actions = runtime.createExportManagerActions({
        currentDateString,
        selectedYear,
        selectedMonth,
        selectedDay,
        record,
        currentModule,
        selectedShift,
        getStableRecordForExport,
        prepare,
        isArchived,
        setIsArchived,
        setIsBackingUp,
        success,
        warning,
        notifyError,
        confirm,
      });
      await actions[action](skipConfirmation);
    },
    [
      currentDateString,
      selectedYear,
      selectedMonth,
      selectedDay,
      record,
      currentModule,
      selectedShift,
      getStableRecordForExport,
      prepare,
      isArchived,
      setIsArchived,
      success,
      warning,
      notifyError,
      confirm,
    ]
  );
  const handleExportPDF = useCallback(() => runAction('handleExportPDF'), [runAction]);
  const handlePrintWithBrowserOptions = useCallback(
    () => runAction('handlePrintWithBrowserOptions'),
    [runAction]
  );
  const handleBackupExcel = useCallback(() => runAction('handleBackupExcel'), [runAction]);
  const handleBackupHandoff = useCallback(
    (skipConfirmation = false) => runAction('handleBackupHandoff', skipConfirmation),
    [runAction]
  );

  return {
    isArchived,
    isBackingUp,
    handleExportPDF,
    handlePrintWithBrowserOptions,
    handleBackupExcel,
    handleBackupHandoff,
  };
};
