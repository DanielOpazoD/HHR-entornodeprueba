import { useEffect, useState } from 'react';
import { useAuth } from '@/context';
import { useDailyRecordSync } from '@/context/DailyRecordContext';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { useCensusMigrationBootstrap } from './useCensusMigrationBootstrap';
import { useCensusViewRouteModel } from './useCensusViewRouteModel';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import { resolveCensusEmptyStateDiagnostic } from '@/features/census/controllers/censusEmptyStateDiagnostic';
import { resolveCensusDayView } from '@/features/census/controllers/censusViewController';
import { readPostDeployRecentRecordRefreshMarker } from '@/services/config/postDeployRecentRecordRefresh';
import type { RenderCensusMedicalHandoffAction } from '../contracts/censusMedicalHandoffAction';

interface UseCensusViewScreenModelParams {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  renderMedicalHandoffAction?: RenderCensusMedicalHandoffAction;
  readOnly: boolean;
  accessProfile: CensusAccessProfile;
}

export const useCensusViewScreenModel = ({
  selectedDay,
  selectedMonth,
  currentDateString,
  showBedManagerModal,
  onCloseBedManagerModal,
  renderMedicalHandoffAction,
  readOnly,
  accessProfile,
}: UseCensusViewScreenModelParams) => {
  const auth = useAuth();
  const { bootstrapPhase } = useDailyRecordSync();
  const [hasPostDeployRefreshMarker, setHasPostDeployRefreshMarker] = useState(false);
  const routeModel = useCensusViewRouteModel({
    selectedDay,
    selectedMonth,
    currentDateString,
    showBedManagerModal,
    onCloseBedManagerModal,
    renderMedicalHandoffAction,
    readOnly,
    accessProfile,
  });
  // Absence is a repository result, never a grace-period deadline.
  const effectiveBootstrapPhase =
    auth.remoteSyncStatus === 'bootstrapping' ? 'remote_runtime_bootstrapping' : bootstrapPhase;
  const emptyStateDiagnostic = resolveCensusEmptyStateDiagnostic({
    branch: routeModel.branch,
    currentDateString,
    todayDateString: getTodayISO(),
    isAuthenticated: auth.isAuthenticated,
    bootstrapPhase: effectiveBootstrapPhase,
    hasPostDeployRefreshMarker,
  });

  useCensusMigrationBootstrap();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage marker is a browser-side deploy signal, not derivable during SSR-safe render
    setHasPostDeployRefreshMarker(Boolean(readPostDeployRecentRecordRefreshMarker()));
  }, [currentDateString]);

  return {
    dayView: resolveCensusDayView({
      registerContentProps: routeModel.registerContentProps,
      emptyDayPromptProps: routeModel.emptyDayPromptProps
        ? { ...routeModel.emptyDayPromptProps, emptyStateDiagnostic }
        : null,
      remoteSyncStatus: auth.remoteSyncStatus,
      bootstrapPhase,
    }),
  };
};
