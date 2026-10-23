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

/** Preserve world-space camera position when expanding a plane or entering fullscreen. */
export const observeDicomViewportSize = (
  engine: RenderingEngine,
  elements: HTMLDivElement[],
  disposed: () => boolean
) => {
  const sizes = new Map(
    elements.map(element => [element, [element.clientWidth, element.clientHeight]])
  );
  const observer = new ResizeObserver(() => {
    if (disposed() || elements.some(element => !element.isConnected)) return;
    const changed = elements.some(element => {
      const previous = sizes.get(element)!;
      return previous[0] !== element.clientWidth || previous[1] !== element.clientHeight;
    });
    if (!changed) return;
    elements.forEach(element => sizes.set(element, [element.clientWidth, element.clientHeight]));
    engine.resize(true, true);
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
