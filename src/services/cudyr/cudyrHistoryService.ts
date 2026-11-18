import { guardAuthoringSession } from '@/services/storage/authoringSession';
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

/** Each call is its own operation (the queue checks its task's owner just before): guard taken here. */
const callHistory = <Request, Response>(name: CudyrFunctionEndpoint, payload: Request) =>
  callCudyrFunction<Response, Request>(name, payload, guardAuthoringSession()).catch(
    (error: unknown) => {
      throw normalizeDailyRecordAuthorityError(error);
    }
  );

export const archiveCudyrHistory = (payload: ArchiveCudyrHistoryRequest) =>
  callHistory<ArchiveCudyrHistoryRequest, ArchiveCudyrHistoryResult>(
    'archiveCudyrHistory',
    payload
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
