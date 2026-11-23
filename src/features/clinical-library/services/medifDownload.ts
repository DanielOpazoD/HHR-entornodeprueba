import type { MedifValues } from '../domain/medifDraft';
import type { MedifPreferences } from '../domain/medifPreferences';
import { createMedifPdf, MEDIF_TEMPLATE_URL, type MedifPdfMode } from './medifPdf';
import { downloadBlob } from '@/utils/downloadBlob';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

const TEMPLATE_FETCH_TIMEOUT_MS = 15_000;

/** The cache contains only the public blank template, never patient data. */
let templatePromise: Promise<ArrayBuffer> | undefined;
const loadTemplate = (): Promise<ArrayBuffer> => {
  templatePromise ??= fetchWithTimeout(MEDIF_TEMPLATE_URL, {
    timeoutMs: TEMPLATE_FETCH_TIMEOUT_MS,
    timeoutMessage:
      'La carga de la plantilla MEDIF tardó demasiado. Revisa la conexión e inténtalo de nuevo.',
  })
    .then(response => {
      if (!response.ok)
        throw new Error(
          'No se pudo cargar la plantilla MEDIF. Revisa la conexión e inténtalo de nuevo.'
        );
      return response.arrayBuffer();
    })
    .catch((error: unknown) => {
      templatePromise = undefined;
      throw error;
    });
  return templatePromise;
};

/** Rejects a cancelled caller immediately without aborting the shared blank template fetch. */
const raceWithAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) {
    return promise;
  }
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
};

export const downloadMedifPdf = async (
  values: MedifValues,
  preferences: MedifPreferences,
  mode: MedifPdfMode,
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted();
  const template = await raceWithAbort(loadTemplate(), signal);
  signal?.throwIfAborted();
  const bytes = await createMedifPdf(template, values, preferences, mode);
  signal?.throwIfAborted();
  downloadBlob(
    new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    `MEDIF-${mode === 'print' ? 'imprimible' : 'editable'}.pdf`
  );
};
