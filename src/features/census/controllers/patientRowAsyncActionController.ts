import type { MaybePromiseVoid } from '@/features/census/components/patient-row/patientRowContracts';

export const runPatientRowAsyncActionSafely = (action: () => MaybePromiseVoid): void => {
  void Promise.resolve(action()).catch(() => undefined);
};
