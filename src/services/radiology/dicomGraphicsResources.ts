import type vtkOpenGLTexture from '@kitware/vtk.js/Rendering/OpenGL/Texture';
import { cache, getShouldUseCPURendering, type RenderingEngine } from '@cornerstonejs/core';

/** The visible canvases are 2D copies. Context loss belongs to the offscreen VTK canvas. */
export const dicomGraphicsContexts = (engine: RenderingEngine) => {
  if (getShouldUseCPURendering()) return [];
  return [
    ...new Set(
      engine
        .getViewports()
        .map(
          viewport =>
            engine
              .getOffscreenMultiRenderWindow(viewport.id)
              .getOpenGLRenderWindow()
              .getContext() as WebGLRenderingContext
        )
    ),
  ].filter(Boolean);
};

/** VTK delete frees objects but does not explicitly relinquish the browser's context quota. */
export const destroyDicomEngine = (engine: RenderingEngine) => {
  const contexts = dicomGraphicsContexts(engine);
  const canvases = engine.getViewports().map(viewport => viewport.getCanvas());
  try {
    engine.destroy();
  } finally {
    canvases.forEach(canvas => canvas.remove());
    contexts.forEach(gl => {
      if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
    });
  }
};

/** The parts of a VTK OpenGL window and mapper node that hold shared textures. */
interface SharedTextureWindow {
  getViewNodeFor: (renderable: unknown) => { get: (...keys: string[]) => object } | undefined;
  unregisterGraphicsResourceUser: (coreObject: unknown, user: unknown) => void;
}
const VOLUME_MAPPER_TEXTURES = [
  '_colorTextureCore',
  '_opacityTextureCore',
  '_labelOutlineThicknessTextureCore',
];

/**
 * Remove the viewports a mode change replaces. Cornerstone 4.22 setViewports keeps their VTK
 * renderers (actors, mappers, textures) in the shared window; disableElement removes them. Its
 * volume mapper counts its transfer-function textures privately, so deleting it never releases
 * them: unregister them first (VTK keeps a texture while another mapper still uses it).
 */
export const removeDicomViewports = (engine: RenderingEngine) => {
  for (const viewport of engine.getViewports()) {
    if (!getShouldUseCPURendering()) {
      const window = engine
        .getOffscreenMultiRenderWindow(viewport.id)
        .getOpenGLRenderWindow() as SharedTextureWindow;
      for (const { actor } of viewport.getActors()) {
        const mapper = window.getViewNodeFor((actor as { getMapper: () => unknown }).getMapper());
        if (!mapper) continue;
        Object.values(mapper.get(...VOLUME_MAPPER_TEXTURES)).forEach(texture =>
          window.unregisterGraphicsResourceUser(texture, mapper)
        );
      }
    }
    engine.disableElement(viewport.id);
  }
};

/** Invalidate the old GPU handle, retaining the verified voxels and marking every slice for upload. */
export const resetDicomVolumeGraphics = (engine: RenderingEngine, volumeId: string) => {
  const volume = cache.getVolume(volumeId);
  const viewport = engine.getViewports()[0];
  if (!volume || !viewport) return;
  const window = engine.getOffscreenMultiRenderWindow(viewport.id).getOpenGLRenderWindow();
  // VTK only resets texture dimensions/handle when the owning render window is supplied.
  (volume.vtkOpenGLTexture as vtkOpenGLTexture).releaseGraphicsResources(window);
  volume.invalidate();
};
