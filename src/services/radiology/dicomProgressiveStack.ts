import { abortableDicomTask } from './dicomCine';
import type { StackViewport } from '@cornerstonejs/core';
import type { ProgressiveDicomSeries } from './dicomSeriesLoader';

export interface DicomStackState {
  current: number | null;
  requested: number;
  pending: boolean;
  error: string;
}

/** Keeps missing slots explicit and serializes presentation so late reads cannot replace a newer cut. */
export const createProgressiveStack = (source: ProgressiveDicomSeries, total: number) => {
  let viewport: StackViewport | undefined;
  let state: DicomStackState = {
    current: null,
    requested: source.initialIndex,
    pending: true,
    error: '',
  };
  let listener: ((value: DicomStackState) => void) | undefined;
  let sequence = 0;
  let locked = false;
  let rendering = Promise.resolve();
  let detach = () => {};
  const emit = (patch: Partial<DicomStackState>) => {
    state = { ...state, ...patch };
    listener?.(state);
  };
  const select = async (requested: number, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const index = Math.max(0, Math.min(total - 1, Math.round(requested)));
    if (!Number.isFinite(index)) return;
    const requestVersion = ++sequence;
    const target = viewport;
    emit({ requested: index, pending: true, error: '' });
    try {
      const request = source.request(index);
      const id = await (signal ? abortableDicomTask(request, signal) : request);
      signal?.throwIfAborted();
      if (!target || requestVersion !== sequence) return;
      const task = rendering
        .catch(() => undefined)
        .then(async () => {
          if (requestVersion !== sequence || target !== viewport) return;
          const previous =
            state.current === null
              ? null
              : {
                  properties: target.getProperties(),
                  pan: target.getPan(),
                  zoom: target.getZoom(),
                };
          signal?.throwIfAborted();
          await target.setStack([id]);
          if (previous) {
            target.setProperties(previous.properties);
            target.setPan(previous.pan);
            target.setZoom(previous.zoom);
          }
          signal?.throwIfAborted();
          if (requestVersion !== sequence || target !== viewport) return;
          target.render();
          emit({ current: index, pending: false });
        });
      rendering = task;
      await task;
    } catch (error) {
      if (signal) throw error;
      if (requestVersion === sequence && viewport)
        emit({
          pending: false,
          error: 'No se pudo mostrar el corte solicitado. Vuelve a abrir el estudio.',
        });
    }
  };
  const step = (delta: number) => {
    if (!locked) void select(state.requested + delta);
  };
  return {
    select: (index: number) => {
      if (!locked) void select(index);
    },
    lock: (value: boolean) => {
      locked = value;
    },
    selectAndWait: select,
    step,
    state: () => state,
    subscribe: (next: (value: DicomStackState) => void) => {
      listener = next;
      next(state);
      return () => {
        if (listener === next) listener = undefined;
      };
    },
    show: async (target: StackViewport) => {
      detach();
      viewport = target;
      emit({ current: null });
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        if (event.deltaY) step(Math.sign(event.deltaY));
      };
      const wheelTarget = target.element.parentElement ?? target.element;
      wheelTarget.addEventListener('wheel', wheel, { passive: false });
      detach = () => wheelTarget.removeEventListener('wheel', wheel);
      await select(state.requested);
    },
    detach: () => {
      ++sequence;
      detach();
      viewport = undefined;
      return rendering.catch(() => undefined);
    },
  };
};
