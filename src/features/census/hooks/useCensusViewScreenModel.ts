import { useEffect, useState } from 'react';
import { useAuth } from '@/context';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { useCensusMigrationBootstrap } from './useCensusMigrationBootstrap';
import { useCensusViewRouteModel } from './useCensusViewRouteModel';
import type { CensusAccessProfile } from '../types/censusAccessProfile';
import {
  resolveCensusEmptyStateDiagnostic,
  resolveCensusEmptyStatePolicy,
} from '@/hooks/controllers/dailyRecordBootstrapController';
import { readPostDeployRecentRecordRefreshMarker } from '@/services/config/postDeployRecentRecordRefresh';

interface UseCensusViewScreenModelParams {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  onOpenMedicalHandoff?: () => void;
  readOnly: boolean;
  allowAdminCopyOverride: boolean;
  accessProfile: CensusAccessProfile;
}

export const useCensusViewScreenModel = ({
  selectedDay,
  selectedMonth,
  currentDateString,
  showBedManagerModal,
  onCloseBedManagerModal,
  onOpenMedicalHandoff,
  readOnly,
  allowAdminCopyOverride,
  accessProfile,
}: UseCensusViewScreenModelParams) => {
  const auth = useAuth();
  const { bootstrapPhase } = useDailyRecordData();
  const [hasPostDeployRefreshMarker, setHasPostDeployRefreshMarker] = useState(false);
  const routeModel = useCensusViewRouteModel({
    selectedDay,
    selectedMonth,
    currentDateString,
    showBedManagerModal,
    onCloseBedManagerModal,
    onOpenMedicalHandoff,
    readOnly,
    allowAdminCopyOverride,
    accessProfile,
  });
  const [resolvedTodayEmptyDate, setResolvedTodayEmptyDate] = useState('');
  const { shouldDeferEmptyState: shouldDeferTodayEmptyState, deferMs: emptyStateDeferMs } =
    resolveCensusEmptyStatePolicy({
      branch: routeModel.branch,
      currentDateString,
      todayDateString: getTodayISO(),
      isAuthenticated: auth.isAuthenticated,
      bootstrapPhase:
        auth.remoteSyncStatus === 'bootstrapping' ? 'remote_runtime_bootstrapping' : bootstrapPhase,
    });
  const emptyStateDiagnostic = resolveCensusEmptyStateDiagnostic({
    branch: routeModel.branch,
    currentDateString,
    todayDateString: getTodayISO(),
    isAuthenticated: auth.isAuthenticated,
    bootstrapPhase:
      auth.remoteSyncStatus === 'bootstrapping' ? 'remote_runtime_bootstrapping' : bootstrapPhase,
    hasPostDeployRefreshMarker,
  });

  useCensusMigrationBootstrap(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage marker is a browser-side deploy signal, not derivable during SSR-safe render
    setHasPostDeployRefreshMarker(Boolean(readPostDeployRecentRecordRefreshMarker()));
  }, [currentDateString]);

  useEffect(() => {
    if (!shouldDeferTodayEmptyState) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setResolvedTodayEmptyDate(currentDateString);
    }, emptyStateDeferMs);

    return () => window.clearTimeout(timeoutId);
  }, [currentDateString, emptyStateDeferMs, shouldDeferTodayEmptyState]);

  return {
    ...routeModel,
    emptyDayPromptProps: routeModel.emptyDayPromptProps
      ? {
          ...routeModel.emptyDayPromptProps,
          emptyStateDiagnostic,
        }
      : null,
    shouldDeferTodayEmptyState,
    resolvedTodayEmptyDate,
  };
};
