import type {
  AdminCudyrResultAdjustment,
  CudyrResultOption,
} from '@/domain/cudyr/adminCudyrResult';
import type { AuthoringSessionGuard } from '@/services/storage/authoringSession';
import { callCudyrFunction } from '@/services/cudyr/cudyrFunctionsCall';
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

export const setAdminCudyrResult = (
  payload: AdminCudyrResultPayload,
  guard: AuthoringSessionGuard
): Promise<AdminCudyrResultResponse> =>
  callCudyrFunction<AdminCudyrResultResponse, AdminCudyrResultPayload>(
    'setAdminCudyrResult',
    payload,
    guard
  ).catch((error: unknown) => {
    throw normalizeDailyRecordAuthorityError(error);
  });
