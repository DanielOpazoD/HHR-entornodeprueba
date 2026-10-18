import { availableDicomRanges, DicomTransferError, type DicomLoadState } from './dicomLoadState';

type Slot = 'queued' | 'fetching' | 'downloaded' | 'decoding' | 'ready' | 'failed';
const deferred = () => {
  let resolve!: (id: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
};
/** Session-scoped queue. Downloads and two decode workers have separate bounded capacity. */
export const createDicomDownloadQueue = (
  total: number,
  signal: AbortSignal,
  download: (index: number) => Promise<Uint8Array>,
  decode: (index: number, bytes: Uint8Array) => Promise<string>,
  fatal: (error: unknown) => void,
  complete: () => void
) => {
  const started = performance.now();
  const slots: Slot[] = Array(total).fill('queued');
  const pending = Array.from({ length: total }, deferred);
  const attempts = Array(total).fill(0);
  const buffers = new Map<number, Uint8Array>();
  const retryAt = Array(total).fill(0);
  let priority = Math.floor(total / 2),
    direction = 1,
    successes = 0,
    cooldown = 0;
  let stopped = false,
    finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveSettled!: () => void;
  const settled = new Promise<void>(resolve => {
    resolveSettled = resolve;
  });
  const listeners = new Set<(state: DicomLoadState) => void>();
  const state: DicomLoadState = {
    total,
    downloaded: 0,
    ready: 0,
    failed: [],
    available: [],
    activeDownloads: 0,
    activeDecodes: 0,
    concurrency: 4,
    limit: 4,
    retries: 0,
    rawBytes: 0,
    firstReadyMs: null,
    elapsedMs: 0,
    volumeBuilding: false,
    timings: { headers: 0, transfer: 0, upstream: 0, upstreamSamples: 0, decode: 0, volume: 0 },
  };
  const snapshot = () => ({
    ...state,
    timings: { ...state.timings },
    failed: slots.flatMap((s, i) => (s === 'failed' ? [i] : [])),
    available: availableDicomRanges(slots.map(s => s === 'ready')),
    elapsedMs: performance.now() - started,
  });
  const emit = () => {
    const value = snapshot();
    listeners.forEach(listener => listener(value));
  };
  const drain = () => {
    if ((stopped || finished) && !state.activeDownloads && !state.activeDecodes) resolveSettled();
  };
  const stop = (reason: unknown) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    buffers.clear();
    pending.forEach(item => item.reject(reason));
    drain();
  };
  const abort = () => stop(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  void settled.then(() => {
    if (stopped) signal.removeEventListener('abort', abort);
  });
  const rank = (i: number) => {
    if (i === priority) return -1;
    const distance = Math.abs(i - priority);
    // Nearby forward cuts first, then nearby reverse cuts; all remaining cuts still drain.
    return distance <= 8
      ? distance + (Math.sign(i - priority) === direction ? 0 : 4)
      : distance + 12;
  };
  const next = (status: Slot, eligible = (_: number) => true) =>
    slots
      .flatMap((s, i) => (s === status && eligible(i) ? [i] : []))
      .sort((a, b) => rank(a) - rank(b) || a - b)[0];
  const fail = (error: unknown) => {
    const safe = new Error(
      error instanceof Error ? error.message : 'No se pudo preparar una imagen DICOM.'
    );
    stop(safe);
    fatal(safe);
  };
  const pump = () => {
    clearTimeout(timer);
    if (stopped || signal.aborted) {
      drain();
      return;
    }
    while (state.activeDecodes < 2) {
      const index = next('downloaded');
      if (index === undefined) break;
      const bytes = buffers.get(index)!;
      buffers.delete(index);
      slots[index] = 'decoding';
      state.activeDecodes++;
      const start = performance.now();
      void Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return decode(index, bytes);
        })
        .then(id => {
          if (stopped) return;
          slots[index] = 'ready';
          state.ready++;
          state.firstReadyMs ??= performance.now() - started;
          pending[index].resolve(id);
          if (state.ready === total) {
            finished = true;
            complete();
          }
        })
        .catch(error => {
          if (!stopped) fail(error);
        })
        .finally(() => {
          state.timings.decode += performance.now() - start;
          state.activeDecodes--;
          emit();
          pump();
          drain();
        });
    }
    // Bound queued originals; leave one buffer slot available for the foreground cut.
    const buffered = () => buffers.size + state.activeDownloads;
    while (state.activeDownloads < state.concurrency && Date.now() >= cooldown) {
      const index = next('queued', i => retryAt[i] <= Date.now());
      if (index === undefined || buffered() >= state.limit * 2 + (index === priority ? 1 : 0))
        break;
      slots[index] = 'fetching';
      state.activeDownloads++;
      void Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return download(index);
        })
        .then(bytes => {
          if (stopped) return;
          buffers.set(index, bytes);
          slots[index] = 'downloaded';
          state.downloaded++;
          state.rawBytes += bytes.byteLength;
          if (++successes >= 8 && state.concurrency < state.limit) {
            state.concurrency++;
            successes = 0;
          }
        })
        .catch(error => {
          if (stopped) return;
          if (!(error instanceof DicomTransferError) || !error.transient) {
            fail(error);
            return;
          }
          successes = 0;
          state.concurrency = Math.max(1, Math.floor(state.concurrency / 2));
          const pause = Math.max(
            error.retryAfterMs,
            500 * 2 ** attempts[index] + Math.random() * 250
          );
          cooldown = Math.max(cooldown, Date.now() + pause);
          retryAt[index] = cooldown;
          if (attempts[index]++ < 2 && pause <= 120_000) {
            slots[index] = 'queued';
            state.retries++;
          } else {
            slots[index] = 'failed';
            pending[index].reject(error);
          }
        })
        .finally(() => {
          state.activeDownloads--;
          emit();
          pump();
          drain();
        });
    }
    const delayed = slots.flatMap((s, i) =>
      s === 'queued' && Math.max(retryAt[i], cooldown) > Date.now()
        ? [Math.max(retryAt[i], cooldown)]
        : []
    );
    if (delayed.length)
      timer = setTimeout(pump, Math.min(120_000, Math.max(1, Math.min(...delayed) - Date.now())));
    emit();
    drain();
  };
  queueMicrotask(pump);
  return {
    settled,
    snapshot,
    subscribe: (listener: (value: DicomLoadState) => void) => {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    request: (index: number) => {
      signal.throwIfAborted();
      if (!Number.isInteger(index) || index < 0 || index >= total)
        throw new Error('Corte fuera de la serie.');
      if (stopped) return pending[index].promise;
      if (index !== priority) direction = Math.sign(index - priority);
      priority = index;
      pump();
      return pending[index].promise;
    },
    retryFailed: () => {
      if (stopped) return;
      slots.forEach((slot, i) => {
        if (slot !== 'failed') return;
        pending[i] = deferred();
        slots[i] = 'queued';
        attempts[i] = 0;
      });
      pump();
    },
    setLimit: (limit: number) => {
      if (![1, 2, 3, 4, 5, 6].includes(limit)) return;
      state.limit = limit;
      state.concurrency = Math.min(state.concurrency, limit);
      pump();
    },
    timing: (patch: Partial<DicomLoadState['timings']>) => {
      for (const [key, value] of Object.entries(patch))
        state.timings[key as keyof typeof state.timings] += value;
    },
    volume: (building: boolean, duration = 0) => {
      state.volumeBuilding = building;
      state.timings.volume += duration;
      emit();
    },
    stop,
  };
};
