import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ViewLoader } from '@/components/ui/ViewLoader';
import { useDailyRecordStatus } from '@/context/DailyRecordContext';
import { useCensusViewScreenModel } from '@/features/census/hooks/useCensusViewScreenModel';
import { CensusOperationalStateBanner } from './CensusOperationalStateBanner';
import { CensusRegisterContent } from './CensusRegisterContent';
import { resolveCensusOperationalState } from '@/features/census/controllers/censusOperationalStateController';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type { RenderCensusMedicalHandoffAction } from '@/features/census/contracts/censusMedicalHandoffAction';

const LazyEmptyDayPrompt = lazy(() =>
  import('./EmptyDayPrompt').then(module => ({
    default: module.EmptyDayPrompt,
  }))
);

interface CensusViewProps {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  onOpenCensusDate?: (date: string) => void;
  renderMedicalHandoffAction?: RenderCensusMedicalHandoffAction;
  readOnly?: boolean;
  allowAdminCopyOverride?: boolean;
  accessProfile?: CensusAccessProfile;
}

const CensusViewContent: React.FC<CensusViewProps> = ({
  selectedDay,
  selectedMonth,
  currentDateString,
  showBedManagerModal,
  onCloseBedManagerModal,
  onOpenCensusDate: _onOpenCensusDate,
  renderMedicalHandoffAction,
  readOnly = false,
  allowAdminCopyOverride = false,
  accessProfile = 'default',
}) => {
  const {
    branch,
    emptyDayPromptProps,
    registerContentProps,
    shouldDeferTodayEmptyState,
    resolvedTodayEmptyDate,
  } = useCensusViewScreenModel({
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
  const dailyRecordStatus = useDailyRecordStatus();
  const rayenBootstrapSequenceRef = useRef(0);
  const [rayenBootstrapRequest, setRayenBootstrapRequest] = useState<{
    date: string;
    id: number;
  } | null>(null);
  const requestRayenBootstrap = (): void => {
    rayenBootstrapSequenceRef.current += 1;
    setRayenBootstrapRequest({ date: currentDateString, id: rayenBootstrapSequenceRef.current });
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a bootstrap intent belongs only to the date that created it
    setRayenBootstrapRequest(previous =>
      previous?.date && previous.date !== currentDateString ? null : previous
    );
  }, [currentDateString]);

  const isEmptyBranchPending =
    branch === 'empty' &&
    shouldDeferTodayEmptyState &&
    resolvedTodayEmptyDate !== currentDateString;
  const loadingOperationalState = resolveCensusOperationalState({
    branch,
    bootstrapPhase: isEmptyBranchPending
      ? 'remote_record_bootstrapping'
      : dailyRecordStatus.bootstrapPhase,
    syncStatus: dailyRecordStatus.syncStatus,
    hasRecord: Boolean(registerContentProps),
    isAuthenticated: true,
  });

  if (branch === 'empty') {
    if (isEmptyBranchPending) {
      return <CensusOperationalStateBanner state={loadingOperationalState} />;
    }

    return (
      <Suspense fallback={<ViewLoader />}>
        {emptyDayPromptProps ? (
          <LazyEmptyDayPrompt
            {...emptyDayPromptProps}
            onRayenBootstrapReady={requestRayenBootstrap}
          />
        ) : null}
      </Suspense>
    );
  }

  return (
    <div className="space-y-4">
      {registerContentProps ? (
        <CensusRegisterContent
          {...registerContentProps}
          rayenBootstrapRequestId={
            rayenBootstrapRequest?.date === currentDateString ? rayenBootstrapRequest.id : undefined
          }
          onRayenBootstrapHandled={() => setRayenBootstrapRequest(null)}
        />
      ) : null}
    </div>
  );
};

// Exported component
export const CensusView: React.FC<CensusViewProps> = CensusViewContent;
