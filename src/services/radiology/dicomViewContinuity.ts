import {
  Enums,
  type RenderingEngine,
  type StackViewport,
  type VolumeViewport,
} from '@cornerstonejs/core';
import { waitForDicomRender } from './dicomRenderReady';
import { dicomGraphicsContexts } from './dicomGraphicsResources';

type View = StackViewport | VolumeViewport;
type Snapshot = {
  camera: ReturnType<View['getCamera']>;
  properties: ReturnType<View['getProperties']>;
  stack?: { imageId: string; pan: ReturnType<StackViewport['getPan']>; zoom: number };
};
export type DicomGraphicsState = 'ready' | 'recovering' | 'failed';

/** Session-only camera/VOI state. No pixels, persistence or telemetry. */
export const createDicomViewContinuity = (
  engine: () => RenderingEngine | undefined,
  replace: () => Promise<void>,
  signal: AbortSignal,
  invalidate: () => void = () => {},
  restored: () => void = () => {}
) => {
  const snapshots = new Map<string, Snapshot[]>();
  const listeners = new Set<(state: DicomGraphicsState) => void>();
  let state: DicomGraphicsState = 'ready';
  let current: { key: string; elements: HTMLDivElement[]; build: () => Promise<void> } | undefined;
  let remove = () => {};
  let queued = Promise.resolve();
  let version = 0;
  let attempts = 0;
  let stopped = false;
  let saveEnabled = false;
  const emit = (next: DicomGraphicsState) => {
    state = next;
    listeners.forEach(listener => listener(next));
  };
  const save = () => {
    if (!current || !saveEnabled || state !== 'ready') return;
    const views = engine()?.getViewports() as View[] | undefined;
    if (views?.length && views.every(view => view.element.isConnected))
      snapshots.set(
        current.key,
        views.map(view => ({
          camera: structuredClone(view.getCamera()),
          properties: structuredClone(view.getProperties()),
          stack:
            view.type === Enums.ViewportType.STACK
              ? {
                  imageId: (view as StackViewport).getCurrentImageId(),
                  pan: view.getPan(),
                  zoom: view.getZoom(),
                }
              : undefined,
        }))
      );
  };
  const restore = () => {
    const saved = current && snapshots.get(current.key);
    (engine()?.getViewports() as View[] | undefined)?.forEach((view, i) => {
      if (!saved?.[i]) return;
      view.setProperties(saved[i].properties ?? undefined);
      const stack = saved[i].stack;
      if (stack && (view as StackViewport).getCurrentImageId() !== stack.imageId) {
        // A requested cut may finish during recovery: retain zoom/pan, never the old image plane.
        view.setPan(stack.pan);
        view.setZoom(stack.zoom);
      } else view.setCamera(saved[i].camera);
    });
  };
  const bind = () => {
    remove();
    const target = engine();
    if (!target) return;
    const views = target.getViewports();
    const contexts = dicomGraphicsContexts(target);
    const changed = () => save();
    const lost = (event: Event) => {
      event.preventDefault();
      if (state !== 'ready' || stopped) return;
      // The last healthy camera state is already in RAM; never query a lost context here.
      void recover().catch(() => undefined);
    };
    const events = [Enums.Events.CAMERA_MODIFIED, Enums.Events.VOI_MODIFIED];
    views.forEach(view => events.forEach(event => view.element.addEventListener(event, changed)));
    contexts.forEach(gl => gl.canvas.addEventListener('webglcontextlost', lost));
    remove = () => {
      views.forEach(view =>
        events.forEach(event => view.element.removeEventListener(event, changed))
      );
      contexts.forEach(gl => gl.canvas.removeEventListener('webglcontextlost', lost));
    };
  };
  const run = (task: () => Promise<void>) => {
    const result = queued.catch(() => undefined).then(task);
    queued = result.catch(() => undefined);
    return result;
  };
  const recover = () => {
    if (!current || stopped || state === 'recovering') return queued;
    const revision = version;
    invalidate();
    emit('recovering');
    remove();
    current.elements.forEach(element => {
      element.style.visibility = 'hidden';
    });
    return run(async () => {
      if (stopped || signal.aborted || revision !== version) return;
      try {
        if (++attempts > 2) throw new Error('Límite de recuperación gráfica.');
        await replace();
        signal.throwIfAborted();
        if (stopped || revision !== version) return;
        await current!.build();
        signal.throwIfAborted();
        if (stopped || revision !== version) return;
        restore();
        restored();
        await waitForDicomRender(current!.elements, () => engine()?.render(), signal);
        await waitForDicomRender(current!.elements, () => engine()?.render(), signal);
        if (dicomGraphicsContexts(engine()!).some(gl => gl.isContextLost()))
          throw new Error('Contexto gráfico no disponible.');
        current!.elements.forEach(element => {
          element.style.visibility = '';
        });
        emit('ready');
        saveEnabled = true;
        save();
        bind();
      } catch {
        if (!stopped && revision === version) emit('failed');
      }
    });
  };
  return {
    subscribe: (listener: (value: DicomGraphicsState) => void) => {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    show: (key: string, elements: HTMLDivElement[], build: () => Promise<void>) => {
      save();
      remove();
      saveEnabled = false;
      const revision = ++version;
      return run(async () => {
        if (stopped || revision !== version) return;
        signal.throwIfAborted();
        current = { key, elements, build };
        await build();
        signal.throwIfAborted();
        if (stopped || revision !== version) return;
        restore();
        restored();
        await waitForDicomRender(elements, () => engine()?.render(), signal);
        await waitForDicomRender(elements, () => engine()?.render(), signal);
        elements.forEach(element => {
          element.style.visibility = '';
        });
        emit('ready');
        saveEnabled = true;
        save();
        bind();
      }).catch(async error => {
        if (
          !stopped &&
          revision === version &&
          engine() &&
          dicomGraphicsContexts(engine()!).some(gl => gl.isContextLost())
        ) {
          emit('ready');
          await recover();
          if (state === 'ready') return;
        }
        throw error;
      });
    },
    suspend: () => {
      save();
      remove();
      ++version;
      current = undefined;
      saveEnabled = false;
      return queued;
    },
    dispose: () => {
      stopped = true;
      ++version;
      remove();
      current = undefined;
      snapshots.clear();
      listeners.clear();
      return queued;
    },
  };
};
