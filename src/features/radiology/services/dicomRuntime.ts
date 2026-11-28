import { destroyDicomToolGroup } from './dicomToolLifecycle';
import { activateDicomTool } from './dicomToolActivation';
import { createDicomViewContinuity } from './dicomViewContinuity';
import { destroyDicomEngine, resetDicomVolumeGraphics } from './dicomGraphicsResources';
import { createDicomRuntimeNavigation, resetDicomCamera } from './dicomRuntimeNavigation';
import { createMprMemory, type MprReconstructionState } from './dicomMprReconstruction';
import { createDicomComparisonOwner } from './dicomComparisonOwner';
import type { fetchDicomInstance } from './mmradDicomService';
import { describeDicomPlaneSlices } from './dicomVolumeVideo';
import { initializeDicom as initialize } from './dicomInitialization';
import { RenderingEngine, type VolumeViewport, type VolumeViewport3D } from '@cornerstonejs/core';
import { captureRuntimeView } from './dicomRuntimeCapture';
import type { DicomReference } from './dicomMprTools';
import { applyVolumePresentation } from './dicomVolumePresentation';
import { defaultVolumePresentation } from './dicomPresentation';
import {
  startDicomSeries,
  type LoadedDicomSeries,
  type ProgressiveDicomSeries,
} from './dicomSeriesLoader';
import { createProgressiveStack } from './dicomProgressiveStack';
import { getRuntimeOrientations } from './dicomViewportLayout';
import type { DicomStudy, DicomSeries } from '@/domain/radiology/dicomTypes';
import type { DicomTool, DicomOrientation, DicomRuntime } from './dicomRuntimeTypes';
import { createDicomMeasurementStore, type DicomMeasurementStore } from './dicomMeasurementStore';
import { dicomSliceInterval } from './dicomVolumeEstimates';
import {
  openDicomRuntimeCine,
  openDicomRuntimeComparison,
  openDicomRuntimeVolumeVideo,
  retainDicomRuntime,
} from './dicomRuntimeLifecycle';
import { mountDicomRuntimeView, type DicomRuntimeViewState } from './dicomRuntimeViewMount';

export type { DicomTool, DicomMode, DicomOrientation, DicomRuntime } from './dicomRuntimeTypes';

