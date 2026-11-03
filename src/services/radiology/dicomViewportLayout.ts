import type { RenderingEngine, Types } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';

export const getDicomOrientations = (engine: RenderingEngine, viewportIds: string[]) =>
  viewportIds.map(id => {
    const { viewUp, viewPlaneNormal: normal } = engine.getViewport(id).getCamera();
    if (!viewUp || !normal) return { top: '', right: '', bottom: '', left: '' };
    const right: Types.Point3 = [
      viewUp[1] * normal[2] - viewUp[2] * normal[1],
      viewUp[2] * normal[0] - viewUp[0] * normal[2],
      viewUp[0] * normal[1] - viewUp[1] * normal[0],
    ];
    const { getOrientationStringLPS, invertOrientationStringLPS } = utilities.orientation;
    const top = getOrientationStringLPS(viewUp),
      edge = getOrientationStringLPS(right);
    return {
      top,
      right: edge,
      bottom: invertOrientationStringLPS(top),
      left: invertOrientationStringLPS(edge),
    };
  });

/** A canvas whose backing size no longer matches its pane is stretched by CSS. */
export const dicomCanvasMismatch = (
  element: HTMLDivElement,
  ratio = window.devicePixelRatio || 1
) => {
  const canvas = element.querySelector('canvas');
  return (
    !!canvas &&
    (Math.abs(canvas.width - element.clientWidth * ratio) > 1 ||
      Math.abs(canvas.height - element.clientHeight * ratio) > 1)
  );
};

/**
 * Preserve world-space camera position when expanding a plane or entering fullscreen. The pane
 * may also settle while the first image loads, before this observer exists: its first callback
 * then finds a stretched canvas and resizes it. A stretched canvas would distort the image and
 * every distance measured on it.
 */
export const observeDicomViewportSize = (
  engine: RenderingEngine,
  elements: HTMLDivElement[],
  disposed: () => boolean
) => {
  const observer = new ResizeObserver(() => {
    if (disposed() || elements.some(element => !element.isConnected)) return;
    if (elements.some(element => dicomCanvasMismatch(element))) engine.resize(true, true);
  });
  elements.forEach(element => observer.observe(element));
  return observer;
};

export const getRuntimeOrientations = (
  engine: RenderingEngine | undefined,
  viewportIds: string[],
  mode: 'original' | 'mpr' | '3d',
  disposed: boolean,
  originalHasOrientation: boolean
) =>
  !engine || disposed || mode === '3d' || (mode === 'original' && !originalHasOrientation)
    ? []
    : getDicomOrientations(engine, viewportIds);
