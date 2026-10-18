import { configureDicomViewports } from './dicomViewportSetup';
import { createDicomRuntimeNavigation } from './dicomRuntimeNavigation';
import { createMprReconstruction, type MprReconstructionState } from './dicomMprReconstruction';
import { dicomToolNames as toolNames } from './dicomToolNames';
import { createDicomComparison } from './dicomComparison';
import { createDicomComparisonOwner } from './dicomComparisonOwner';
import type { fetchDicomInstance } from './mmradDicomService';
import { openDicomCineSession } from './dicomCineSession';
import { initializeDicom as initialize, dicomTools as tools } from './dicomInitialization';
import {
  RenderingEngine,
  setVolumesForViewports,
  utilities,
  getWebWorkerManager,
  getShouldUseCPURendering,
  type StackViewport,
  type VolumeViewport3D,
} from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import {
  ToolGroupManager,
  ZoomTool,
  StackScrollTool,
  Enums as ToolEnums,
  CrosshairsTool,
  LengthTool,
  AngleTool,
  ProbeTool,
  EllipticalROITool,
} from '@cornerstonejs/tools';
import { captureRuntimeView } from './dicomRuntimeCapture';
import { DicomReferencePointTool } from './dicomReferencePointTool';
import { createMprTools, type DicomReference, type ReferenceStyle } from './dicomMprTools';
import { applyVolumePresentation } from './dicomVolumePresentation';
import { defaultVolumePresentation } from '@/services/radiology/dicomPresentation';
import { createDicomVolume, type DicomVolumeHandle } from './dicomVolume';
import {
  startDicomSeries,
  type LoadedDicomSeries,
  type ProgressiveDicomSeries,
} from './dicomSeriesLoader';
import { createProgressiveStack } from './dicomProgressiveStack';
import { getDicomOrientations, observeDicomViewportSize } from './dicomViewportLayout';
import { waitForDicomRender } from './dicomRenderReady';
import type { DicomStudy, DicomSeries } from '@/services/radiology/dicomTypes';
import type { DicomTool, DicomMode, DicomOrientation, DicomRuntime } from './dicomRuntimeTypes';
export type { DicomTool, DicomMode, DicomOrientation, DicomRuntime } from './dicomRuntimeTypes';
let users = 0;

