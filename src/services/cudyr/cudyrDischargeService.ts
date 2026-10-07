import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { normalizeDailyRecordAuthorityError } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import type {
  CorrectCudyrDischargeRequest,
  CorrectCudyrDischargeResult,
  ReadCudyrDischargesRequest,
  ReadCudyrDischargesResult,
  ReadCudyrDischargeAuditRequest,
  ReadCudyrDischargeAuditResult,
} from '@/types/domain/cudyrDischarge';

const call = async <Request, Result>(endpoint: string, request: Request): Promise<Result> => {
  const runtime = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
  try {
    return (await httpsCallable<Request, Result>(runtime, endpoint, { timeout: 20_000 })(request))
      .data;
  } catch (error) {
    throw normalizeDailyRecordAuthorityError(error);
  }
};
export const correctCudyrDischarge = (request: CorrectCudyrDischargeRequest) =>
  call<CorrectCudyrDischargeRequest, CorrectCudyrDischargeResult>('archiveCudyrHistory', request);
export const readCudyrDischarges = (request: ReadCudyrDischargesRequest) =>
  call<ReadCudyrDischargesRequest, ReadCudyrDischargesResult>('readCudyrHistory', request);
export const readCudyrDischargeAudit = (request: ReadCudyrDischargeAuditRequest) =>
  call<ReadCudyrDischargeAuditRequest, ReadCudyrDischargeAuditResult>('readCudyrHistory', request);
