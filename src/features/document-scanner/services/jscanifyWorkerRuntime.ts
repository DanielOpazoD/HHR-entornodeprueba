import hashJs from 'hash.js';
import { convertHighEfficiencyImageToJpeg } from '@/shared/images/highEfficiencyImageConverter';
import type { DocumentScanCorners, JscanifyDocumentPage } from './documentScannerTypes';
import type { DocumentScanFilterMode } from './documentFilterProfiles';

const JSCANIFY_VERSION = '1.4.2';
const OPENCV_VERSION = '4.7.0-release.1';
const JSCANIFY_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/jscanify@${JSCANIFY_VERSION}/src/jscanify.js`;
const OPENCV_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@${OPENCV_VERSION}/dist/opencv.js`;
const JSCANIFY_SCRIPT_INTEGRITY =
  'sha384-1lFiUI8fK3enJqIHszlQ9u3upmgE3Z0Jj0Pr9vubGa2amHhsn06NurXsHxJLX6Dz';
const OPENCV_SCRIPT_INTEGRITY =
  'sha384-eusYH3dVdKCUkhz4NiHNlf4l626b2RExm+RLE9z8Sz2x2mZ+i04nAjj6PQbIhkBV';
const WORKER_URL = '/document-scanner/jscanify-worker.js';

interface WorkerProcessedMessage {
  readonly type: 'processed';
  readonly id: number;
  readonly bytes: ArrayBuffer;
  readonly sourceBytes: ArrayBuffer;
  readonly corners: DocumentScanCorners;
  readonly paperDetected: boolean;
}

interface WorkerFilteredMessage {
  readonly type: 'filtered';
  readonly id: number;
  readonly bytes: ArrayBuffer;
}

interface WorkerFailureMessage {
  readonly type: 'error';
  readonly id?: number;
  readonly message: string;
}

type WorkerSuccessMessage = WorkerProcessedMessage | WorkerFilteredMessage;
type ScannerWorkerMessage = WorkerSuccessMessage | WorkerFailureMessage;

interface PendingWorkerRequest {
  readonly resolve: (message: WorkerSuccessMessage) => void;
  readonly reject: (error: Error) => void;
}

interface ScannerWorkerRuntime {
  readonly worker: Worker;
  readonly pending: Map<number, PendingWorkerRequest>;
  nextRequestId: number;
}

let workerRuntimePromise: Promise<ScannerWorkerRuntime> | null = null;

const isHighEfficiencyImage = (file: File): boolean =>
  file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/i.test(file.name);

const normalizeImageBlob = async (file: File): Promise<Blob> =>
  isHighEfficiencyImage(file) ? convertHighEfficiencyImageToJpeg(file) : file;

