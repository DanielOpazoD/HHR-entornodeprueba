import { parseDicom } from 'dicom-parser';
import { fetchDicomInstance } from './mmradDicomService';
import { validateDicomInstanceIdentity } from './dicomInstanceIdentity';
import type { DicomStudy } from './dicomTypes';
import { createDicomReviewCache, type DicomReviewCache } from './dicomReviewCache';

/** Scheduling hint only; never used to infer geometry or exclude localizers. */
export const prioritizeDicomSeries = (series: DicomStudy['series']) =>
  [...series].sort(
    (a, b) =>
      Number(/\b(ax|axial|transversal)\b/i.test(b.description)) -
      Number(/\b(ax|axial|transversal)\b/i.test(a.description))
  );

/** One mounted study owns downloads; the patient review may retain validated originals. */
export const createDicomStudyPrefetch = (
  study: DicomStudy,
  budget = 256 * 1024 * 1024,
  reviewCache?: DicomReviewCache
) => {
  const cached = reviewCache ?? createDicomReviewCache(study.patientId, budget);
  const originals = new Map(
    study.series.flatMap(series =>
      series.instances.map(instance => [instance.ticket, { series, instance }] as const)
    )
  );
  const ordered = prioritizeDicomSeries(study.series);
  const completed = new Set<string>();
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
    const entry = originals.get(ticket);
    if (!entry) throw new Error('Original ajeno al estudio verificado.');
    const { series, instance } = entry;
    const value = cached.get(study, series, instance);
    if (value) return value;
    const downloaded = await fetchDicomInstance(ticket, signal, timing);
    signal.throwIfAborted();
    if (disposed) throw new DOMException('Visor cerrado', 'AbortError');
    validateDicomInstanceIdentity(
      parseDicom(downloaded, { untilTag: 'x7fe00010' }),
      study,
      series,
      instance
    );
    cached.put(study, series, instance, downloaded);
    return downloaded;
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
      for (const series of ordered) {
        if (
          series.uid === selected ||
          completed.has(series.uid) ||
          series.instances.some(i => i.frames !== 1)
        )
          continue;
        for (const instance of series.instances) {
          controller.signal.throwIfAborted();
          if (disposed || cached.remaining() <= 0) return;
          if (cached.get(study, series, instance)) continue;
          const value = await fetchDicomInstance(
            instance.ticket,
            controller.signal,
            undefined,
            Math.floor(cached.remaining() / 2)
          );
          controller.signal.throwIfAborted();
          validateDicomInstanceIdentity(
            parseDicom(value, { untilTag: 'x7fe00010' }),
            study,
            series,
            instance
          );
          if (disposed || value.byteLength > cached.remaining()) return;
          cached.put(study, series, instance, value, false);
        }
      }
    })().catch(() => {
      /* Background errors stop prefetch; foreground validates and reports independently. */
    });
  };
  return {
    fetch: Object.assign(fetch, {
      invalidate: (ticket: string) => {
        const entry = originals.get(ticket);
        if (entry) cached.remove(study, entry.series, entry.instance);
      },
    }),
    select,
    complete,
    dispose: () => {
      disposed = true;
      pause();
      if (!reviewCache) cached.dispose();
    },
  };
};
export type DicomStudyPrefetch = ReturnType<typeof createDicomStudyPrefetch>;
