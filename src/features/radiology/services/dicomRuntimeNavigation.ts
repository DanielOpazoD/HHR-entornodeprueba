import {
  utilities,
  type RenderingEngine,
  type StackViewport,
  type VolumeViewport,
} from '@cornerstonejs/core';
import type { DicomMode } from './dicomRuntimeTypes';
import type { createProgressiveStack } from './dicomProgressiveStack';
export const createDicomRuntimeNavigation = (
  context: () => {
    engine?: RenderingEngine;
    viewportIds: string[];
    mode: DicomMode;
    disposed: boolean;
    stack?: ReturnType<typeof createProgressiveStack>;
  }
) => ({
  invert: (value: boolean) => {
    const { engine, viewportIds, mode, disposed } = context();
    if (mode === '3d' || disposed) return;
    viewportIds.forEach(id =>
      (engine?.getViewport(id) as StackViewport | VolumeViewport)?.setProperties({ invert: value })
    );
    engine?.render();
  },
  window: (width: number, center: number) => {
    const { engine, viewportIds, disposed } = context();
    if (!engine || disposed) return;
    viewportIds.forEach(id =>
      (engine.getViewport(id) as StackViewport | VolumeViewport).setProperties({
        voiRange: { lower: center - width / 2, upper: center + width / 2 },
      })
    );
    engine.render();
  },
  step: (plane: number, delta: number) => {
    const { engine, viewportIds, mode, disposed, stack } = context();
    if (!engine || disposed || mode === '3d') return;
    if (mode === 'original') {
      stack?.step(delta);
      return;
    }
    const viewport = engine.getViewport(viewportIds[plane]);
    if (viewport) utilities.scroll(viewport, { delta, debounceLoading: false });
  },
});

export const resetDicomCamera = (engine: RenderingEngine, viewportIds: string[]) => {
  viewportIds.forEach(id => engine.getViewport(id)?.resetCamera());
  engine.render();
};