export const computeSha384Integrity = async (
  bytes: ArrayBuffer,
  subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null
): Promise<string> => {
  const digest = subtle
    ? new Uint8Array(await subtle.digest('SHA-384', bytes))
    : Uint8Array.from(hashJs.sha384().update(new Uint8Array(bytes)).digest());
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha384-${btoa(binary)}`;
};

const fetchVerifiedScript = async (
  url: string,
  expectedIntegrity: string,
  unavailableMessage: string
): Promise<Blob> => {
  const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) throw new Error(unavailableMessage);
  const bytes = await response.arrayBuffer();
  if ((await computeSha384Integrity(bytes)) !== expectedIntegrity) {
    throw new Error('La verificación de integridad del procesador de documentos falló.');
  }
  return new Blob([bytes], { type: 'application/javascript' });
};

const rejectPendingRequests = (runtime: ScannerWorkerRuntime, error: Error): void => {
  for (const request of runtime.pending.values()) request.reject(error);
  runtime.pending.clear();
};

const createWorkerRuntime = async (): Promise<ScannerWorkerRuntime> => {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Este navegador no admite el procesamiento seguro de JScanify.');
  }

  const [openCvScript, jscanifyScript] = await Promise.all([
    fetchVerifiedScript(
      OPENCV_SCRIPT_URL,
      OPENCV_SCRIPT_INTEGRITY,
      'No se pudo descargar OpenCV para procesar el documento.'
    ),
    fetchVerifiedScript(
      JSCANIFY_SCRIPT_URL,
      JSCANIFY_SCRIPT_INTEGRITY,
      'No se pudo descargar JScanify para detectar el documento.'
    ),
  ]);
  let worker: Worker | null = null;
  let openCvUrl: string | null = null;
  let jscanifyUrl: string | null = null;

  try {
    openCvUrl = URL.createObjectURL(openCvScript);
    jscanifyUrl = URL.createObjectURL(jscanifyScript);
    const activeWorker = new Worker(WORKER_URL);
    worker = activeWorker;
    const runtime: ScannerWorkerRuntime = {
      worker: activeWorker,
      pending: new Map(),
      nextRequestId: 1,
    };
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('OpenCV tardó demasiado en iniciar. Inténtalo nuevamente.')),
        120_000
      );
      activeWorker.onmessage = (event: MessageEvent<ScannerWorkerMessage | { type: 'ready' }>) => {
        if (event.data.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
        } else if (event.data.type === 'error') {
          window.clearTimeout(timeout);
          reject(new Error(event.data.message));
        }
      };
      activeWorker.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('No se pudo iniciar el procesador local de documentos.'));
      };
      activeWorker.postMessage({ type: 'init', openCvUrl, jscanifyUrl });
    });

    activeWorker.onmessage = (event: MessageEvent<ScannerWorkerMessage>) => {
      const message = event.data;
      if (message.type === 'error' && message.id === undefined) {
        rejectPendingRequests(runtime, new Error(message.message));
        return;
      }
      if (message.id === undefined) return;
      const request = runtime.pending.get(message.id);
      if (!request) return;
      runtime.pending.delete(message.id);
      if (message.type === 'error') {
        request.reject(new Error(message.message));
        return;
      }
      request.resolve(message);
    };
    activeWorker.onerror = () => {
      rejectPendingRequests(
        runtime,
        new Error('El procesador local de documentos se interrumpió.')
      );
      activeWorker.terminate();
      workerRuntimePromise = null;
    };
    return runtime;
  } catch (error) {
    worker?.terminate();
    throw error;
  } finally {
    if (openCvUrl) URL.revokeObjectURL(openCvUrl);
    if (jscanifyUrl) URL.revokeObjectURL(jscanifyUrl);
  }
};

const getWorkerRuntime = async (): Promise<ScannerWorkerRuntime> => {
  if (!workerRuntimePromise) workerRuntimePromise = createWorkerRuntime();
  try {
    return await workerRuntimePromise;
  } catch (error) {
    workerRuntimePromise = null;
    throw error;
  }
};

export const processDocumentPage = async (
  input: Blob,
  corners?: DocumentScanCorners
): Promise<JscanifyDocumentPage> => {
  const runtime = await getWorkerRuntime();
  const blob = input instanceof File ? await normalizeImageBlob(input) : input;
  const bytes = await blob.arrayBuffer();
  const id = runtime.nextRequestId;
  runtime.nextRequestId += 1;
  const response = await new Promise<WorkerSuccessMessage>((resolve, reject) => {
    runtime.pending.set(id, { resolve, reject });
    runtime.worker.postMessage(
      { type: 'process', id, bytes, mimeType: blob.type || 'image/jpeg', corners },
      [bytes]
    );
  });
  if (response.type !== 'processed') {
    throw new Error('El procesador devolvió una respuesta inesperada.');
  }
  return {
    blob: new Blob([response.bytes], { type: 'image/jpeg' }),
    sourceBlob: new Blob([response.sourceBytes], { type: 'image/jpeg' }),
    corners: response.corners,
    paperDetected: response.paperDetected,
    filterMode: 'scanner',
  };
};

export const filterDocumentPage = async (
  input: Blob,
  mode: DocumentScanFilterMode,
  maximumDimension?: number
): Promise<Blob> => {
  const runtime = await getWorkerRuntime();
  const bytes = await input.arrayBuffer();
  const id = runtime.nextRequestId;
  runtime.nextRequestId += 1;
  const response = await new Promise<WorkerSuccessMessage>((resolve, reject) => {
    runtime.pending.set(id, { resolve, reject });
    runtime.worker.postMessage(
      {
        type: 'filter',
        id,
        bytes,
        mimeType: input.type || 'image/jpeg',
        mode,
        maximumDimension,
      },
      [bytes]
    );
  });
  if (response.type !== 'filtered') {
    throw new Error('El procesador devolvió una respuesta inesperada.');
  }
  return new Blob([response.bytes], { type: 'image/jpeg' });
};

export const JSCANIFY_POC_METADATA = Object.freeze({
  jscanifyVersion: JSCANIFY_VERSION,
  openCvVersion: OPENCV_VERSION,
  license: 'MIT',
  delivery: 'verified-worker-cdn-poc',
});