export const createDicomRuntime = async (
  study: DicomStudy,
  series: DicomSeries,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void,
  fetchInstance?: typeof fetchDicomInstance
): Promise<DicomRuntime> => {
  users++;
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
  let reconstruction: ReturnType<typeof createMprReconstruction> | undefined;
  const reconstructionListeners = new Set<(state: MprReconstructionState | null) => void>();
  const notifyReconstruction = (state: MprReconstructionState | null) => {
    mpr?.quantitative(Boolean(state?.quantitative));
    reconstructionListeners.forEach(listener => listener(state));
  };
  let referenceEnabled = true;
  let referenceStyle: ReferenceStyle = 'lines';
  let activeTool: DicomTool = 'window';
  let referenceListener: ((value: DicomReference | null) => void) | undefined;
  let referenceValue: DicomReference | null = null;
  const notifyReference = (value: DicomReference | null) => {
    referenceValue = value;
    referenceListener?.(value);
  };
  const id = `dicom-${crypto.randomUUID()}`;
  const volumeId = `cornerstoneStreamingImageVolume:${id}`;
  let group: ReturnType<typeof ToolGroupManager.createToolGroup>;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const comparing = comparisons.close();
    resize?.disconnect();
    reconstruction?.dispose();
    reconstruction = undefined;
    mpr?.dispose();
    if (group) ToolGroupManager.destroyToolGroup(group.id);
    const presentation = stack?.detach();
    // Detach this session's canvases now; Cornerstone.destroy clears but retains their DOM nodes.
    engine?.getViewports().forEach(viewport => viewport.getCanvas().remove());
    source?.cancel();
    void Promise.all([presentation, source?.settled, comparing])
      .finally(() => {
        engine?.destroy();
        volume?.release();
        users--;
        if (!users) {
          if (getWebWorkerManager().workerRegistry.dicomImageLoader)
            getWebWorkerManager().terminate('dicomImageLoader');
          utilities.genericMetadataProvider.clear();
          wadouri.fileManager.purge();
          wadouri.dataSetCacheManager.purge();
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
  const activateTool = (tool: DicomTool) => {
    if (
      !group ||
      (mode !== 'mpr' && ['reference', 'length', 'angle', 'probe', 'roi'].includes(tool))
    )
      return;
    if (
      ['probe', 'roi'].includes(tool) &&
      (!loaded?.huCalibrated || !reconstruction?.state().quantitative)
    )
      return;
    activeTool = tool;
    if (mode === 'mpr' && mpr) {
      mpr.cancel();
      group.setToolPassive(DicomReferencePointTool.toolName);
      [LengthTool, AngleTool, ProbeTool, EllipticalROITool].forEach(item =>
        group?.setToolPassive(item.toolName)
      );
      mpr?.reference(referenceEnabled, referenceStyle);
    }
    tools
      .filter(candidate => candidate !== StackScrollTool)
      .forEach(candidate => group?.setToolPassive(candidate.toolName));
    group.setToolActive(
      tool === 'reference' && reconstruction?.state().rotate
        ? CrosshairsTool.toolName
        : toolNames[tool],
      {
        bindings: [
          { mouseButton: ToolEnums.MouseBindings.Primary },
          ...(mode === '3d' && tool === 'zoom'
            ? [{ mouseButton: ToolEnums.MouseBindings.Wheel }]
            : []),
        ],
      }
    );
    if (mode === '3d' && tool !== 'zoom')
      group.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
      });
  };
  const orientations = (): DicomOrientation[] =>
    !engine ||
    disposed ||
    mode === '3d' ||
    (mode === 'original' && !source?.hasOrientation(stack?.state().current ?? source.initialIndex))
      ? []
      : getDicomOrientations(engine, viewportIds);
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
    loading: source!.loading,
    completion,
    compare: (secondary, elements, childSignal, notify) =>
      comparisons.open(async transition => {
        await completion;
        ensureActive();
        const active = AbortSignal.any([signal, childSignal, transition]);
        active.throwIfAborted();
        mpr?.cancel();
        resize?.disconnect();
        await stack!.detach();
        active.throwIfAborted();
        return createDicomComparison(
          study,
          series,
          secondary,
          source!,
          loaded!,
          elements,
          active,
          notify,
          fetchInstance,
          stack!.state().requested
        );
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
    openCine: () => {
      ensureActive();
      if (mode !== 'original' || !engine || !stack)
        throw new Error('Selecciona Original para cine.');
      return openDicomCineSession(
        engine.getViewport(viewportIds[0]) as StackViewport,
        stack,
        signal,
        ensureActive
      );
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
      engine?.render();
    },
    clearMeasurements: () => {
      mpr?.clear();
      engine?.render();
    },
    presentation: value => {
      if (mode === '3d' && !disposed && engine)
        applyVolumePresentation(
          engine.getViewport(viewportIds[0]) as VolumeViewport3D,
          value,
          series.modality
        );
    },
    isResampled: () => mode !== 'original' && Boolean(volume?.resampled),
    quantitative: () =>
      !disposed &&
      mode === 'mpr' &&
      Boolean(loaded?.huCalibrated) &&
      Boolean(reconstruction?.state().quantitative),
    show: async (nextMode, elements) => {
      ensureActive();
      if (!engine) return;
      await comparisons.close();
      ensureActive();
      if (nextMode !== 'original') {
        await completion;
        ensureActive();
        if (getShouldUseCPURendering())
          throw new Error('MPR y 3D necesitan WebGL en este navegador. Utiliza la vista original.');
        if (series.modality !== 'CT' && series.modality !== 'MR')
          throw new Error('MPR y 3D están disponibles para series volumétricas de TAC o RM.');
        if (!volume) {
          const start = performance.now();
          source!.loading.volume(true);
          const created = await createDicomVolume(
            volumeId,
            loaded!.volumeGeometry,
            series.modality,
            loaded!.resamplingSupported,
            signal
          ).finally(() => source!.loading.volume(false, performance.now() - start));
          if (disposed || signal.aborted) {
            created.release();
            ensureActive();
          }
          volume = created;
        }
      }
      await stack?.detach();
      ensureActive();
      reconstruction?.dispose();
      reconstruction = undefined;
      mpr?.dispose();
      mpr = undefined;
      if (group) ToolGroupManager.destroyToolGroup(group.id);
      resize?.disconnect();
      mode = nextMode;
      const configured = configureDicomViewports(engine, elements, id, nextMode);
      viewportIds = configured.viewportIds;
      group = configured.group;
      activateTool(nextMode === '3d' ? 'rotate' : 'window');
      if (nextMode === 'original') {
        await stack!.show(engine.getViewport(viewportIds[0]) as StackViewport);
        if (stack!.state().error) return;
      } else {
        await setVolumesForViewports(
          engine,
          [
            {
              volumeId,
            },
          ],
          viewportIds
        );
      }
      ensureActive();
      if (nextMode === '3d')
        applyVolumePresentation(
          engine.getViewport(viewportIds[0]) as VolumeViewport3D,
          defaultVolumePresentation(series.modality),
          series.modality
        );
      if (nextMode === 'mpr') {
        referenceEnabled = true;
        referenceStyle = 'lines';
        mpr = createMprTools(group, id, viewportIds, notifyReference);
        reconstruction = createMprReconstruction(
          engine,
          viewportIds,
          volume!.plan,
          group.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool,
          notifyReconstruction
        );
        activateTool(referenceEnabled ? 'reference' : 'window');
      }
      resize = observeDicomViewportSize(engine, elements, () => disposed);
      await waitForDicomRender(elements, () => engine!.render(), signal);
      if (nextMode !== 'original')
        await waitForDicomRender(elements, () => engine!.render(), signal);
    },
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
      viewportIds.forEach(viewport => {
        const target = engine?.getViewport(viewport);
        target?.resetCamera();
      });
      engine.render();
    },
    capture: plane =>
      captureRuntimeView({
        engine,
        stack: stack!,
        series,
        mode,
        plane,
        signal,
        ensureActive,
        resampled: Boolean(volume?.resampled),
        reconstructionLabel:
          mode === 'mpr' ? () => reconstruction?.state().planes[plane]?.label : undefined,
        orientations,
      }),
  };
};
