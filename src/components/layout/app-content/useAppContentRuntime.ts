import React from 'react';
import type { AuthContextType } from '@/context/AuthContext';
import type { CensusContextType } from '@/context/CensusContext';
import { useCensusContext } from '@/context/CensusContext';
import { useAuth } from '@/context/AuthContext';
import { useNotification } from '@/context/UIContext';
import { useExportManager, type UseExportManagerReturn } from '@/hooks/useExportManager';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import {
  resolveSpecialistCapabilities,
  resolveSpecialistCensusAccessProfile,
  type SpecialistCapabilities,
} from '@/shared/access/specialistAccessPolicy';
import {
  canTriggerCensusExports,
  canVerifyPassiveBackupForRole,
} from '@/shared/access/operationalAccessPolicy';

const censusMasterExportFlowLogger = createScopedLogger('CensusMasterExportFlow');

const loadCensusMasterExcelExporter = async () =>
  import('@/services/exporters/censusMasterExport').then(
    module => module.generateCensusMasterExcel
  );

export interface AppContentRuntime {
  auth: AuthContextType;
  dailyRecordHook: CensusContextType['dailyRecord'];
  record: CensusContextType['dailyRecord']['record'];
  syncStatus: CensusContextType['dailyRecord']['syncStatus'];
  lastSyncTime: CensusContextType['dailyRecord']['lastSyncTime'];
  dateNav: CensusContextType['dateNav'];
  censusEmail: CensusContextType['censusEmail'];
  fileOps: CensusContextType['fileOps'];
  nurseSignature: CensusContextType['nurseSignature'];
  specialistCapabilities: SpecialistCapabilities;
  censusAccessProfile: ReturnType<typeof resolveSpecialistCensusAccessProfile>;
  canUseCensusExports: boolean;
  canVerifyArchiveStatus: boolean;
  exportManager: UseExportManagerReturn;
  handleExportExcel: () => Promise<void>;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface UseAppContentRuntimeParams {
  ui: UseUIStateReturn;
}

const resolveAppContentAccess = (role: AuthContextType['role'], currentModule: string) => {
  const censusAccessProfile = resolveSpecialistCensusAccessProfile(role);
  return {
    specialistCapabilities: resolveSpecialistCapabilities(role),
    censusAccessProfile,
    canUseCensusExports: canTriggerCensusExports({
      role,
      accessProfile: censusAccessProfile,
    }),
    canVerifyArchiveStatus: canVerifyPassiveBackupForRole(role, currentModule),
  };
};

const canVerifyArchiveStatusWithRuntime = (
  role: AuthContextType['role'],
  currentModule: string,
  remoteSyncStatus: AuthContextType['remoteSyncStatus']
): boolean => canVerifyPassiveBackupForRole(role, currentModule) && remoteSyncStatus === 'ready';

const resolveExportManagerParams = (
  dateNav: CensusContextType['dateNav'],
  ui: UseUIStateReturn,
  record: CensusContextType['dailyRecord']['record'],
  canVerifyArchiveStatus: boolean
) => ({
  currentDateString: dateNav.currentDateString,
  selectedYear: dateNav.selectedYear,
  selectedMonth: dateNav.selectedMonth,
  selectedDay: dateNav.selectedDay,
  record,
  currentModule: ui.currentModule,
  selectedShift: ui.selectedShift,
  canVerifyArchiveStatus,
});

const resolveExcelExportDateArgs = (dateNav: CensusContextType['dateNav']) =>
  [dateNav.selectedYear, dateNav.selectedMonth, dateNav.selectedDay] as const;

export const useAppContentRuntime = ({ ui }: UseAppContentRuntimeParams): AppContentRuntime => {
  const {
    dailyRecord: dailyRecordHook,
    dateNav,
    censusEmail,
    fileOps,
    nurseSignature,
  } = useCensusContext();
  const auth = useAuth();
  const { error: notifyError, info: notifyInfo } = useNotification();
  const { record, syncStatus, lastSyncTime } = dailyRecordHook;
  const syncStatusRef = React.useRef(syncStatus);
  const recordRef = React.useRef(record);
  const { currentDateString: _currentDateString } = dateNav;

  React.useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  React.useEffect(() => {
    recordRef.current = record;
  }, [record]);

  const { specialistCapabilities, censusAccessProfile, canUseCensusExports } = React.useMemo(
    () => resolveAppContentAccess(auth.role, ui.currentModule),
    [auth.role, ui.currentModule]
  );
  const canVerifyArchiveStatus = React.useMemo(
    () => canVerifyArchiveStatusWithRuntime(auth.role, ui.currentModule, auth.remoteSyncStatus),
    [auth.remoteSyncStatus, auth.role, ui.currentModule]
  );

  const flushBeforeExport = React.useCallback(async () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }

    const startedAt = Date.now();
    let observedSaving = syncStatusRef.current === 'saving';

    while (Date.now() - startedAt < 2500) {
      const currentStatus = syncStatusRef.current;
      if (currentStatus === 'saving') {
        observedSaving = true;
      }

      if (observedSaving && currentStatus !== 'saving') {
        break;
      }

      if (!observedSaving && currentStatus !== 'saving' && Date.now() - startedAt > 150) {
        break;
      }

      await wait(50);
    }
  }, []);

  const exportManager = useExportManager(
    React.useMemo(
      () => ({
        ...resolveExportManagerParams(dateNav, ui, record, canVerifyArchiveStatus),
        flushBeforeExport,
        getStableRecordForExport: () => recordRef.current,
      }),
      [canVerifyArchiveStatus, dateNav, flushBeforeExport, record, ui]
    )
  );

  const handleExportExcel = React.useCallback(async () => {
    await flushBeforeExport();
    const generateCensusMasterExcel = await loadCensusMasterExcelExporter();
    const result = await generateCensusMasterExcel(...resolveExcelExportDateArgs(dateNav));
    if (result.outcome === 'no_data') {
      notifyInfo('Sin datos para exportar', result.userSafeMessage);
      return;
    }
    if (result.outcome === 'failed') {
      censusMasterExportFlowLogger.error(`Census master export failed: ${result.reason}`);
      notifyError('No se pudo exportar el censo', result.userSafeMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dateNav is an unstable context object; tracking only its date parts keeps the callback stable
  }, [
    dateNav.selectedDay,
    dateNav.selectedMonth,
    dateNav.selectedYear,
    flushBeforeExport,
    notifyError,
    notifyInfo,
  ]);

  return React.useMemo(
    () => ({
      auth,
      dailyRecordHook,
      record,
      syncStatus,
      lastSyncTime,
      dateNav,
      censusEmail,
      fileOps,
      nurseSignature,
      specialistCapabilities,
      censusAccessProfile,
      canUseCensusExports,
      canVerifyArchiveStatus,
      exportManager,
      handleExportExcel,
    }),
    [
      auth,
      canUseCensusExports,
      canVerifyArchiveStatus,
      censusAccessProfile,
      censusEmail,
      dailyRecordHook,
      dateNav,
      exportManager,
      fileOps,
      handleExportExcel,
      lastSyncTime,
      nurseSignature,
      record,
      specialistCapabilities,
      syncStatus,
    ]
  );
};
