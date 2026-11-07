import React from 'react';
import type { AuthContextType } from '@/context/AuthContext';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import {
  buildAppShellReadyTelemetry,
  resolveSanitizedCurrentModule,
  shouldRecordAppShellTelemetry,
} from '@/components/layout/app-content/appContentShellEffectsController';
import { useAppContentEventBridge } from '@/components/layout/app-content/useAppContentEventBridge';

interface UseAppContentShellEffectsParams {
  role: AuthContextType['role'];
  currentModule: UseUIStateReturn['currentModule'];
  setCurrentModule: UseUIStateReturn['setCurrentModule'];
  isSignatureMode: boolean;
  setSelectedShift: UseUIStateReturn['setSelectedShift'];
}

export const useAppContentShellEffects = ({
  role,
  currentModule,
  setCurrentModule,
  isSignatureMode,
  setSelectedShift,
}: UseAppContentShellEffectsParams): void => {
  const appShellTelemetryRecordedRef = React.useRef(false);

  useAppContentEventBridge({
    setCurrentModule,
    setSelectedShift,
  });

  React.useEffect(() => {
    const sanitizedModule = resolveSanitizedCurrentModule({ role, currentModule });
    if (sanitizedModule !== currentModule) {
      setCurrentModule(sanitizedModule);
    }
  }, [currentModule, role, setCurrentModule]);

  React.useEffect(() => {
    if (
      !shouldRecordAppShellTelemetry({
        alreadyRecorded: appShellTelemetryRecordedRef.current,
        isSignatureMode,
      })
    ) {
      return;
    }

    recordOperationalTelemetry(buildAppShellReadyTelemetry({ role, currentModule }), {
      allowSuccess: true,
    });
    appShellTelemetryRecordedRef.current = true;
  }, [currentModule, isSignatureMode, role]);
};
