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
import type { RenderCensusMedicalHandoffAction } from '../contracts/censusMedicalHandoffAction';

interface UseCensusViewScreenModelParams {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  renderMedicalHandoffAction?: RenderCensusMedicalHandoffAction;
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
  renderMedicalHandoffAction,
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
    renderMedicalHandoffAction,
    readOnly,
    allowAdminCopyOverride,
    accessProfile,
  });
  const { shouldDeferEmptyState: shouldDeferTodayEmptyState, deferMs: emptyStateDeferMs } =
    resolveCensusEmptyStatePolicy({
      branch: routeModel.branch,
      currentDateString,
      todayDateString: getTodayISO(),
      isAuthenticated: auth.isAuthenticated,
      bootstrapPhase:
        auth.remoteSyncStatus === 'bootstrapping' ? 'remote_runtime_bootstrapping' : bootstrapPhase,
    });
  const emptyPolicyKey = `${currentDateString}:${shouldDeferTodayEmptyState}:${emptyStateDeferMs}`;
  const [emptyResolution, setEmptyResolution] = useState({ key: emptyPolicyKey, resolved: false });
  // Reset during render so revisiting a date cannot briefly reuse its old resolution.
  if (emptyResolution.key !== emptyPolicyKey) {
    setEmptyResolution({ key: emptyPolicyKey, resolved: false });
  }
  const resolvedTodayEmptyDate =
    emptyResolution.key === emptyPolicyKey && emptyResolution.resolved ? currentDateString : '';
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
      setEmptyResolution(previous =>
        previous.key === emptyPolicyKey ? { ...previous, resolved: true } : previous
      );
    }, emptyStateDeferMs);

    return () => window.clearTimeout(timeoutId);
  }, [emptyPolicyKey, emptyStateDeferMs, shouldDeferTodayEmptyState]);

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
