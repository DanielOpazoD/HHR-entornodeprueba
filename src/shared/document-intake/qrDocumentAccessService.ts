import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
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

export const createQrDocumentAccessService = (deps: QrDocumentAccessServiceDeps = {}) => {
  const functionsRuntime = deps.functionsRuntime ?? defaultFunctionsRuntime;
  return {
    async listPatientOptionsWithPrescriptionPin(
      pin: string
    ): Promise<QrDocumentPatientOptionsResult> {
      const functions = await functionsRuntime.getFunctions();
      const { httpsCallable } = await import('firebase/functions');
      const callable = httpsCallable<{ pin: string; date: string }, QrDocumentPatientOptionsResult>(
        functions,
        'listPrescriptionUploadPatientOptions'
      );
      return (await callable({ pin, date: getClinicalCalendarDateISO() })).data;
    },
  };
};

export const { listPatientOptionsWithPrescriptionPin } = createQrDocumentAccessService();
