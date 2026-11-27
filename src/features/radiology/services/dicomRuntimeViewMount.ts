import {
  setVolumesForViewports,
  type RenderingEngine,
  type StackViewport,
  type VolumeViewport3D,
} from '@cornerstonejs/core';
import { CrosshairsTool, type ToolGroupManager } from '@cornerstonejs/tools';
import type { DicomSeries } from '@/domain/radiology/dicomTypes';
import type { DicomMode, DicomTool } from './dicomRuntimeTypes';
import type { DicomVolumeHandle } from './dicomVolume';
import type { LoadedDicomSeries, ProgressiveDicomSeries } from './dicomSeriesLoader';
import type { createProgressiveStack } from './dicomProgressiveStack';
import type { createDicomComparisonOwner } from './dicomComparisonOwner';
import type { DicomMeasurementStore } from './dicomMeasurementStore';
import { destroyDicomToolGroup } from './dicomToolLifecycle';
import { configureDicomViewports } from './dicomViewportSetup';
import {
  createMprReconstruction,
  type createMprMemory,
  type MprReconstructionState,
} from './dicomMprReconstruction';
import { createMprTools, type DicomReference, type ReferenceStyle } from './dicomMprTools';
import { applyVolumePresentation } from './dicomVolumePresentation';
import { defaultVolumePresentation, type VolumePresentation } from './dicomPresentation';
import { observeDicomViewportSize } from './dicomViewportLayout';
import { createDicomStackTools, type DicomStackToolSession } from './dicomStackTools';
import { dicomStackShowsHu, watchDicomCursorHu } from './dicomCursorValue';
import { ensureDicomRuntimeVolume } from './dicomRuntimeLifecycle';

export interface DicomRuntimeViewState {
  mode: DicomMode;
  volume: DicomVolumeHandle | undefined;
  volumePresentation: VolumePresentation;
  viewportIds: string[];
  group: ReturnType<typeof ToolGroupManager.createToolGroup>;
  stackTools: DicomStackToolSession | undefined;
  mpr: ReturnType<typeof createMprTools> | undefined;
  reconstruction: ReturnType<typeof createMprReconstruction> | undefined;
  referenceEnabled: boolean;
  referenceStyle: ReferenceStyle;
  referenceValue: DicomReference | null;
  recoveringTool: DicomTool | undefined;
  stopCursor: (() => void) | undefined;
  resize: ResizeObserver | undefined;
}

export interface MountDicomRuntimeViewParams {
  id: string;
  volumeId: string;
  series: DicomSeries;
  nextMode: DicomMode;
  elements: HTMLDivElement[];
  engine: RenderingEngine;
  comparisons: ReturnType<typeof createDicomComparisonOwner>;
  completion: Promise<void>;
  source: ProgressiveDicomSeries;
  getLoaded: () => LoadedDicomSeries | undefined;
  stack: ReturnType<typeof createProgressiveStack>;
  measurements: DicomMeasurementStore;
  mprMemory: ReturnType<typeof createMprMemory>;
  signal: AbortSignal;
  ensureActive: () => void;
  isDisposed: () => boolean;
  quantitative: () => boolean;
  activateTool: (tool: DicomTool) => void;
  notifyReference: (value: DicomReference | null) => void;
  notifyReconstruction: (state: MprReconstructionState | null) => void;
  onCursorHu: (value: number | null) => void;
  releaseTools: () => void;
  view: DicomRuntimeViewState;
}

export const mountDicomRuntimeView = async ({
  id,
  volumeId,
  series,
  nextMode,
  elements,
  engine,
  comparisons,
  completion,
  source,
  getLoaded,
  stack,
  measurements,
  mprMemory,
  signal,
  ensureActive,
  isDisposed,
  quantitative,
  activateTool,
  notifyReference,
  notifyReconstruction,
  onCursorHu,
  releaseTools,
  view,
}: MountDicomRuntimeViewParams): Promise<void> => {
  ensureActive();
  await comparisons.close();
  ensureActive();

  if (nextMode !== 'original') {
    await completion;
    ensureActive();
    view.volume = await ensureDicomRuntimeVolume({
      existingVolume: view.volume,
      volumeId,
      loaded: getLoaded()!,
      modality: series.modality,
      signal,
      loading: source.loading,
      ensureActive,
      isDisposed,
    });
  }

  await stack.detach();
  ensureActive();
  mprMemory.remember(view.reconstruction?.state(), view.referenceValue);
  view.reconstruction?.dispose();
  view.reconstruction = undefined;
  releaseTools();
  if (view.group) destroyDicomToolGroup(view.group.id);
  view.resize?.disconnect();

  if (view.mode !== nextMode && nextMode === '3d') {
    view.volumePresentation = defaultVolumePresentation(series.modality);
  }
  view.mode = nextMode;

  const configured = configureDicomViewports(engine, elements, id, nextMode);
  view.viewportIds = configured.viewportIds;
  view.group = configured.group;

  const firstViewportId = configured.viewportIds[0];
  const firstElement = elements[0];
  if (nextMode === 'original' && firstViewportId && firstElement) {
    view.stackTools = createDicomStackTools(
      id,
      [{ viewportId: firstViewportId, group: configured.group, element: firstElement }],
      measurements,
      [series.uid]
    );
  }

  activateTool(nextMode === '3d' ? 'rotate' : 'window');
  if (nextMode === 'original' && firstViewportId) {
    await stack.show(engine.getViewport(firstViewportId) as StackViewport);
    if (stack.state().error) return;
  } else if (nextMode !== 'original') {
    await setVolumesForViewports(engine, [{ volumeId }], configured.viewportIds);
  }
  ensureActive();

  if (nextMode === '3d' && firstViewportId) {
    applyVolumePresentation(
      engine.getViewport(firstViewportId) as VolumeViewport3D,
      view.volumePresentation,
      series.modality
    );
  }

  if (nextMode === 'mpr') {
    if (!view.recoveringTool) {
      view.referenceEnabled = true;
      view.referenceStyle = 'lines';
    }
    view.mpr = createMprTools(configured.group, id, configured.viewportIds, notifyReference, {
      store: measurements,
      series,
      volumeId,
      quantitative,
      oblique: plane => Boolean(view.reconstruction?.state().planes[plane]?.oblique),
    });
    view.reconstruction = createMprReconstruction(
      engine,
      configured.viewportIds,
      view.volume!.plan,
      configured.group.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool,
      notifyReconstruction
    );
    mprMemory.restore(
      view.reconstruction,
      view.mpr,
      configured.group.getToolInstance(CrosshairsTool.toolName) as CrosshairsTool
    );
    activateTool(view.referenceEnabled ? 'reference' : 'window');
  }

  if (view.recoveringTool) {
    activateTool(view.recoveringTool);
    view.recoveringTool = undefined;
  }

  if (nextMode !== '3d') {
    view.stopCursor = watchDicomCursorHu(
      id,
      configured.viewportIds,
      elements,
      viewport =>
        nextMode === 'original' ? dicomStackShowsHu(viewport as StackViewport) : quantitative(),
      onCursorHu
    );
  }
  view.resize = observeDicomViewportSize(engine, elements, isDisposed);
};
