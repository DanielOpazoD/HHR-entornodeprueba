import type { DicomMeasurementOverlay } from './dicomMeasurementOverlay';
import type { DicomOrientation } from './dicomTypes';

export interface DicomCineOptions {
  start: number;
  end: number;
  fps: number;
}
/** The viewport's own canvas after IMAGE_RENDERED: copy it before requesting another frame. */
export interface DicomVideoFrame {
  canvas: HTMLCanvasElement;
  /** Non-identifying description burned into exported frames, as in PNG captures. */
  label: string;
  edges?: DicomOrientation;
}
/** Owns a view while producing frames. A position is a slice index, or an angle in 3D.
 * close() unlocks input and restores what the session moved. */
export interface DicomCineSession {
  frame: (position: number, signal: AbortSignal) => Promise<DicomVideoFrame>;
  /** The measurements drawn over the frame just produced. Only MP4 asks: playback keeps its pace. */
  measurements?: (signal: AbortSignal) => Promise<DicomMeasurementOverlay | null>;
  close: () => void;
}
export type DicomCineProgress = { completed: number; total: number; stage: string };

export const validateCineOptions = (options: DicomCineOptions, total: number) => {
  const { start, end, fps } = options;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end >= total ||
    start > end ||
    ![5, 10, 15, 20, 30].includes(fps)
  )
    throw new Error('Selecciona un intervalo válido y una velocidad entre 5 y 30 cortes/s.');
  return end - start + 1;
};

/** Cancel waits immediately without leaving an unhandled producer rejection. */
export const abortableDicomTask = <T>(task: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) {
    void task.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
};

export const cineDelay = (ms: number, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const done = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
};

/** Never skips missing cuts or catches up by dropping frames. Slow rendering slows playback. */
export const playDicomCine = async (
  session: DicomCineSession,
  options: DicomCineOptions,
  total: number,
  signal: AbortSignal,
  progress: (value: DicomCineProgress) => void
) => {
  const count = validateCineOptions(options, total);
  for (let index = options.start; index <= options.end; index++) {
    signal.throwIfAborted();
    progress({ completed: index - options.start, total: count, stage: 'Preparando corte' });
    await session.frame(index, signal);
    signal.throwIfAborted();
    progress({ completed: index - options.start + 1, total: count, stage: 'Reproduciendo' });
    await cineDelay(1000 / options.fps, signal);
  }
};