export const createDicomRuntime = async (
  study: DicomStudy,
  series: DicomSeries,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void,
  fetchInstance?: typeof fetchDicomInstance,
  measurements: DicomMeasurementStore = createDicomMeasurementStore()
): Promise<DicomRuntime> => {
  const releaseRuntime = retainDicomRuntime();
  let engine: RenderingEngine | undefined;
  let loaded: LoadedDicomSeries | undefined;
  let source: ProgressiveDicomSeries | undefined;
  let stack: ReturnType<typeof createProgressiveStack> | undefined;
  let disposed = false;
  const comparisons = createDicomComparisonOwner();
  let cursorListener: ((value: number | null) => void) | undefined;
  let referenceListener: ((value: DicomReference | null) => void) | undefined;
  let activeTool: DicomTool = 'window';
  let graphicsController = new AbortController();
  const mprMemory = createMprMemory();
  const view: DicomRuntimeViewState = {
    mode: 'original',
    volume: undefined,
    volumePresentation: defaultVolumePresentation(series.modality),
    viewportIds: [],
    group: undefined,
    stackTools: undefined,
    mpr: undefined,
    reconstruction: undefined,
    referenceEnabled: true,
    referenceStyle: 'lines',
    referenceValue: null,
    recoveringTool: undefined,
    stopCursor: undefined,
    resize: undefined,
  };
  /** Takes this view's drawings off screen; the store keeps them for a later return. */
  const releaseTools = () => {
    view.stopCursor?.();
    view.stopCursor = undefined;
    view.stackTools?.dispose();
    view.stackTools = undefined;
    view.mpr?.dispose();
    view.mpr = undefined;
  };
  const reconstructionListeners = new Set<(state: MprReconstructionState | null) => void>();
  const notifyReconstruction = (state: MprReconstructionState | null) => {
    view.mpr?.quantitative(Boolean(state?.quantitative));
    reconstructionListeners.forEach(listener => listener(state));
  };
  const notifyReference = (value: DicomReference | null) => {
    view.referenceValue = value;
    referenceListener?.(value);
  };
  const id = `dicom-${crypto.randomUUID()}`;
  const volumeId = `cornerstoneStreamingImageVolume:${id}`;
  const continuity = createDicomViewContinuity(
    () => engine,
    async () => {
      view.recoveringTool = activeTool;
      mprMemory.remember(view.reconstruction?.state(), view.referenceValue);
      view.resize?.disconnect();
      view.reconstruction?.dispose();
      view.reconstruction = undefined;
      releaseTools();
      if (view.group) destroyDicomToolGroup(view.group.id);
      view.group = undefined;
      await stack?.detach();
      signal.throwIfAborted();
      if (disposed) return;
      if (engine) {
        resetDicomVolumeGraphics(engine, volumeId);
        destroyDicomEngine(engine);
      }
      engine = new RenderingEngine(id);
      graphicsController = new AbortController();
    },
    signal,
    () => graphicsController.abort(),
    () => view.mode === 'mpr' && view.referenceEnabled && view.mpr?.refresh()
  );
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    graphicsController.abort();
    const graphics = continuity.dispose();
    const comparing = comparisons.close();
    view.resize?.disconnect();
    view.reconstruction?.dispose();
    view.reconstruction = undefined;
    releaseTools();
    cursorListener = undefined;
    if (view.group) destroyDicomToolGroup(view.group.id);
    const presentation = stack?.detach();
    // Detach this session's canvases now; Cornerstone.destroy clears but retains their DOM nodes.
    engine?.getViewports().forEach(viewport => viewport.getCanvas().remove());
    source?.cancel();
    void Promise.all([presentation, source?.settled, comparing, graphics])
      .finally(() => {
        try {
          if (engine) destroyDicomEngine(engine);
        } finally {
          try {
            view.volume?.release();
          } finally {
            releaseRuntime();
          }
        }
      })
      .catch(() => undefined);
  };
  try {
    await initialize();
    signal.throwIfAborted();
    source = startDicomSeries(study, series, signal, progress, fetchInstance);
    stack = createProgressiveStack(source, series.instances.length);
    signal.throwIfAborted();
    engine = new RenderingEngine(id);
  } catch (error) {
    dispose();
    throw error;
  }
  const ensureActive = () => {
    signal.throwIfAborted();
    if (disposed) throw new Error('El visor está cerrado.');
  };
  let interval: number | undefined | null = null;
  const quantitative = () =>
    !disposed &&
    view.mode === 'mpr' &&
    Boolean(loaded?.huCalibrated) &&
    Boolean(view.reconstruction?.state().quantitative);
  const activateTool = (tool: DicomTool) =>
    activateDicomTool(tool, {
      group: view.group,
      mode: view.mode,
      mpr: view.mpr,
      stack: view.stackTools,
      reconstruction: view.reconstruction,
      calibrated: Boolean(loaded?.huCalibrated),
      referenceEnabled: view.referenceEnabled,
      referenceStyle: view.referenceStyle,
      active: value => {
        activeTool = value;
      },
    });
  const orientations = (): DicomOrientation[] =>
    getRuntimeOrientations(
      engine,
      view.viewportIds,
      view.mode,
      disposed,
      Boolean(source?.hasOrientation(stack?.state().current ?? source.initialIndex))
    );
  const completion = source!.completion
    .then(value => {
      loaded = value;
    })
    .catch(error => {
      dispose();
      throw error;
    });
  void completion.catch(() => undefined);
  return {
    ...createDicomRuntimeNavigation(() => ({
      engine,
      viewportIds: view.viewportIds,
      mode: view.mode,
      disposed,
      stack,
    })),
    sessionId: id,
    onGraphics: continuity.subscribe,
    loading: source!.loading,
    completion,
    compare: (secondary, elements, childSignal, notify) =>
      openDicomRuntimeComparison({
        study,
        series,
        secondary,
        elements,
        childSignal,
        notify,
        source: source!,
        getLoaded: () => loaded,
        stack: stack!,
        measurements,
        fetchInstance,
        continuity,
        comparisons,
        completion,
        signal,
        ensureActive,
        onBeforeOpen: () => {
          view.mpr?.cancel();
          // Comparar draws this series' measurements itself; Original redraws them on return.
          view.stopCursor?.();
          view.stackTools?.dispose();
          view.stackTools = undefined;
          view.resize?.disconnect();
        },
      }),
    onReconstruction: listener => {
      reconstructionListeners.add(listener);
      listener(view.reconstruction?.state() ?? null);
      return () => {
        reconstructionListeners.delete(listener);
      };
    },
    reconstruct: patch => {
      if (disposed || view.mode !== 'mpr' || !view.reconstruction || !view.mpr) return;
      view.mpr.cancel();
      if (patch) view.reconstruction.update(patch);
      else view.reconstruction.reset();
      const state = view.reconstruction.state();
      view.mpr.oblique(state.rotate);
      if (state.rotate) [view.referenceEnabled, view.referenceStyle] = [true, 'lines'];
      activateTool(state.rotate ? 'reference' : 'window');
    },
    openCine: options =>
      openDicomRuntimeCine({
        engine,
        stack,
        mode: view.mode,
        viewportIds: view.viewportIds,
        totalInstances: series.instances.length,
        orientations,
        signal,
        graphicsSignal: graphicsController.signal,
        ensureActive,
        restoreSlice: options?.restoreSlice,
      }),
    openVideo: request =>
      openDicomRuntimeVolumeVideo({
        getEngine: () => engine,
        mode: view.mode,
        viewportIds: view.viewportIds,
        getReconstruction: () => view.reconstruction,
        resampled: Boolean(view.volume?.resampled),
        request,
        signal,
        graphicsSignal: graphicsController.signal,
        ensureActive,
        hold: continuity.hold,
        orientations,
      }),
    mprSlices: plane => {
      const targetViewportId = view.viewportIds[plane];
      return view.mode === 'mpr' && !disposed && engine && targetViewportId
        ? describeDicomPlaneSlices(engine.getViewport(targetViewportId) as VolumeViewport)
        : null;
    },
    select: index => {
      if (view.mode === 'original' && !disposed) stack?.select(index);
    },
    onStack: listener => stack!.subscribe(listener),
    dispose,
    orientations,
    onReference: listener => {
      referenceListener = listener;
      listener(view.referenceValue);
      return () => {
        if (referenceListener === listener) referenceListener = undefined;
      };
    },
    reference: (enabled, style) => {
      view.referenceEnabled = enabled;
      view.referenceStyle = style;
      if (view.mode === 'mpr') {
        if (!enabled && activeTool === 'reference') activateTool('window');
        view.mpr?.reference(enabled, style);
        engine?.render();
      }
    },
    undoMeasurement: () => {
      view.mpr?.undo();
      view.stackTools?.undo();
      engine?.render();
    },
    clearMeasurements: () => {
      view.mpr?.clear();
      view.stackTools?.clear();
      engine?.render();
    },
    measurements,
    focusMeasurement: measurementId => {
      const item = measurements.get(measurementId);
      if (disposed || !item || item.seriesUid !== series.uid) return false;
      if (view.mode === 'original' && item.view === 'original' && stack) {
        stack.select(item.slice);
        return true;
      }
      return (
        view.mode === 'mpr' && item.view !== 'original' && Boolean(view.mpr?.focus(measurementId))
      );
    },
    sliceInterval: () => {
      if (loaded && interval === null) interval = dicomSliceInterval(loaded.geometry);
      return interval ?? undefined;
    },
    onCursorHu: listener => {
      cursorListener = listener;
      return () => {
        if (cursorListener === listener) cursorListener = undefined;
      };
    },
    presentation: value => {
      const firstViewportId = view.viewportIds[0];
      if (view.mode === '3d' && !disposed && engine && firstViewportId) {
        view.volumePresentation = value;
        applyVolumePresentation(
          engine.getViewport(firstViewportId) as VolumeViewport3D,
          value,
          series.modality
        );
      }
    },
    isResampled: () => view.mode !== 'original' && Boolean(view.volume?.resampled),
    quantitative,
    show: (nextMode, elements) =>
      continuity.show(nextMode, elements, async () => {
        if (!engine) return;
        await mountDicomRuntimeView({
          id,
          volumeId,
          series,
          nextMode,
          elements,
          engine,
          comparisons,
          completion,
          source: source!,
          getLoaded: () => loaded,
          stack: stack!,
          measurements,
          mprMemory,
          signal,
          ensureActive,
          isDisposed: () => disposed,
          quantitative,
          activateTool,
          notifyReference,
          notifyReconstruction,
          onCursorHu: value => cursorListener?.(value),
          releaseTools,
          view,
        });
      }),
    tool: activateTool,
    reset: () => {
      if (!engine || disposed) return;
      if (view.mode === 'mpr' && view.reconstruction) {
        view.mpr?.cancel();
        view.reconstruction.reset();
        view.mpr?.oblique(false);
        activateTool(activeTool);
        return;
      }
      resetDicomCamera(engine, view.viewportIds);
    },
    capture: plane =>
      captureRuntimeView({
        engine,
        stack: stack!,
        series,
        mode: view.mode,
        plane,
        signal: AbortSignal.any([signal, graphicsController.signal]),
        ensureActive,
        resampled: Boolean(view.volume?.resampled),
        reconstructionLabel:
          view.mode === 'mpr' ? () => view.reconstruction?.state().planes[plane]?.label : undefined,
        orientations,
      }),
  };
};
