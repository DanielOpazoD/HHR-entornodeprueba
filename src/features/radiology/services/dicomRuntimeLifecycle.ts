import {
  getWebWorkerManager,
  utilities,
  getShouldUseCPURendering,
  type RenderingEngine,
  type StackViewport,
  type VolumeViewport,
} from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { DicomSeries, DicomStudy } from '@/domain/radiology/dicomTypes';
import type { fetchDicomInstance } from './mmradDicomService';
import { createDicomComparison } from './dicomComparison';
import type { createDicomComparisonOwner } from './dicomComparisonOwner';
import { openDicomCineSession } from './dicomCineSession';
import {
  DICOM_MPR_PLANE_NAMES,
  openDicomVolumeVideo,
  type DicomVideoRequest,
} from './dicomVolumeVideo';
import { createDicomVolume, type DicomVolumeHandle } from './dicomVolume';
import type { LoadedDicomSeries, ProgressiveDicomSeries } from './dicomSeriesLoader';
import type { createProgressiveStack } from './dicomProgressiveStack';
import type { createMprReconstruction } from './dicomMprReconstruction';
import type { createDicomViewContinuity } from './dicomViewContinuity';
import type { DicomMeasurementStore } from './dicomMeasurementStore';
import type { DicomMode, DicomOrientation, DicomRuntime } from './dicomRuntimeTypes';

let runtimeUsers = 0;

/** Global loader resources outlive individual series until the last session has drained. */
export const retainDicomRuntime = () => {
  runtimeUsers++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--runtimeUsers) return;
    if (getWebWorkerManager().workerRegistry.dicomImageLoader)
      getWebWorkerManager().terminate('dicomImageLoader');
    utilities.genericMetadataProvider.clear();
    wadouri.fileManager.purge();
    wadouri.dataSetCacheManager.purge();
  };
};

export interface EnsureDicomRuntimeVolumeParams {
  existingVolume: DicomVolumeHandle | undefined;
  volumeId: string;
  loaded: LoadedDicomSeries;
  modality: DicomSeries['modality'];
  signal: AbortSignal;
  loading: ProgressiveDicomSeries['loading'];
  ensureActive: () => void;
  isDisposed: () => boolean;
}

export const ensureDicomRuntimeVolume = async ({
  existingVolume,
  volumeId,
  loaded,
  modality,
  signal,
  loading,
  ensureActive,
  isDisposed,
}: EnsureDicomRuntimeVolumeParams): Promise<DicomVolumeHandle> => {
  if (getShouldUseCPURendering())
    throw new Error('MPR y 3D necesitan WebGL en este navegador. Utiliza la vista original.');
  if (modality !== 'CT' && modality !== 'MR')
    throw new Error('MPR y 3D están disponibles para series volumétricas de TAC o RM.');
  if (existingVolume) return existingVolume;
  const start = performance.now();
  loading.volume(true);
  const created = await createDicomVolume(
    volumeId,
    loaded.volumeGeometry,
    modality,
    loaded.resamplingSupported,
    signal
  ).finally(() => loading.volume(false, performance.now() - start));
  if (isDisposed() || signal.aborted) {
    created.release();
    ensureActive();
  }
  return created;
};

export interface OpenDicomRuntimeCineParams {
  engine: RenderingEngine | undefined;
  stack: ReturnType<typeof createProgressiveStack> | undefined;
  mode: DicomMode;
  viewportIds: string[];
  totalInstances: number;
  orientations: () => DicomOrientation[];
  signal: AbortSignal;
  graphicsSignal: AbortSignal;
  ensureActive: () => void;
  restoreSlice?: boolean;
}

export const openDicomRuntimeCine = ({
  engine,
  stack,
  mode,
  viewportIds,
  totalInstances,
  orientations,
  signal,
  graphicsSignal,
  ensureActive,
  restoreSlice,
}: OpenDicomRuntimeCineParams) => {
  ensureActive();
  const firstViewportId = viewportIds[0];
  if (mode !== 'original' || !engine || !stack || !firstViewportId)
    throw new Error('Selecciona Original para cine.');
  return openDicomCineSession(
    engine.getViewport(firstViewportId) as StackViewport,
    stack,
    AbortSignal.any([signal, graphicsSignal]),
    ensureActive,
    {
      total: totalInstances,
      orientation: () => orientations()[0],
      restoreSlice,
    }
  );
};

