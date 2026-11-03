import { utilities, type VolumeViewport, type VolumeViewport3D } from '@cornerstonejs/core';
import type { DicomCineSession } from './dicomCine';
import type { DicomOrientation } from './dicomRuntimeTypes';
import { turntableDicomCamera, type DicomTurntableAxis } from './dicomVideoPlan';
import { waitForDicomRender } from './dicomRenderReady';
import { lockDicomInput } from './dicomInputLock';

export type DicomVideoRequest =
  | { kind: 'mpr'; plane: number }
  | { kind: '3d'; axis: DicomTurntableAxis };

/** Slices of an MPR plane as the wheel scrolls them: one per voxel step along its normal,
 * oblique planes included. The slab moves with each step and keeps its width and blend. */
const scrollInfo = (viewport: VolumeViewport) =>
  utilities.getVolumeViewportScrollInfo(viewport, viewport.getVolumeId(), false);

export const DICOM_MPR_PLANE_NAMES = ['Axial', 'Coronal', 'Sagital'] as const;

/** Zero-based current slice and slice count of an MPR plane; null when it has no volume. */
export const describeDicomPlaneSlices = (viewport: VolumeViewport | undefined) => {
  try {
    if (!viewport) return null;
    const { currentStepIndex, numScrollSteps } = scrollInfo(viewport);
    return { current: currentStepIndex, total: numScrollSteps + 1 };
  } catch {
    return null;
  }
};

/** Owns one MPR plane (sweep) or the 3D view (turntable). Every frame waits for
 * IMAGE_RENDERED; close() puts the saved camera back, so slice, slab position, orientation
 * and crosshair return to what the user had. Preset, opacity, threshold and clip are never
 * touched: only the camera moves. Continuity is held so a graphics recovery restores the
 * camera from before the video, not a frame in the middle of it. */
export const openDicomVolumeVideo = ({
  viewport,
  request,
  lockElements,
  signal: sessionSignal,
  ensureActive,
  hold,
  describe,
  edges,
}: {
  viewport: VolumeViewport | VolumeViewport3D;
  request: DicomVideoRequest;
  lockElements: HTMLElement[];
  signal: AbortSignal;
  ensureActive: () => void;
  hold: () => () => void;
  describe: (position: number, total: number) => string;
  edges?: DicomOrientation;
}): DicomCineSession & { total: number } => {
  ensureActive();
  const plane = request.kind === 'mpr' ? (viewport as VolumeViewport) : undefined;
  const total = plane ? (describeDicomPlaneSlices(plane)?.total ?? 0) : 0;
  if (plane && total < 1) throw new Error('El plano no tiene cortes disponibles.');
  const saved = structuredClone(viewport.getCamera());
  const { focalPoint, position: eye, viewUp, viewPlaneNormal } = saved;
  if (!focalPoint || !eye || !viewUp || !viewPlaneNormal)
    throw new Error('La vista no está lista para el video.');
  const orbit = { focalPoint, position: eye, viewUp, viewPlaneNormal };
  const initialSize = [viewport.getCanvas().width, viewport.getCanvas().height];
  const release = hold();
  const unlock = lockDicomInput(lockElements);
  const controller = new AbortController();
  let closed = false;
  let frameBusy = false;
  const move = (position: number) => {
    if (plane) {
      const { currentStepIndex, numScrollSteps } = scrollInfo(plane);
      if (numScrollSteps + 1 !== total)
        throw new Error('La reconstrucción cambió. Vuelve a generar el video.');
      // Same steps as the wheel (scrollSlabs off), unlike VolumeViewport.scroll's slab steps.
      utilities.scroll(plane as unknown as Parameters<typeof utilities.scroll>[0], {
        delta: position - currentStepIndex,
        volumeId: plane.getVolumeId(),
      });
    } else if (request.kind === '3d')
      viewport.setCamera(turntableDicomCamera(orbit, request.axis, position));
    viewport.render();
  };
  return {
    total,
    close: () => {
      if (closed) return;
      closed = true;
      controller.abort();
      unlock();
      try {
        ensureActive();
        viewport.setCamera(saved);
        viewport.render();
      } catch {
        /* Closed session or replaced graphics: continuity restores the held camera. */
      } finally {
        release();
      }
    },
    frame: async (position, signal) => {
      if (closed || frameBusy) throw new Error('La sesión de video no está disponible.');
      if (plane && (!Number.isInteger(position) || position < 0 || position >= total))
        throw new Error('Selecciona un intervalo de cortes válido.');
      frameBusy = true;
      const combined = AbortSignal.any([signal, sessionSignal, controller.signal]);
      try {
        combined.throwIfAborted();
        ensureActive();
        await waitForDicomRender([viewport.element], () => move(position), combined);
        combined.throwIfAborted();
        ensureActive();
        if (plane && scrollInfo(plane).currentStepIndex !== position)
          throw new Error('No se pudo situar el corte del barrido.');
        const canvas = viewport.getCanvas();
        if (canvas.width !== initialSize[0] || canvas.height !== initialSize[1])
          throw new Error('El tamaño de la vista cambió. Vuelve a generar el video.');
        if (!canvas.width || !canvas.height) throw new Error('Imagen no disponible.');
        return { canvas, label: describe(position, total), edges };
      } finally {
        frameBusy = false;
      }
    },
  };
};
