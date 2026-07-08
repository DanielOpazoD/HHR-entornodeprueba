import React from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useCensusEmail } from '@/hooks/useCensusEmail';
import { useClinicalToday } from '@/hooks/useClinicalToday';
import { useStaleDayEditGuard } from '@/hooks/useStaleDayEditGuard';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import { useExistingDaysQuery } from '@/hooks/useExistingDaysQuery';
import { useFileOperations } from '@/hooks/useFileOperations';
import { resolveCensusDateSelection } from '@/components/layout/app-content/appContentCensusDateController';
import type { UseAppStateReturn } from '@/hooks/useAppState';
import type { UseCensusEmailReturn } from '@/hooks/useCensusEmail';
import type { UseFileOperationsReturn } from '@/hooks/useFileOperations';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { resolveShiftNurseSignature } from '@/services/staff/dailyRecordStaffing';
import type { AuthContextType } from '@/context/AuthContext';
import type { CensusContextType } from '@/context/CensusContext';
import type { AppAuthenticatedDateNavigation } from '@/app-shell/bootstrap/useAppBootstrapState';
import { markPerf } from '@/shared/runtime/perfAudit';
export interface AuthenticatedAppRuntime {
  dailyRecordHook: DailyRecordContextType;
  existingDaysInMonth: number[];
  nurseSignature: string;
  censusEmail: UseCensusEmailReturn;
  fileOps: UseFileOperationsReturn;
  ui: UseAppStateReturn;
  censusContextValue: CensusContextType;
}

interface UseAuthenticatedAppRuntimeParams {
  auth: AuthContextType;
  dateNav: AppAuthenticatedDateNavigation;
}

interface BuildCensusContextValueParams {
  dailyRecordHook: DailyRecordContextType;
  dateNav: AppAuthenticatedDateNavigation;
  existingDaysInMonth: number[];
  clinicalToday: string;
  goToClinicalToday: () => void;
  fileOps: UseFileOperationsReturn;
  censusEmail: UseCensusEmailReturn;
  nurseSignature: string;
}

interface BuildAuthenticatedAppRuntimeParams extends BuildCensusContextValueParams {
  ui: UseAppStateReturn;
}

export const resolveExistingDaysInMonth = (data: number[] | undefined): number[] => data ?? [];

export const buildAuthenticatedCensusContextValue = ({
  dailyRecordHook,
  dateNav,
  existingDaysInMonth,
  clinicalToday,
  goToClinicalToday,
  fileOps,
  censusEmail,
  nurseSignature,
}: BuildCensusContextValueParams): CensusContextType => ({
  dailyRecord: dailyRecordHook,
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
  nurseSignature,
  ui,
}: BuildAuthenticatedAppRuntimeParams): AuthenticatedAppRuntime => ({
  dailyRecordHook,
  existingDaysInMonth,
  nurseSignature,
  censusEmail,
  fileOps,
  ui,
  censusContextValue: buildAuthenticatedCensusContextValue({
    dailyRecordHook,
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
  const ui = useAppState();
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
    false,
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

  const censusEmail = useCensusEmail({
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
        nurseSignature,
        ui,
      }),
    [
      censusEmail,
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
