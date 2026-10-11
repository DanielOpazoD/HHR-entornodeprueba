import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
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

const callHistory = async <Request, Response>(
  name: string,
  payload: Request
): Promise<Response> => {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
  try {
    return (await httpsCallable<Request, Response>(functions, name, { timeout: 20_000 })(payload))
      .data;
  } catch (error) {
    throw normalizeDailyRecordAuthorityError(error);
  }
};

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