export interface OpenDicomRuntimeVolumeVideoParams {
  getEngine: () => RenderingEngine | undefined;
  mode: DicomMode;
  viewportIds: string[];
  getReconstruction: () => ReturnType<typeof createMprReconstruction> | undefined;
  resampled: boolean;
  request: DicomVideoRequest;
  signal: AbortSignal;
  graphicsSignal: AbortSignal;
  ensureActive: () => void;
  hold: ReturnType<typeof createDicomViewContinuity>['hold'];
  orientations: () => DicomOrientation[];
}

export const openDicomRuntimeVolumeVideo = ({
  getEngine,
  mode,
  viewportIds,
  getReconstruction,
  resampled,
  request,
  signal,
  graphicsSignal,
  ensureActive,
  hold,
  orientations,
}: OpenDicomRuntimeVolumeVideoParams) => {
  ensureActive();
  const owner = getEngine();
  const plane = request.kind === 'mpr' ? request.plane : 0;
  const targetViewportId = viewportIds[plane];
  const viewport = targetViewportId
    ? (owner?.getViewport(targetViewportId) as VolumeViewport | undefined)
    : undefined;
  if (!owner || !viewport || mode !== request.kind || (mode === 'mpr' && !getReconstruction()))
    throw new Error('La vista cambió. Vuelve a generar el video.');
  const prefix = resampled ? 'Remuestreado · ' : '';
  return openDicomVolumeVideo({
    viewport,
    request,
    lockElements: owner.getViewports().map(item => item.element.parentElement ?? item.element),
    signal: AbortSignal.any([signal, graphicsSignal]),
    ensureActive: () => {
      ensureActive();
      if (getEngine() !== owner) throw new Error('La vista cambió. Vuelve a generar el video.');
    },
    hold,
    edges: request.kind === 'mpr' ? orientations()[plane] : undefined,
    describe: (position, total) =>
      request.kind === 'mpr'
        ? `${prefix}${DICOM_MPR_PLANE_NAMES[plane]} · ${getReconstruction()?.state().planes[plane]?.label ?? 'Corte fino'} · Corte ${position + 1}/${total}`
        : `${prefix}Volumen 3D`,
  });
};

export interface OpenDicomRuntimeComparisonParams {
  study: DicomStudy;
  series: DicomSeries;
  secondary: Parameters<DicomRuntime['compare']>[0];
  elements: Parameters<DicomRuntime['compare']>[1];
  childSignal: Parameters<DicomRuntime['compare']>[2];
  notify: Parameters<DicomRuntime['compare']>[3];
  source: ProgressiveDicomSeries;
  getLoaded: () => LoadedDicomSeries | undefined;
  stack: ReturnType<typeof createProgressiveStack>;
  measurements: DicomMeasurementStore;
  fetchInstance?: typeof fetchDicomInstance;
  continuity: ReturnType<typeof createDicomViewContinuity>;
  comparisons: ReturnType<typeof createDicomComparisonOwner>;
  completion: Promise<void>;
  signal: AbortSignal;
  ensureActive: () => void;
  onBeforeOpen: () => void;
}

export const openDicomRuntimeComparison = async ({
  study,
  series,
  secondary,
  elements,
  childSignal,
  notify,
  source,
  getLoaded,
  stack,
  measurements,
  fetchInstance,
  continuity,
  comparisons,
  completion,
  signal,
  ensureActive,
  onBeforeOpen,
}: OpenDicomRuntimeComparisonParams) => {
  await continuity.suspend();
  return comparisons.open(async transition => {
    await completion;
    ensureActive();
    const active = AbortSignal.any([signal, childSignal, transition]);
    active.throwIfAborted();
    onBeforeOpen();
    await stack.detach();
    active.throwIfAborted();
    return createDicomComparison(
      study,
      series,
      secondary,
      source,
      getLoaded()!,
      elements,
      active,
      notify,
      fetchInstance,
      stack.state().requested,
      measurements
    );
  });
};
