import React from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useDeferredCensusEmail } from '@/app-shell/runtime/useDeferredCensusEmail';
import { useClinicalToday } from '@/hooks/useClinicalToday';
import { useStaleDayEditGuard } from '@/hooks/useStaleDayEditGuard';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import { useExistingDaysQuery } from '@/hooks/useExistingDaysQuery';
import { useFileOperations } from '@/hooks/useFileOperations';
import { resolveCensusDateSelection } from '@/components/layout/app-content/appContentCensusDateController';
import type { UseAppStateReturn } from '@/hooks/useAppState';
import type { UseCensusEmailReturn } from '@/context/CensusContext';
import type { UseFileOperationsReturn } from '@/hooks/useFileOperations';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { resolveShiftNurseSignature } from '@/services/staff/dailyRecordStaffing';
import type { AuthContextType } from '@/context/AuthContext';
import type { CensusContextType } from '@/context/CensusContext';
import type { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { markPerf } from '@/shared/runtime/perfAudit';
import { startDailyActionTiming } from '@/services/observability/dailyActionTiming';
export interface AuthenticatedAppRuntime {
  dailyRecordHook: DailyRecordContextType;
  existingDaysInMonth: number[];
  nurseSignature: string;
  censusEmail: UseCensusEmailReturn;
  censusEmailBridge?: React.ReactNode;
  fileOps: UseFileOperationsReturn;
  ui: UseAppStateReturn;
  censusContextValue: CensusContextType;
}

interface UseAuthenticatedAppRuntimeParams {
  auth: AuthContextType;
  dateNav: UseDateNavigationReturn;
}

interface BuildCensusContextValueParams {
  dateNav: UseDateNavigationReturn;
  existingDaysInMonth: number[];
  clinicalToday: string;
  goToClinicalToday: () => void;
  fileOps: UseFileOperationsReturn;
  censusEmail: UseCensusEmailReturn;
  nurseSignature: string;
}

interface BuildAuthenticatedAppRuntimeParams extends BuildCensusContextValueParams {
  dailyRecordHook: DailyRecordContextType;
  ui: UseAppStateReturn;
  censusContextValue?: CensusContextType;
  censusEmailBridge?: React.ReactNode;
}

export const resolveExistingDaysInMonth = (data: number[] | undefined): number[] => data ?? [];

export const buildAuthenticatedCensusContextValue = ({
  dateNav,
  existingDaysInMonth,
  clinicalToday,
  goToClinicalToday,
  fileOps,
  censusEmail,
  nurseSignature,
}: BuildCensusContextValueParams): CensusContextType => ({
  dateNav: {
    ...dateNav,
    existingDaysInMonth,
    clinicalToday,
    goToClinicalToday,
  },
  fileOps,
  censusEmail,
  nurseSignature,
});

export const buildAuthenticatedAppRuntime = ({
  dailyRecordHook,
  dateNav,
  existingDaysInMonth,
  clinicalToday,
  goToClinicalToday,
  fileOps,
  censusEmail,
  censusEmailBridge,
  nurseSignature,
  ui,
  censusContextValue,
}: BuildAuthenticatedAppRuntimeParams): AuthenticatedAppRuntime => ({
  dailyRecordHook,
  existingDaysInMonth,
  nurseSignature,
  censusEmail,
  ...(censusEmailBridge !== undefined ? { censusEmailBridge } : {}),
  fileOps,
  ui,
  censusContextValue:
    censusContextValue ??
    buildAuthenticatedCensusContextValue({
      dateNav,
      existingDaysInMonth,
      clinicalToday,
      goToClinicalToday,
      fileOps,
      censusEmail,
      nurseSignature,
    }),
});

export const useAuthenticatedAppRuntime = ({
  auth,
  dateNav,
}: UseAuthenticatedAppRuntimeParams): AuthenticatedAppRuntime => {
  const ui = useAppState({ date: dateNav.currentDateString });
  // Daily-action timing lives as long as this session's app; leaving it drops the open window.
  React.useEffect(() => startDailyActionTiming(), []);
  const clinicalToday = useClinicalToday();
  const { setSelectedYear, setSelectedMonth, setSelectedDay } = dateNav;
  const goToClinicalToday = React.useCallback(() => {
    const selection = resolveCensusDateSelection(clinicalToday);
    if (!selection) return;
    setSelectedYear(selection.year);
    setSelectedMonth(selection.month);
    setSelectedDay(selection.day);
  }, [clinicalToday, setSelectedYear, setSelectedMonth, setSelectedDay]);
  const shouldRunCensusRuntimeExtras = ui.currentModule === 'CENSUS';
  // Built here (inside the UI + audit providers) and injected down so the bed
  // dispatcher can confirm/audit edits to a previous day without coupling the
  // lower-level record hooks to those providers.
  const ensureStaleDayEditAllowed = useStaleDayEditGuard(clinicalToday);
  const dailyRecordHook = useDailyRecord(
    dateNav.currentDateString,
    auth.remoteSyncStatus,
    ensureStaleDayEditAllowed
  );
  const { record } = dailyRecordHook;

  const { data } = useExistingDaysQuery(dateNav.selectedYear, dateNav.selectedMonth, {
    enabled: shouldRunCensusRuntimeExtras,
  });
  React.useEffect(() => {
    if (shouldRunCensusRuntimeExtras && data) {
      markPerf('existing-days:ready', `${dateNav.selectedYear}-${dateNav.selectedMonth + 1}`);
    }
  }, [data, dateNav.selectedMonth, dateNav.selectedYear, shouldRunCensusRuntimeExtras]);

  const existingDaysInMonth = React.useMemo(() => resolveExistingDaysInMonth(data), [data]);

  const nurseSignature = React.useMemo(() => resolveShiftNurseSignature(record, 'night'), [record]);

  const { censusEmail, censusEmailBridge } = useDeferredCensusEmail({
    record,
    currentDateString: dateNav.currentDateString,
    nurseSignature,
    selectedYear: dateNav.selectedYear,
    selectedMonth: dateNav.selectedMonth,
    selectedDay: dateNav.selectedDay,
    user: auth.currentUser,
    role: auth.role,
    enabled: shouldRunCensusRuntimeExtras,
  });

  const fileOps = useFileOperations(record, dailyRecordHook.refresh);

  // Memoize CensusContext independently of dailyRecordHook so bed edits only notify
  // DailyRecordContext slice subscribers, not shell/fileOps/dateNav consumers.
  const censusContextValue = React.useMemo(
    () =>
      buildAuthenticatedCensusContextValue({
        dateNav,
        existingDaysInMonth,
        clinicalToday,
        goToClinicalToday,
        fileOps,
        censusEmail,
        nurseSignature,
      }),
    [
      censusEmail,
      clinicalToday,
      dateNav,
      existingDaysInMonth,
      fileOps,
      goToClinicalToday,
      nurseSignature,
    ]
  );

  return React.useMemo(
    () =>
      buildAuthenticatedAppRuntime({
        dailyRecordHook,
        dateNav,
        existingDaysInMonth,
        clinicalToday,
        goToClinicalToday,
        fileOps,
        censusEmail,
        censusEmailBridge,
        nurseSignature,
        ui,
        censusContextValue,
      }),
    [
      censusContextValue,
      censusEmail,
      censusEmailBridge,
      clinicalToday,
      dailyRecordHook,
      dateNav,
      existingDaysInMonth,
      fileOps,
      goToClinicalToday,
      nurseSignature,
      ui,
    ]
  );
};
