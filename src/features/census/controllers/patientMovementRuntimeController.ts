import { createCensusDialogRuntime } from '@/features/census/controllers/censusBrowserRuntimeAdapter';

export interface PatientMovementRuntime {
  alert: (message: string) => void;
  warn?: (message: string) => void;
}

const censusDialogRuntime = createCensusDialogRuntime();

export const patientMovementBrowserRuntime: PatientMovementRuntime = {
  alert: (message: string) => {
    censusDialogRuntime.alert(message);
  },
  warn: (message: string) => {
    console.warn(message);
  },
};
