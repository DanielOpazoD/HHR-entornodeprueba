import {
  guardAuthoringSession,
  type AuthoringSessionGuard,
} from '@/services/session/authoringSession';
import { callCudyrFunction, type CudyrFunctionEndpoint } from './cudyrFunctionsCall';
import { normalizeDailyRecordAuthorityError } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import type {
  ArchiveCudyrHistoryRequest,
  ArchiveCudyrHistoryResult,
  ReadCudyrHistoryRequest,
  ReadCudyrHistoryResult,
} from '@/types/domain/cudyrHistory';
import type {
  ReadCudyrCapturesRequest,
  ReadCudyrCapturesResult,
  ReadCudyrEpisodeCapturesRequest,
} from '@/types/domain/cudyrCapture';

/** A read is its own operation, begun here; an archive carries the guard of whoever queued it. */
const callHistory = <Request, Response>(
  name: CudyrFunctionEndpoint,
  payload: Request,
  guard: AuthoringSessionGuard = guardAuthoringSession()
) =>
  callCudyrFunction<Response, Request>(name, payload, guard).catch((error: unknown) => {
    throw normalizeDailyRecordAuthorityError(error);
  });

export const archiveCudyrHistory = (
  payload: ArchiveCudyrHistoryRequest,
  guard: AuthoringSessionGuard
) =>
  callHistory<ArchiveCudyrHistoryRequest, ArchiveCudyrHistoryResult>(
    'archiveCudyrHistory',
    payload,
    guard
  );

/** One bounded page. Callers must exhaust nextCursor before claiming period coverage. */
export const readCudyrHistory = (payload: ReadCudyrHistoryRequest) =>
  callHistory<ReadCudyrHistoryRequest, ReadCudyrHistoryResult>('readCudyrHistory', payload);

export const readCudyrCaptures = (payload: ReadCudyrCapturesRequest) =>
  callHistory<ReadCudyrCapturesRequest, ReadCudyrCapturesResult>('readCudyrHistory', payload);

export const readCudyrEpisodeCaptures = (payload: ReadCudyrEpisodeCapturesRequest) =>
  callHistory<ReadCudyrEpisodeCapturesRequest, ReadCudyrCapturesResult>(
    'readCudyrHistory',
    payload
  );
