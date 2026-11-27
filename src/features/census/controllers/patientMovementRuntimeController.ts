import { createCensusDialogRuntime } from './censusBrowserRuntimeAdapter';
import { createScopedLogger } from '@/services/utils/loggerScope';

const patientMovementRuntimeLogger = createScopedLogger('PatientMovementRuntime');
const defaultDialogRuntime = createCensusDialogRuntime();

export interface PatientMovementRuntime {
  alert: (message: string) => void;
  warn?: (message: string) => void;
}

export const patientMovementBrowserRuntime: PatientMovementRuntime = {
  alert: (message: string) => {
    defaultDialogRuntime.alert(message);
  },
  warn: (message: string) => {
    patientMovementRuntimeLogger.warn(message);
  },
};
