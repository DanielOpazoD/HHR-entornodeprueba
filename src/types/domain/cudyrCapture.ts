import type {
  CudyrCapturePart,
  CudyrHistoryObservation,
  CudyrHistoryCursor,
  ReadCudyrHistoryRequest,
} from './cudyrHistory';

export interface CudyrCaptureReceipt {
  schemaVersion: 1;
  id: string;
  censusDate: string;
  capture: CudyrCapturePart;
  observationIds: string[];
  captureContexts: CudyrHistoryObservation['captureContexts'];
  receivedAt: string;
  receivedBy: string;
  verifiedRunId: string;
}

export type ReadCudyrCapturesRequest = ReadCudyrHistoryRequest & { kind: 'captures' };
export interface ReadCudyrEpisodeCapturesRequest {
  kind: 'episode-captures';
  clinicalEpisodeIds: string[];
  limit?: number;
  cursor?: CudyrHistoryCursor;
}
export interface ReadCudyrCapturesResult {
  captures: CudyrCaptureReceipt[];
  nextCursor: CudyrHistoryCursor | null;
}
