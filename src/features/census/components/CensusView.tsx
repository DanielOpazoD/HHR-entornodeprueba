import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { CensusLoadingState } from '@/components/ui/CensusLoadingState';
import { useDailyRecordStatus } from '@/context/DailyRecordContext';
import { useCensusViewScreenModel } from '@/features/census/hooks/useCensusViewScreenModel';
import { CensusBootstrapRecovery } from './CensusBootstrapRecovery';
import { CensusRegisterContent } from './CensusRegisterContent';
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

  if (branch === 'empty') {
    // Elapsed grace time is not evidence of absence. Only confirmed_empty may
    // mount creation UI; cached/late Firebase responses must never flash it.
    if (isEmptyBranchPending || dailyRecordStatus.bootstrapPhase !== 'confirmed_empty') {
      return (
        <CensusBootstrapRecovery
          key={currentDateString}
          date={currentDateString}
          failed={
            dailyRecordStatus.syncStatus === 'error' ||
            dailyRecordStatus.bootstrapPhase === 'remote_record_timeout'
          }
        />
      );
    }

    return (
      <Suspense fallback={<CensusLoadingState />}>
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
