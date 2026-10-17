// This entire module is behind DicomViewer's dynamic import. Never import it from a public barrel.
import {
  init as initCore,
  RenderingEngine,
  Enums,
  cache,
  setVolumesForViewports,
  utilities,
  getWebWorkerManager,
  getShouldUseCPURendering,
  type Types,
  type StackViewport,
  type VolumeViewport,
  type VolumeViewport3D,
} from '@cornerstonejs/core';
import { init as initLoader, wadouri } from '@cornerstonejs/dicom-image-loader';
import {
  init as initTools,
  addTool,
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  TrackballRotateTool,
  Enums as ToolEnums,
  utilities as toolUtilities,
} from '@cornerstonejs/tools';
import { captureDicomCanvas } from './dicomCanvasCapture';
import { DicomReferencePointTool } from './dicomReferencePointTool';
import { CrosshairsTool, LengthTool, AngleTool } from '@cornerstonejs/tools';
import {
  createMprTools,
  mprTools,
  type DicomReference,
  type ReferenceStyle,
} from './dicomMprTools';
import { applyVolumePresentation } from './dicomVolumePresentation';
import {
  defaultVolumePresentation,
  type VolumePresentation,
} from '@/services/radiology/dicomPresentation';
import { createDicomVolume, type DicomVolumeHandle } from './dicomVolume';
import { loadDicomSeries, type LoadedDicomSeries } from './dicomSeriesLoader';
import { waitForDicomRender } from './dicomRenderReady';
import type { DicomStudy, DicomSeries } from '@/services/radiology/dicomTypes';

export type DicomTool = 'window' | 'pan' | 'zoom' | 'rotate' | 'reference' | 'length' | 'angle';
export type DicomMode = 'original' | 'mpr' | '3d';
export interface DicomOrientation {
  top: string;
  right: string;
  bottom: string;
  left: string;
}
let initialization: Promise<void> | undefined;
let users = 0;
const tools = [WindowLevelTool, PanTool, ZoomTool, StackScrollTool, TrackballRotateTool];
const initialize = () =>
  (initialization ??= (async () => {
    await initCore();
    initLoader({ maxWebWorkers: 2 });
    initTools();
    [...tools, ...mprTools].forEach(tool => addTool(tool));
    cache.setMaxCacheSize(512 * 1024 * 1024);
  })().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  }));

export interface DicomRuntime {
  show: (mode: DicomMode, elements: HTMLDivElement[]) => Promise<void>;
  tool: (tool: DicomTool) => void;
  window: (width: number, center: number) => void;
  reset: () => void;
  step: (plane: number, delta: number) => void;
  orientations: () => DicomOrientation[];
  reference: (enabled: boolean, style: ReferenceStyle) => void;
  onReference: (listener: (value: DicomReference | null) => void) => () => void;
  clearMeasurements: () => void;
  invert: (value: boolean) => void;
  presentation: (value: VolumePresentation) => void;
  isResampled: () => boolean;
  hasLocalizers: () => boolean;
  capture: (plane: number) => ReturnType<typeof captureDicomCanvas>;
  dispose: () => void;
}

