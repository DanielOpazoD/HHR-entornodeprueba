import { httpsCallable } from 'firebase/functions';
import type { CudyrResultOption } from '@/domain/cudyr/adminCudyrResult';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { normalizeDailyRecordAuthorityError } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

export interface AdminCudyrResultPayload {
  date: string;
  bedId: string;
  clinicalCrib: boolean;
  clinicalEpisodeId: string;
  category: CudyrResultOption | null;
  expectedLastUpdated: string;
}

export interface AdminCudyrResultResponse {
  success: boolean;
  date: string;
  bedId: string;
  clinicalCrib: boolean;
  previousCategory: string | null;
  category: CudyrResultOption | null;
  revision: number;
  changed: boolean;
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
