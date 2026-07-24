import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

export interface ScannedDocumentQueueRecord {
  id: string;
  bedId: string;
  patientName: string;
  patientRut: string;
  pageCount: number;
  byteSize: number;
  createdAt: string;
  state: 'pending_eloisa';
  downloadUrl: string | null;
}

interface SubmitScannedDocumentPayload {
  pin: string;
  submissionKey: string;
  requestDate: string;
  sourceDate: string;
  patientOptionKey: string;
  expectedPatientRut: string;
  pageCount: number;
  pageImagesBase64: string[];
}

interface DocumentScannerQueueServiceDeps {
  functionsRuntime?: Pick<FunctionsRuntime, 'getFunctions'>;
}

const buildService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => {
  const call = async <Input, Output>(name: string, payload: Input): Promise<Output> => {
    const functions = await functionsRuntime.getFunctions();
    return (await httpsCallable<Input, Output>(functions, name)(payload)).data;
  };

  return {
    submitScannedDocument: (payload: SubmitScannedDocumentPayload) =>
      call<SubmitScannedDocumentPayload, { id: string; createdAt: string }>(
        'submitScannedDocument',
        payload
      ),
    listScannedDocuments: () =>
      call<Record<string, never>, { documents: ScannedDocumentQueueRecord[] }>(
        'listScannedDocuments',
        {}
      ),
    confirmScannedDocumentUploaded: (id: string) =>
      call<{ id: string; confirmedInEloisa: true }, { ok: true; purged: true }>(
        'confirmScannedDocumentUploaded',
        { id, confirmedInEloisa: true }
      ),
  };
};

export const createDocumentScannerQueueService = (deps: DocumentScannerQueueServiceDeps = {}) =>
  buildService(deps.functionsRuntime);

const service = buildService();
export const submitScannedDocument = service.submitScannedDocument;
export const listScannedDocuments = service.listScannedDocuments;
export const confirmScannedDocumentUploaded = service.confirmScannedDocumentUploaded;

export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};