export const createDicomRuntime = async (
  study: DicomStudy,
  series: DicomSeries,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void
): Promise<DicomRuntime> => {
  users++;
  let engine: RenderingEngine | undefined;
  let loaded: LoadedDicomSeries | undefined;
  let disposed = false;
  let volume: DicomVolumeHandle | undefined;
  let mode: DicomMode = 'original';
  let viewportIds: string[] = [];
  let resize: ResizeObserver | undefined;
  let mpr: ReturnType<typeof createMprTools> | undefined;
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
    resize?.disconnect();
    mpr?.dispose();
    if (group) ToolGroupManager.destroyToolGroup(group.id);
    engine?.destroy();
    volume?.release();
    loaded?.release();
    users--;
    if (!users) {
      if (getWebWorkerManager().workerRegistry.dicomImageLoader)
        getWebWorkerManager().terminate('dicomImageLoader');
      utilities.genericMetadataProvider.clear();
      wadouri.fileManager.purge();
      wadouri.dataSetCacheManager.purge();
    }
  };
  try {
    await initialize();
    signal.throwIfAborted();
    loaded = await loadDicomSeries(study, series, signal, progress);
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
  const toolNames: Record<DicomTool, string> = {
    window: WindowLevelTool.toolName,
    pan: PanTool.toolName,
    zoom: ZoomTool.toolName,
    rotate: TrackballRotateTool.toolName,
    reference: DicomReferencePointTool.toolName,
    length: LengthTool.toolName,
    angle: AngleTool.toolName,
  };
  const activateTool = (tool: DicomTool) => {
    if (!group || (mode !== 'mpr' && ['reference', 'length', 'angle'].includes(tool))) return;
    activeTool = tool;
    if (mode === 'mpr' && mpr) {
      group.setToolPassive(DicomReferencePointTool.toolName);
      group.setToolPassive(LengthTool.toolName);
      group.setToolPassive(AngleTool.toolName);
      mpr?.reference(referenceEnabled, referenceStyle);
    }
    tools
      .filter(candidate => candidate !== StackScrollTool)
      .forEach(candidate => group?.setToolPassive(candidate.toolName));
    group.setToolActive(toolNames[tool], {
      bindings: [
        { mouseButton: ToolEnums.MouseBindings.Primary },
        ...(mode === '3d' && tool === 'zoom'
          ? [{ mouseButton: ToolEnums.MouseBindings.Wheel }]
          : []),
      ],
    });
    if (mode === '3d' && tool !== 'zoom')
      group.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
      });
  };
  const orientations = (): DicomOrientation[] => {
    if (!engine || disposed || mode === '3d' || loaded?.geometry[0]?.orientation.length !== 6)
      return [];
    return viewportIds.map(viewportId => {
      const { viewUp, viewPlaneNormal: normal } = engine!.getViewport(viewportId).getCamera();
      if (!viewUp || !normal) return { top: '', right: '', bottom: '', left: '' };
      const right: Types.Point3 = [
        viewUp[1] * normal[2] - viewUp[2] * normal[1],
        viewUp[2] * normal[0] - viewUp[0] * normal[2],
        viewUp[0] * normal[1] - viewUp[1] * normal[0],
      ];
      const { getOrientationStringLPS, invertOrientationStringLPS } = toolUtilities.orientation;
      const top = getOrientationStringLPS(viewUp);
      const edge = getOrientationStringLPS(right);
      return {
        top,
        right: edge,
        bottom: invertOrientationStringLPS(top),
        left: invertOrientationStringLPS(edge),
      };
    });
  };
  return {
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
    clearMeasurements: () => {
      mpr?.clear();
      engine?.render();
    },
    invert: value => {
      if (mode === '3d' || disposed) return;
      viewportIds.forEach(viewportId =>
        (engine?.getViewport(viewportId) as StackViewport | VolumeViewport)?.setProperties({
          invert: value,
        })
      );
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
    hasLocalizers: () => Boolean(loaded && loaded.volumeGeometry.length < loaded.geometry.length),
    show: async (nextMode, elements) => {
      ensureActive();
      if (!engine || !loaded) return;
      if (nextMode !== 'original') {
        if (getShouldUseCPURendering())
          throw new Error('MPR y 3D necesitan WebGL en este navegador. Utiliza la vista original.');
        if (series.modality !== 'CT' && series.modality !== 'MR')
          throw new Error('MPR y 3D están disponibles para series volumétricas de TAC o RM.');
        if (!volume) {
          // Every instance is validated and decoded before any reconstruction.
          const created = await createDicomVolume(
            volumeId,
            loaded.volumeGeometry,
            series.modality,
            loaded.resamplingSupported,
            signal
          );
          if (disposed || signal.aborted) {
            created.release();
            ensureActive();
          }
          volume = created;
        }
      }
      mpr?.dispose();
      mpr = undefined;
      if (group) ToolGroupManager.destroyToolGroup(group.id);
      resize?.disconnect();
      mode = nextMode;
      const axes = [
        Enums.OrientationAxis.AXIAL,
        Enums.OrientationAxis.CORONAL,
        Enums.OrientationAxis.SAGITTAL,
      ];
      viewportIds = elements.map((_, i) => `${id}-${nextMode}-${i}`);
      engine.setViewports(
        elements.map((element, i) => ({
          viewportId: viewportIds[i],
          element,
          type:
            nextMode === 'original'
              ? Enums.ViewportType.STACK
              : nextMode === '3d'
                ? Enums.ViewportType.VOLUME_3D
                : Enums.ViewportType.ORTHOGRAPHIC,
          defaultOptions: { background: [0, 0, 0] as Types.Point3, orientation: axes[i] },
        }))
      );
      group = ToolGroupManager.createToolGroup(id);
      if (!group) throw new Error('No se pudieron inicializar las herramientas del visor.');
      tools.forEach(tool => group?.addTool(tool.toolName));
      viewportIds.forEach(viewport => group?.addViewport(viewport, id));
      if (nextMode !== '3d')
        group.setToolActive(StackScrollTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
        });
      activateTool(nextMode === '3d' ? 'rotate' : 'window');
      if (nextMode === 'original') {
        await (engine.getViewport(viewportIds[0]) as StackViewport).setStack(
          loaded.imageIds,
          Math.floor(loaded.imageIds.length / 2)
        );
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
        activateTool(referenceEnabled ? 'reference' : 'window');
      }
      const sizes = new Map(
        elements.map(element => [element, [element.clientWidth, element.clientHeight]])
      );
      resize = new ResizeObserver(() => {
        if (disposed) return;
        const changed = elements.some(element => {
          const previous = sizes.get(element)!;
          return previous[0] !== element.clientWidth || previous[1] !== element.clientHeight;
        });
        if (!changed) return; // The initial observer notification must not clear a completed frame.
        elements.forEach(element =>
          sizes.set(element, [element.clientWidth, element.clientHeight])
        );
        engine?.resize(true, false);
      });
      elements.forEach(element => resize?.observe(element));
      await waitForDicomRender(elements, () => engine!.render(), signal);
      // Volume actors initialize their shared GPU texture on the first pass. Refresh every
      // plane once that pass is complete, including with software WebGL, before capture is enabled.
      if (nextMode !== 'original')
        await waitForDicomRender(elements, () => engine!.render(), signal);
    },
    tool: activateTool,
    window: (width, center) => {
      if (!engine || disposed) return;
      viewportIds.forEach(viewport => {
        const target = engine?.getViewport(viewport) as StackViewport | VolumeViewport;
        target.setProperties({
          voiRange: { lower: center - width / 2, upper: center + width / 2 },
        });
      });
      engine.render();
    },
    reset: () => {
      if (!engine || disposed) return;
      if (mode === 'mpr' && referenceEnabled) {
        // Cornerstone 4.22 resetCrosshairs resets pan, zoom, orientation and center for every viewport.
        (group?.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool)?.resetCrosshairs();
        return;
      }
      viewportIds.forEach(viewport => {
        const target = engine?.getViewport(viewport);
        target?.resetCamera();
      });
      engine.render();
    },
    step: (plane, delta) => {
      if (!engine || disposed || mode === '3d') return;
      const viewport = engine.getViewport(viewportIds[plane]);
      if (viewport) utilities.scroll(viewport, { delta, debounceLoading: false });
    },
    capture: async plane => {
      ensureActive();
      const target = engine?.getViewport(viewportIds[plane]);
      if (!target) throw new Error('Selecciona una vista cargada.');
      await waitForDicomRender([target.element], () => target.render(), signal);
      ensureActive();
      return captureDicomCanvas(
        target as StackViewport | VolumeViewport,
        mode,
        plane,
        Boolean(volume?.resampled),
        orientations()[plane]
      );
    },
  };
};
