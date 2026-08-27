import { httpsCallable } from 'firebase/functions';
import type {
  AdminCudyrResultAdjustment,
  CudyrResultOption,
} from '@/domain/cudyr/adminCudyrResult';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { normalizeDailyRecordAuthorityError } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

export interface AdminCudyrResultPayload {
  date: string;
  adjustments: AdminCudyrResultAdjustment[];
  expectedLastUpdated: string;
}

export interface AdminCudyrResultChange extends AdminCudyrResultAdjustment {
  previousCategory: string | null;
  changed: boolean;
}

export interface AdminCudyrResultResponse {
  success: boolean;
  date: string;
  revision: number;
  changed: boolean;
  changedCount: number;
  changes: AdminCudyrResultChange[];
  bedId?: string;
  clinicalCrib?: boolean;
  previousCategory?: string | null;
  category?: CudyrResultOption | null;
}

export const setAdminCudyrResult = async (
  payload: AdminCudyrResultPayload
): Promise<AdminCudyrResultResponse> => {
  const functions = await defaultFunctionsRuntime.getFunctions();
  const callable = httpsCallable<AdminCudyrResultPayload, AdminCudyrResultResponse>(
    functions,
    'setAdminCudyrResult'
  );

  try {
    return (await callable(payload)).data;
  } catch (error) {
    throw normalizeDailyRecordAuthorityError(error);
  }
};
