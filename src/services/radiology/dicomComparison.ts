import { RenderingEngine, Enums, type StackViewport, type Types } from '@cornerstonejs/core';
import {
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import type { DicomStudy, DicomSeries } from './dicomTypes';
import {
  startDicomSeries,
  type LoadedDicomSeries,
  type ProgressiveDicomSeries,
} from './dicomSeriesLoader';
import { createProgressiveStack, type DicomStackState } from './dicomProgressiveStack';
import {
  comparisonPlane,
  comparisonReferenceLine,
  nearestComparisonSlice,
} from './dicomComparisonGeometry';
import { getDicomOrientations, observeDicomViewportSize } from './dicomViewportLayout';
import type { fetchDicomInstance } from './mmradDicomService';

export interface ComparisonLinks {
  position: boolean;
  zoom: boolean;
  window: boolean;
}
export interface ComparisonState {
  stacks: DicomStackState[];
  ready: number[];
  positionStatus: string;
  windowCompatible: boolean;
  orientations: ReturnType<typeof getDicomOrientations>;
  lines: Array<number[][] | null>;
  error: string;
  failed: number;
}

/** Owns only the secondary source. Primary images and decoded cache remain owned by the viewer. */
export const createDicomComparison = (
  study: DicomStudy,
  primary: DicomSeries,
  secondary: DicomSeries,
  source: ProgressiveDicomSeries,
  primaryLoaded: LoadedDicomSeries,
  elements: HTMLDivElement[],
  signal: AbortSignal,
  notify: (state: ComparisonState) => void,
  fetchInstance?: typeof fetchDicomInstance,
  initialIndex = source.initialIndex
) => {
  signal.throwIfAborted();
  const controller = new AbortController();
  const childSignal = AbortSignal.any([signal, controller.signal]);
  const same = primary.uid === secondary.uid;
  const id = `compare-${crypto.randomUUID()}`;
  const engine = new RenderingEngine(id);
  let disposed = false,
    active = 0,
    applying = false;
  let links: ComparisonLinks = { position: true, zoom: false, window: false };
  let lastPosition = '';
  const ready = [primary.instances.length, same ? primary.instances.length : 0];
  const loaded: Array<LoadedDicomSeries | undefined> = [
    primaryLoaded,
    same ? primaryLoaded : undefined,
  ];
  const removers: Array<() => void> = [];
  const groups: string[] = [];
  let second: ProgressiveDicomSeries | undefined;
  let resize: ResizeObserver | undefined;
  let error = '';
  let failed = 0;
  let disposal: Promise<void> | undefined;
  let stacks: ReturnType<typeof createProgressiveStack>[] = [];
  let views: StackViewport[] = [];
  const canWindow = () =>
    same ||
    (primary.modality === 'CT' &&
      secondary.modality === 'CT' &&
      loaded.every(value => value?.huCalibrated));
  const slice = (panel: number) => {
    const state = stacks[panel]?.state();
    return state && !state.pending && !state.error && state.current !== null
      ? loaded[panel]?.geometry[state.current]
      : undefined;
  };
  const emit = () => {
    if (disposed || stacks.length !== 2) return;
    const from = slice(active),
      other = 1 - active;
    let positionStatus = links.position ? 'Geometría pendiente' : 'Posición independiente';
    if (links.position && from && loaded[other]) {
      const index = nearestComparisonSlice(from, loaded[other]!.geometry);
      positionStatus = index === null ? 'Sin correspondencia geométrica' : 'Posición vinculada';
      const key = `${active}:${stacks[active].state().current}:${index}`;
      if (index !== null && key !== lastPosition) {
        lastPosition = key;
        if (stacks[other].state().requested !== index) stacks[other].select(index);
      }
    }
    const lines = views.map((viewport, index) => {
      const a = slice(1 - index),
        b = slice(index);
      const line = a && b ? comparisonReferenceLine(a, b) : null;
      return line?.map(point => viewport.worldToCanvas(point as Types.Point3)) ?? null;
    });
    notify({
      stacks: stacks.map(stack => stack.state()),
      ready: [...ready],
      positionStatus,
      windowCompatible: canWindow(),
      lines,
      error,
      failed,
      orientations:
        views.length === 2
          ? getDicomOrientations(
              engine,
              views.map(view => view.id)
            ).map((orientation, panel) => {
              const geometry = slice(panel);
              return geometry && comparisonPlane(geometry)
                ? orientation
                : { top: '', right: '', bottom: '', left: '' };
            })
          : [],
    });
  };
  const applyLinks = () => {
    if (disposed || applying || !slice(active) || !slice(1 - active)) return;
    applying = true;
    try {
      const from = views[active],
        to = views[1 - active];
      if (links.zoom) to.setCamera({ parallelScale: from.getCamera().parallelScale });
      if (links.window && canWindow()) {
        const { voiRange, invert } = from.getProperties();
        to.setProperties({ voiRange, invert });
      }
      if (links.zoom || (links.window && canWindow())) to.render();
    } finally {
      applying = false;
    }
  };
  const dispose = () => {
    if (disposed) return disposal!;
    disposed = true;
    controller.abort();
    resize?.disconnect();
    removers.forEach(remove => remove());
    groups.forEach(group => ToolGroupManager.destroyToolGroup(group));
    const presentation = stacks.map(stack => stack.detach());
    views.forEach(view => view.getCanvas().remove());
    second?.cancel();
    disposal = Promise.all([...presentation, second?.settled])
      .finally(() => engine.destroy())
      .then(
        () => undefined,
        () => undefined
      );
    return disposal;
  };
  signal.addEventListener('abort', dispose, { once: true });
  removers.push(() => signal.removeEventListener('abort', dispose));
  try {
    if (!same) {
      second = startDicomSeries(
        study,
        secondary,
        childSignal,
        count => {
          ready[1] = count;
          emit();
        },
        fetchInstance
      );
      second.loading.setLimit(2);
      removers.push(
        second.loading.subscribe(state => {
          failed = state.failed.length;
          emit();
        })
      );
      void second.completion
        .then(value => {
          if (disposed) return;
          loaded[1] = value;
          emit();
        })
        .catch(() => {
          if (disposed) return;
          error = 'No se pudo validar o completar la segunda serie.';
          // Fatal identity/decoder failure must never leave a previous image looking usable.
          controller.abort();
          stacks.forEach(stack => void stack.detach());
          views.forEach(view => (view.getCanvas().style.visibility = 'hidden'));
          emit();
        });
    }
    stacks = [
      createProgressiveStack(source, primary.instances.length),
      createProgressiveStack(second ?? source, secondary.instances.length),
    ];
    engine.setViewports(
      elements.map((element, panel) => ({
        viewportId: `${id}-${panel}`,
        element,
        type: Enums.ViewportType.STACK,
        defaultOptions: { background: [0, 0, 0] as Types.Point3 },
      }))
    );
    views = elements.map((_, panel) => engine.getViewport(`${id}-${panel}`) as StackViewport);
    views.forEach((view, panel) => {
      const group = ToolGroupManager.createToolGroup(`${id}-tools-${panel}`);
      if (!group) throw new Error('No se pudieron preparar las herramientas de comparación.');
      groups.push(group.id);
      [WindowLevelTool, PanTool, ZoomTool].forEach(tool => group.addTool(tool.toolName));
      group.addViewport(view.id, id);
      group.setToolActive(WindowLevelTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
      const update = () => {
        if (applying || disposed) return;
        if (panel === active) applyLinks();
        emit();
      };
      [Enums.Events.CAMERA_MODIFIED, Enums.Events.VOI_MODIFIED].forEach(event => {
        view.element.addEventListener(event, update);
        removers.push(() => view.element.removeEventListener(event, update));
      });
      removers.push(
        stacks[panel].subscribe(() => {
          applyLinks();
          emit();
        })
      );
    });
    stacks[0].select(initialIndex);
    if (same) stacks[1].select(initialIndex);
    views.forEach((view, panel) => {
      void stacks[panel]
        .show(view)
        .then(() => {
          if (disposed || childSignal.aborted) return;
          if (same && panel === 1 && primary.modality === 'CT') {
            view.setProperties({ voiRange: { lower: -1350, upper: 150 } });
            view.render();
          }
          emit();
        })
        .catch(() => {
          if (!disposed) {
            error = 'No se pudo preparar la comparación.';
            emit();
          }
        });
    });
    resize = observeDicomViewportSize(engine, elements, () => disposed);
    emit();
  } catch (reason) {
    dispose();
    throw reason;
  }
  return {
    dispose,
    activate: (panel: number) => {
      if (active !== panel) {
        active = panel;
        lastPosition = '';
        emit();
      }
    },
    link: (value: ComparisonLinks) => {
      links = value;
      lastPosition = '';
      applyLinks();
      emit();
    },
    select: (panel: number, index: number) => {
      if (!error && !disposed) {
        active = panel;
        stacks[panel].select(index);
      }
    },
    step: (panel: number, delta: number) => {
      if (!error && !disposed) {
        active = panel;
        stacks[panel].step(delta);
      }
    },
    retry: () => second?.loading.retryFailed(),
    tool: (tool: 'window' | 'pan' | 'zoom') => {
      const candidates = { window: WindowLevelTool, pan: PanTool, zoom: ZoomTool };
      const group = ToolGroupManager.getToolGroup(groups[active]);
      Object.values(candidates).forEach(item => group?.setToolPassive(item.toolName));
      group?.setToolActive(candidates[tool].toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
    },
    window: (width: number, center: number) => {
      views[active].setProperties({
        voiRange: { lower: center - width / 2, upper: center + width / 2 },
      });
      applyLinks();
      views[active].render();
    },
    reset: () => {
      views[active].resetCamera();
      views[active].render();
    },
  };
};
export type DicomComparison = ReturnType<typeof createDicomComparison>;
