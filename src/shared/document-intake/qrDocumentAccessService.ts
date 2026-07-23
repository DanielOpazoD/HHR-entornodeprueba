import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

export interface QrDocumentPatientOption {
  key: string;
  bedId: string;
  patientName: string;
  patientRut: string;
  patientStatus?: 'active' | 'discharge' | 'transfer';
}

export interface QrDocumentPatientOptionsResult {
  date: string;
  sourceDate?: string;
  isFallbackFromPreviousDay?: boolean;
  patientOptions: QrDocumentPatientOption[];
}

interface QrDocumentAccessServiceDeps {
  functionsRuntime?: Pick<FunctionsRuntime, 'getFunctions'>;
}

const todayIso = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};

export const createQrDocumentAccessService = (deps: QrDocumentAccessServiceDeps = {}) => {
  const functionsRuntime = deps.functionsRuntime ?? defaultFunctionsRuntime;
  return {
    async listPatientOptionsWithPrescriptionPin(
      pin: string
    ): Promise<QrDocumentPatientOptionsResult> {
      const functions = await functionsRuntime.getFunctions();
      const callable = httpsCallable<{ pin: string; date: string }, QrDocumentPatientOptionsResult>(
        functions,
        'listPrescriptionUploadPatientOptions'
      );
      return (await callable({ pin, date: todayIso() })).data;
    },
  };
};

export const { listPatientOptionsWithPrescriptionPin } = createQrDocumentAccessService();
