import React, { Suspense, lazy, useRef, useState } from 'react';
import { CensusLoadingState } from '@/components/ui/CensusLoadingState';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { useCensusViewScreenModel } from '@/features/census/hooks/useCensusViewScreenModel';
import { CensusBootstrapRecovery } from './CensusBootstrapRecovery';
import { CensusRegisterContent } from './CensusRegisterContent';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
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
  const { dayView } = useCensusViewScreenModel({
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
  const sessionEpoch = useSessionEpoch();
  const rayenBootstrapSequenceRef = useRef(0);
  const [rayenBootstrapRequest, setRayenBootstrapRequest] = useState<{
    date: string;
    sessionEpoch: number;
    id: number;
  } | null>(null);
  const requestRayenBootstrap = (): void => {
    rayenBootstrapSequenceRef.current += 1;
    setRayenBootstrapRequest({
      date: currentDateString,
      sessionEpoch,
      id: rayenBootstrapSequenceRef.current,
    });
  };

  switch (dayView.kind) {
    case 'register':
      return (
        <div className="space-y-4">
          <CensusRegisterContent
            {...dayView.registerContentProps}
            // The request waits for its own day: looking at another day only hides it, and it starts
            // on return. The session epoch only grows, so a request of an ended session never runs.
            rayenBootstrapRequestId={
              rayenBootstrapRequest?.date === currentDateString &&
              rayenBootstrapRequest.sessionEpoch === sessionEpoch
                ? rayenBootstrapRequest.id
                : undefined
            }
            // Clears only the request it handled: a day copied meanwhile keeps its own.
            onRayenBootstrapHandled={handledId =>
              setRayenBootstrapRequest(request => (request?.id === handledId ? null : request))
            }
          />
        </div>
      );
    case 'confirmedEmpty':
      return (
        <Suspense fallback={<CensusLoadingState />}>
          <LazyEmptyDayPrompt
            {...dayView.emptyDayPromptProps}
            onRayenBootstrapReady={requestRayenBootstrap}
          />
        </Suspense>
      );
    case 'loading':
    case 'readFailed':
      // Elapsed grace time is not evidence of absence: only confirmedEmpty mounts creation UI.
      return (
        <CensusBootstrapRecovery
          key={currentDateString}
          date={currentDateString}
          failed={dayView.kind === 'readFailed'}
        />
      );
    default: {
      const unhandled: never = dayView;
      return unhandled;
    }
  }
};

// Exported component
export const CensusView: React.FC<CensusViewProps> = CensusViewContent;
