import { parseDicom } from 'dicom-parser';
import { fetchDicomInstance } from './mmradDicomService';
import { validateDicomInstanceIdentity } from './dicomInstanceIdentity';
import type { DicomStudy } from './dicomTypes';

/** Private to one mounted study. Originals only: no extra GPU volumes or persistent storage. */
export const createDicomStudyPrefetch = (study: DicomStudy, budget = 64 * 1024 * 1024) => {
  const cached = new Map<string, Uint8Array>();
  const completed = new Set<string>();
  let bytes = 0;
  let disposed = false;
  let task: AbortController | undefined;
  let draining: Promise<void> = Promise.resolve();
  let selected = '';
  const pause = () => {
    task?.abort();
    task = undefined;
  };
  const select = (uid: string) => {
    pause();
    selected = uid;
  };
  const fetch: typeof fetchDicomInstance = async (ticket, signal, timing) => {
    // A series switch drains the single background request before foreground work begins.
    await draining;
    signal.throwIfAborted();
    if (disposed) throw new DOMException('Visor cerrado', 'AbortError');
    const value = cached.get(ticket);
    if (value) {
      cached.delete(ticket);
      bytes -= value.byteLength;
      return value;
    }
    return fetchDicomInstance(ticket, signal, timing);
  };
  const complete = (uid: string) => {
    if (disposed || uid !== selected) return;
    completed.add(uid);
    pause();
    const controller = new AbortController();
    task = controller;
    const previous = draining;
    draining = (async () => {
      await previous;
      for (const series of study.series) {
        if (
          series.uid === selected ||
          completed.has(series.uid) ||
          series.instances.some(i => i.frames !== 1)
        )
          continue;
        for (const instance of series.instances) {
          controller.signal.throwIfAborted();
          if (disposed || bytes >= budget) return;
          if (cached.has(instance.ticket)) continue;
          const value = await fetchDicomInstance(
            instance.ticket,
            controller.signal,
            undefined,
            Math.floor((budget - bytes) / 2)
          );
          controller.signal.throwIfAborted();
          validateDicomInstanceIdentity(
            parseDicom(value, { untilTag: 'x7fe00010' }),
            study,
            series,
            instance
          );
          if (value.byteLength > budget - bytes) return;
          cached.set(instance.ticket, value);
          bytes += value.byteLength;
        }
      }
    })().catch(() => {
      /* Background errors stop prefetch; foreground validates and reports independently. */
    });
  };
  return {
    fetch,
    select,
    complete,
    dispose: () => {
      disposed = true;
      pause();
      cached.clear();
      bytes = 0;
    },
  };
};
export type DicomStudyPrefetch = ReturnType<typeof createDicomStudyPrefetch>;
