import React from 'react';
import type { AuthContextType } from '@/context/AuthContext';
import type { CensusContextType } from '@/context/CensusContext';
import { useCensusContext } from '@/context/CensusContext';
import { useAuth } from '@/context/AuthContext';
import { useDailyRecordData, useDailyRecordSync } from '@/context/DailyRecordContext';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { useExportManager, type UseExportManagerReturn } from '@/hooks/useExportManager';
import { useCensusMasterExcelExport } from '@/hooks/useCensusMasterExcelExport';
import { waitForExportReadiness } from '@/hooks/controllers/exportReadinessController';
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

export interface AppContentRuntime {
  auth: AuthContextType;
  record: DailyRecordContextType['record'];
  syncStatus: DailyRecordContextType['syncStatus'];
  lastSyncTime: DailyRecordContextType['lastSyncTime'];
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
  record: DailyRecordContextType['record'],
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

export const useAppContentRuntime = ({ ui }: UseAppContentRuntimeParams): AppContentRuntime => {
  const { dateNav, censusEmail, fileOps, nurseSignature } = useCensusContext();
  const { record } = useDailyRecordData();
  const { syncStatus, hasSaveException, lastSyncTime } = useDailyRecordSync();
  const auth = useAuth();
  const syncStatusRef = React.useRef({ syncStatus, hasSaveException });
  const recordRef = React.useRef(record);
  const selectedDateRef = React.useRef(dateNav.currentDateString);
  React.useEffect(() => {
    selectedDateRef.current = dateNav.currentDateString;
  }, [dateNav.currentDateString]);

  React.useEffect(() => {
    syncStatusRef.current = { syncStatus, hasSaveException };
  }, [syncStatus, hasSaveException]);

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

    return waitForExportReadiness({
      expectedDate: dateNav.currentDateString,
      readState: () => ({
        selectedDate: selectedDateRef.current,
        recordDate: recordRef.current?.date,
        ...syncStatusRef.current,
      }),
      now: Date.now,
      wait,
    });
  }, [dateNav.currentDateString]);

  const readRecord = React.useCallback(() => recordRef.current, []);

  const exportManager = useExportManager(
    React.useMemo(
      () => ({
        ...resolveExportManagerParams(dateNav, ui, record, canVerifyArchiveStatus),
        flushBeforeExport,
        getStableRecordForExport: readRecord,
      }),
      [canVerifyArchiveStatus, dateNav, flushBeforeExport, readRecord, record, ui]
    )
  );

  const handleExportExcel = useCensusMasterExcelExport({
    currentDateString: dateNav.currentDateString,
    selectedYear: dateNav.selectedYear,
    selectedMonth: dateNav.selectedMonth,
    selectedDay: dateNav.selectedDay,
    flushBeforeExport,
    readRecord,
  });

  return React.useMemo(
    () => ({
      auth,
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
