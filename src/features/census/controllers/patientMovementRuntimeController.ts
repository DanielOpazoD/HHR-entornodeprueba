export interface PatientMovementRuntime {
  alert: (message: string) => void;
  warn?: (message: string) => void;
}

export const patientMovementBrowserRuntime: PatientMovementRuntime = {
  alert: (message: string) => {
    if (typeof window !== 'undefined') {
      window.alert(message);
    }
  },
  warn: (message: string) => {
    console.warn(message);
  },
};
