import { guardAuthoringSession } from '@/services/session/authoringSession';
import { callCudyrFunction, type CudyrFunctionEndpoint } from './cudyrFunctionsCall';
import { normalizeDailyRecordAuthorityError } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import type {
  CorrectCudyrDischargeRequest,
  CorrectCudyrDischargeResult,
  ReadCudyrDischargesRequest,
  ReadCudyrDischargesResult,
  ReadCudyrDischargeAuditRequest,
  ReadCudyrDischargeAuditResult,
} from '@/types/domain/cudyrDischarge';

/** Each call is its own operation, begun when the person acts: the guard is taken here. */
const call = <Request, Result>(endpoint: CudyrFunctionEndpoint, request: Request) =>
  callCudyrFunction<Result, Request>(endpoint, request, guardAuthoringSession()).catch(
    (error: unknown) => {
      throw normalizeDailyRecordAuthorityError(error);
    }
  );
export const correctCudyrDischarge = (request: CorrectCudyrDischargeRequest) =>
  call<CorrectCudyrDischargeRequest, CorrectCudyrDischargeResult>('archiveCudyrHistory', request);
export const readCudyrDischarges = (request: ReadCudyrDischargesRequest) =>
  call<ReadCudyrDischargesRequest, ReadCudyrDischargesResult>('readCudyrHistory', request);
export const readCudyrDischargeAudit = (request: ReadCudyrDischargeAuditRequest) =>
  call<ReadCudyrDischargeAuditRequest, ReadCudyrDischargeAuditResult>('readCudyrHistory', request);
