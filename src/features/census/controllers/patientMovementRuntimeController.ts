import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

export interface PatientMovementRuntime {
  alert: (message: string) => void;
  warn?: (message: string) => void;
}

export const patientMovementBrowserRuntime: PatientMovementRuntime = {
  alert: (message: string) => {
    defaultBrowserWindowRuntime.alert(message);
  },
  warn: (message: string) => {
    console.warn(message);
  },
};
