import React from 'react';
import type { AuthContextType } from '@/context/AuthContext';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import {
  buildAppShellReadyTelemetry,
  resolveSanitizedCurrentModule,
} from '@/components/layout/app-content/appContentShellEffectsController';
import { useAppContentEventBridge } from '@/components/layout/app-content/useAppContentEventBridge';

interface UseAppContentShellEffectsParams {
  role: AuthContextType['role'];
  currentModule: UseUIStateReturn['currentModule'];
  setCurrentModule: UseUIStateReturn['setCurrentModule'];
  setSelectedShift: UseUIStateReturn['setSelectedShift'];
}

export const useAppContentShellEffects = ({
  role,
  currentModule,
  setCurrentModule,
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
    if (appShellTelemetryRecordedRef.current) {
      return;
    }

    recordOperationalTelemetry(buildAppShellReadyTelemetry({ role, currentModule }), {
      allowSuccess: true,
    });
    appShellTelemetryRecordedRef.current = true;
  }, [currentModule, role]);
};
