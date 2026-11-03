import {
  Enums as CoreEnums,
  getEnabledElementByIds,
  utilities,
  type StackViewport,
  type Types,
  type VolumeViewport,
} from '@cornerstonejs/core';
import { Enums } from '@cornerstonejs/tools';
import { dicomImageInfo } from './dicomImageRegistry';

type View = StackViewport | VolumeViewport;

/** The HU of the voxel under a world point, read like Cornerstone's probe. */
export const readDicomHu = (viewport: View, world: Types.Point3): number | null => {
  const data = viewport.getImageData();
  if (!data?.imageData || !data.voxelManager || !world.every(Number.isFinite)) return null;
  const index = utilities.transformWorldToIndex(data.imageData, world);
  if (!utilities.indexWithinDimensions(index, data.dimensions)) return null;
  const value = data.voxelManager.getAtIJKPoint(index);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Original and Comparar: only the image on screen decides, by `hasDicomHuCalibration`. */
export const dicomStackShowsHu = (viewport: Pick<StackViewport, 'getCurrentImageId'>) =>
  Boolean(dicomImageInfo(viewport.getCurrentImageId())?.huCalibrated);

/**
 * Reports the HU under the pointer, once per frame, only where `calibrated` allows it:
 * classic CT with a validated HU mapping (and a thin orthogonal plane in MPR). Otherwise null.
 * It reads again after every render, so a new slice, pan or zoom never leaves an old value.
 */
export const watchDicomCursorHu = (
  engineId: string,
  viewportIds: string[],
  panes: Array<HTMLDivElement | null>,
  calibrated: (viewport: View) => boolean,
  notify: (value: number | null) => void
) => {
  // A copy: React clears its ref array when the panes unmount, before this is disposed.
  const elements = panes.filter((element): element is HTMLDivElement => !!element);
  let frame = 0;
  let latest: { viewportId: string; canvas: Types.Point2 } | null = null;
  let shown: number | null = null;
  const report = (value: number | null) => {
    if (value === shown) return;
    shown = value;
    notify(value);
  };
  const read = () => {
    frame = 0;
    const target = latest;
    const viewport =
      target && (getEnabledElementByIds(target.viewportId, engineId)?.viewport as View | undefined);
    try {
      report(
        viewport && calibrated(viewport)
          ? readDicomHu(viewport, viewport.canvasToWorld(target!.canvas))
          : null
      );
    } catch {
      report(null);
    }
  };
  const schedule = () => {
    if (latest) frame ||= requestAnimationFrame(read);
  };
  const onMove = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        viewportId: string;
        renderingEngineId: string;
        currentPoints: { canvas: Types.Point2 };
      }>
    ).detail;
    if (detail.renderingEngineId !== engineId || !viewportIds.includes(detail.viewportId)) return;
    latest = { viewportId: detail.viewportId, canvas: [...detail.currentPoints.canvas] };
    schedule();
  };
  const onLeave = () => {
    latest = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    report(null);
  };
  elements.forEach(element => {
    element.addEventListener(Enums.Events.MOUSE_MOVE, onMove);
    element.addEventListener(CoreEnums.Events.IMAGE_RENDERED, schedule);
    element.addEventListener('pointerleave', onLeave);
  });
  return () => {
    if (frame) cancelAnimationFrame(frame);
    elements.forEach(element => {
      element.removeEventListener(Enums.Events.MOUSE_MOVE, onMove);
      element.removeEventListener(CoreEnums.Events.IMAGE_RENDERED, schedule);
      element.removeEventListener('pointerleave', onLeave);
    });
    notify(null);
  };
};
