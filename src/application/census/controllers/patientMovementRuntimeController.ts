import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { createScopedLogger } from '@/services/utils/loggerScope';

const patientMovementRuntimeLogger = createScopedLogger('PatientMovementRuntime');

export interface PatientMovementRuntime {
  alert: (message: string) => void;
  warn?: (message: string) => void;
}

export const patientMovementBrowserRuntime: PatientMovementRuntime = {
  alert: (message: string) => {
    defaultBrowserWindowRuntime.alert(message);
  },
  warn: (message: string) => {
    patientMovementRuntimeLogger.warn(message);
  },
};
