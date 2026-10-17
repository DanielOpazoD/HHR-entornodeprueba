// This entire module is behind DicomViewer's dynamic import. Never import it from a public barrel.
import {
  init as initCore,
  RenderingEngine,
  Enums,
  CONSTANTS,
  cache,
  setVolumesForViewports,
  utilities,
  getWebWorkerManager,
  getShouldUseCPURendering,
  type Types,
  type StackViewport,
  type VolumeViewport,
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
import { createDicomVolume, type DicomVolumeHandle } from './dicomVolume';
import { loadDicomSeries, type LoadedDicomSeries } from './dicomSeriesLoader';
import { waitForDicomRender } from './dicomRenderReady';
import type { DicomPlane, DicomStudy, DicomSeries } from '@/services/radiology/dicomTypes';

export type DicomTool = 'window' | 'pan' | 'zoom' | 'rotate';
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
    tools.forEach(tool => addTool(tool));
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
  isResampled: () => boolean;
  hasLocalizers: () => boolean;
  capture: (plane: number) => Promise<{
    png: Uint8Array;
    width: number;
    height: number;
    plane: DicomPlane;
    sliceLabel: string;
  }>;
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
  const id = `dicom-${crypto.randomUUID()}`;
  const volumeId = `cornerstoneStreamingImageVolume:${id}`;
  let group: ReturnType<typeof ToolGroupManager.createToolGroup>;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resize?.disconnect();
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
  };
  const activateTool = (tool: DicomTool) => {
    if (!group) return;
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
              callback: ({ volumeActor }) => {
                if (nextMode !== '3d') return;
                const preset = CONSTANTS.VIEWPORT_PRESETS.find(item => item.name === 'CT-Bone');
                if (preset) utilities.applyPreset(volumeActor, preset);
              },
            },
          ],
          viewportIds
        );
      }
      ensureActive();
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
      const source = target.getCanvas();
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 2048 / source.width, 2048 / source.height);
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('El navegador no permite capturar esta vista.');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const sliceLabel =
        (volume?.resampled && mode !== 'original' ? 'Remuestreado · ' : '') +
        (mode === '3d'
          ? 'Volumen 3D'
          : `Corte ${target.getSliceIndex() + 1}/${target.getNumberOfSlices()}`);
      context.font = '14px sans-serif';
      context.fillStyle = 'rgba(0,0,0,.7)';
      context.fillRect(
        8,
        canvas.height - 28,
        Math.min(canvas.width - 16, context.measureText(sliceLabel).width + 12),
        22
      );
      context.fillStyle = 'white';
      context.fillText(sliceLabel, 14, canvas.height - 12);
      const edges = orientations()[plane];
      if (edges) {
        const size = Math.max(12, Math.min(22, canvas.width / 35));
        context.font = `bold ${size}px sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        for (const [label, x, y] of [
          [edges.top, canvas.width / 2, size],
          [edges.bottom, canvas.width / 2, canvas.height - size],
          [edges.left, size, canvas.height / 2],
          [edges.right, canvas.width - size, canvas.height / 2],
        ] as const) {
          context.fillStyle = 'rgba(0,0,0,.7)';
          context.fillRect(x - size, y - size * 0.7, size * 2, size * 1.4);
          context.fillStyle = 'white';
          context.fillText(label, x, y);
        }
      }
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          value => (value ? resolve(value) : reject(new Error('No se pudo capturar la vista.'))),
          'image/png'
        )
      );
      return {
        png: new Uint8Array(await blob.arrayBuffer()),
        width: canvas.width,
        height: canvas.height,
        sliceLabel,
        plane:
          mode === 'original'
            ? 'original'
            : mode === '3d'
              ? '3d'
              : (['axial', 'coronal', 'sagittal'] as const)[plane],
      };
    },
  };
};
