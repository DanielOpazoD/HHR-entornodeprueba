// The worker is not precached, so its first read after a release also downloads it.
const READ_TIMEOUT_MS = 30000;

/** Runs one read in the XLS worker. `accept` turns its reply into a result, or throws. */
export const readInCudyrWorker = <Reply, Result>(
  message: ArrayBuffer | { buffer: ArrayBuffer; kind: string },
  signal: AbortSignal,
  startFailure: string,
  accept: (data: Reply) => Result
) =>
  new Promise<Result>((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./cudyrSupplement.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Error('Lectura cancelada.'));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error('El archivo excedió el tiempo de lectura.'));
    }, READ_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => {
      finish();
      reject(new Error(startFailure));
    };
    worker.onmessage = (event: MessageEvent<Reply>) => {
      finish();
      try {
        resolve(accept(event.data));
      } catch (error) {
        reject(error);
      }
    };
    worker.postMessage(message, [message instanceof ArrayBuffer ? message : message.buffer]);
  });
