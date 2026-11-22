import { destroyDicomToolGroup } from './dicomToolLifecycle';
import { activateDicomTool } from './dicomToolActivation';
import { createDicomViewContinuity } from './dicomViewContinuity';
import { destroyDicomEngine, resetDicomVolumeGraphics } from './dicomGraphicsResources';
import { configureDicomViewports } from './dicomViewportSetup';
import { createDicomRuntimeNavigation, resetDicomCamera } from './dicomRuntimeNavigation';
import {
  createMprReconstruction,
  createMprMemory,
  type MprReconstructionState,
} from './dicomMprReconstruction';
import { createDicomComparisonOwner } from './dicomComparisonOwner';
import type { fetchDicomInstance } from './mmradDicomService';
import { describeDicomPlaneSlices } from './dicomVolumeVideo';
import { initializeDicom as initialize } from './dicomInitialization';
import {
  RenderingEngine,
  setVolumesForViewports,
  type StackViewport,
  type VolumeViewport,
  type VolumeViewport3D,
} from '@cornerstonejs/core';
import { ToolGroupManager, CrosshairsTool } from '@cornerstonejs/tools';
import { captureRuntimeView } from './dicomRuntimeCapture';
import { createMprTools, type DicomReference, type ReferenceStyle } from './dicomMprTools';
import { applyVolumePresentation } from './dicomVolumePresentation';
import { defaultVolumePresentation } from './dicomPresentation';
import type { DicomVolumeHandle } from './dicomVolume';
import {
  startDicomSeries,
  type LoadedDicomSeries,
  type ProgressiveDicomSeries,
} from './dicomSeriesLoader';
import { createProgressiveStack } from './dicomProgressiveStack';
import { getRuntimeOrientations, observeDicomViewportSize } from './dicomViewportLayout';
import type { DicomStudy, DicomSeries } from '@/domain/radiology/dicomTypes';
import type { DicomTool, DicomMode, DicomOrientation, DicomRuntime } from './dicomRuntimeTypes';
import { createDicomMeasurementStore, type DicomMeasurementStore } from './dicomMeasurementStore';
import { createDicomStackTools, type DicomStackToolSession } from './dicomStackTools';
import { dicomStackShowsHu, watchDicomCursorHu } from './dicomCursorValue';
import { dicomSliceInterval } from './dicomVolumeEstimates';
import {
  ensureDicomRuntimeVolume,
  openDicomRuntimeCine,
  openDicomRuntimeComparison,
  openDicomRuntimeVolumeVideo,
  retainDicomRuntime,
} from './dicomRuntimeLifecycle';

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
  let volume: DicomVolumeHandle | undefined;
  let mode: DicomMode = 'original';
  let viewportIds: string[] = [];
  let resize: ResizeObserver | undefined;
  let mpr: ReturnType<typeof createMprTools> | undefined;
  let stackTools: DicomStackToolSession | undefined;
  let stopCursor: (() => void) | undefined;
  let cursorListener: ((value: number | null) => void) | undefined;
  /** Takes this view's drawings off screen; the store keeps them for a later return. */
  const releaseTools = () => {
    stopCursor?.();
    stopCursor = undefined;
    stackTools?.dispose();
    stackTools = undefined;
    mpr?.dispose();
    mpr = undefined;
  };
  let reconstruction: ReturnType<typeof createMprReconstruction> | undefined;
  const reconstructionListeners = new Set<(state: MprReconstructionState | null) => void>();
  const notifyReconstruction = (state: MprReconstructionState | null) => {
    mpr?.quantitative(Boolean(state?.quantitative));
    reconstructionListeners.forEach(listener => listener(state));
  };
  const mprMemory = createMprMemory();
  let volumePresentation = defaultVolumePresentation(series.modality);
  let referenceEnabled = true;
  let referenceStyle: ReferenceStyle = 'lines';
  let activeTool: DicomTool = 'window';
  let recoveringTool: DicomTool | undefined;
  let graphicsController = new AbortController();
  let referenceListener: ((value: DicomReference | null) => void) | undefined;
  let referenceValue: DicomReference | null = null;
  const notifyReference = (value: DicomReference | null) => {
    referenceValue = value;
    referenceListener?.(value);
  };
  const id = `dicom-${crypto.randomUUID()}`;
  const volumeId = `cornerstoneStreamingImageVolume:${id}`;
  let group: ReturnType<typeof ToolGroupManager.createToolGroup>;
  const continuity = createDicomViewContinuity(
    () => engine,
    async () => {
      recoveringTool = activeTool;
      mprMemory.remember(reconstruction?.state(), referenceValue);
      resize?.disconnect();
      reconstruction?.dispose();
      reconstruction = undefined;
      releaseTools();
      if (group) destroyDicomToolGroup(group.id);
      group = undefined;
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
    () => mode === 'mpr' && referenceEnabled && mpr?.refresh()
  );
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    graphicsController.abort();
    const graphics = continuity.dispose();
    const comparing = comparisons.close();
    resize?.disconnect();
    reconstruction?.dispose();
    reconstruction = undefined;
    releaseTools();
    cursorListener = undefined;
    if (group) destroyDicomToolGroup(group.id);
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
            volume?.release();
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
    mode === 'mpr' &&
    Boolean(loaded?.huCalibrated) &&
    Boolean(reconstruction?.state().quantitative);
  const activateTool = (tool: DicomTool) =>
    activateDicomTool(tool, {
      group,
      mode,
      mpr,
      stack: stackTools,
      reconstruction,
      calibrated: Boolean(loaded?.huCalibrated),
      referenceEnabled,
      referenceStyle,
      active: value => {
        activeTool = value;
      },
    });
  const orientations = (): DicomOrientation[] =>
    getRuntimeOrientations(
      engine,
      viewportIds,
      mode,
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
    ...createDicomRuntimeNavigation(() => ({ engine, viewportIds, mode, disposed, stack })),
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
          mpr?.cancel();
          // Comparar draws this series' measurements itself; Original redraws them on return.
          stopCursor?.();
          stackTools?.dispose();
          stackTools = undefined;
          resize?.disconnect();
        },
      }),
    onReconstruction: listener => {
      reconstructionListeners.add(listener);
      listener(reconstruction?.state() ?? null);
      return () => {
        reconstructionListeners.delete(listener);
      };
    },
    reconstruct: patch => {
      if (disposed || mode !== 'mpr' || !reconstruction || !mpr) return;
      mpr.cancel();
      if (patch) reconstruction.update(patch);
      else reconstruction.reset();
      const state = reconstruction.state();
      mpr.oblique(state.rotate);
      if (state.rotate) [referenceEnabled, referenceStyle] = [true, 'lines'];
      activateTool(state.rotate ? 'reference' : 'window');
    },
    openCine: options =>
      openDicomRuntimeCine({
        engine,
        stack,
        mode,
        viewportIds,
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
        mode,
        viewportIds,
        getReconstruction: () => reconstruction,
        resampled: Boolean(volume?.resampled),
        request,
        signal,
        graphicsSignal: graphicsController.signal,
        ensureActive,
        hold: continuity.hold,
        orientations,
      }),
    mprSlices: plane => {
      const targetViewportId = viewportIds[plane];
      return mode === 'mpr' && !disposed && engine && targetViewportId
        ? describeDicomPlaneSlices(engine.getViewport(targetViewportId) as VolumeViewport)
        : null;
    },
    select: index => {
      if (mode === 'original' && !disposed) stack?.select(index);
    },
    onStack: listener => stack!.subscribe(listener),
    dispose,
    orientations,
    onReference: listener => {
      referenceListener = listener;
      listener(referenceValue);
      return () => {
        if (referenceListener === listener) referenceListener = undefined;
      };
    },
    reference: (enabled, style) => {
      referenceEnabled = enabled;
      referenceStyle = style;
      if (mode === 'mpr') {
        if (!enabled && activeTool === 'reference') activateTool('window');
        mpr?.reference(enabled, style);
        engine?.render();
      }
    },
    undoMeasurement: () => {
      mpr?.undo();
      stackTools?.undo();
      engine?.render();
    },
    clearMeasurements: () => {
      mpr?.clear();
      stackTools?.clear();
      engine?.render();
    },
    measurements,
    focusMeasurement: measurementId => {
      const item = measurements.get(measurementId);
      if (disposed || !item || item.seriesUid !== series.uid) return false;
      if (mode === 'original' && item.view === 'original' && stack) {
        stack.select(item.slice);
        return true;
      }
      return mode === 'mpr' && item.view !== 'original' && Boolean(mpr?.focus(measurementId));
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
      const firstViewportId = viewportIds[0];
      if (mode === '3d' && !disposed && engine && firstViewportId) {
        volumePresentation = value;
        applyVolumePresentation(
          engine.getViewport(firstViewportId) as VolumeViewport3D,
          value,
          series.modality
        );
      }
    },
    isResampled: () => mode !== 'original' && Boolean(volume?.resampled),
    quantitative,
    show: (nextMode, elements) =>
      continuity.show(nextMode, elements, async () => {
        ensureActive();
        if (!engine) return;
        await comparisons.close();
        ensureActive();
        if (nextMode !== 'original') {
          await completion;
          ensureActive();
          volume = await ensureDicomRuntimeVolume({
            existingVolume: volume,
            volumeId,
            loaded: loaded!,
            modality: series.modality,
            signal,
            loading: source!.loading,
            ensureActive,
            isDisposed: () => disposed,
          });
        }
        await stack?.detach();
        ensureActive();
        mprMemory.remember(reconstruction?.state(), referenceValue);
        reconstruction?.dispose();
        reconstruction = undefined;
        releaseTools();
        if (group) destroyDicomToolGroup(group.id);
        resize?.disconnect();
        if (mode !== nextMode && nextMode === '3d')
          volumePresentation = defaultVolumePresentation(series.modality);
        mode = nextMode;
        const configured = configureDicomViewports(engine, elements, id, nextMode);
        viewportIds = configured.viewportIds;
        group = configured.group;
        const firstViewportId = viewportIds[0];
        const firstElement = elements[0];
        if (nextMode === 'original' && firstViewportId && firstElement)
          stackTools = createDicomStackTools(
            id,
            [{ viewportId: firstViewportId, group, element: firstElement }],
            measurements,
            [series.uid]
          );
        activateTool(nextMode === '3d' ? 'rotate' : 'window');
        if (nextMode === 'original' && firstViewportId) {
          await stack!.show(engine.getViewport(firstViewportId) as StackViewport);
          if (stack!.state().error) return;
        } else if (nextMode !== 'original') {
          await setVolumesForViewports(engine, [{ volumeId }], viewportIds);
        }
        ensureActive();
        if (nextMode === '3d' && firstViewportId)
          applyVolumePresentation(
            engine.getViewport(firstViewportId) as VolumeViewport3D,
            volumePresentation,
            series.modality
          );
        if (nextMode === 'mpr') {
          if (!recoveringTool) [referenceEnabled, referenceStyle] = [true, 'lines'];
          mpr = createMprTools(group, id, viewportIds, notifyReference, {
            store: measurements,
            series,
            volumeId,
            quantitative,
            oblique: plane => Boolean(reconstruction?.state().planes[plane]?.oblique),
          });
          reconstruction = createMprReconstruction(
            engine,
            viewportIds,
            volume!.plan,
            group.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool,
            notifyReconstruction
          );
          mprMemory.restore(
            reconstruction,
            mpr,
            group.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool
          );
          activateTool(referenceEnabled ? 'reference' : 'window');
        }
        if (recoveringTool) {
          activateTool(recoveringTool);
          recoveringTool = undefined;
        }
        if (nextMode !== '3d')
          stopCursor = watchDicomCursorHu(
            id,
            viewportIds,
            elements,
            viewport =>
              nextMode === 'original'
                ? dicomStackShowsHu(viewport as StackViewport)
                : quantitative(),
            value => cursorListener?.(value)
          );
        resize = observeDicomViewportSize(engine, elements, () => disposed);
      }),
    tool: activateTool,
    reset: () => {
      if (!engine || disposed) return;
      if (mode === 'mpr' && reconstruction) {
        mpr?.cancel();
        reconstruction.reset();
        mpr?.oblique(false);
        activateTool(activeTool);
        return;
      }
      resetDicomCamera(engine, viewportIds);
    },
    capture: plane =>
      captureRuntimeView({
        engine,
        stack: stack!,
        series,
        mode,
        plane,
        signal: AbortSignal.any([signal, graphicsController.signal]),
        ensureActive,
        resampled: Boolean(volume?.resampled),
        reconstructionLabel:
          mode === 'mpr' ? () => reconstruction?.state().planes[plane]?.label : undefined,
        orientations,
      }),
  };
};
