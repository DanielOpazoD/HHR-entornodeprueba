import { expect, it, vi } from 'vitest';
import type { RenderingEngine } from '@cornerstonejs/core';
const getVolume = vi.hoisted(() => vi.fn());
vi.mock('@cornerstonejs/core', () => ({
  cache: { getVolume },
  getShouldUseCPURendering: () => false,
}));
import { resetDicomVolumeGraphics } from '@/services/radiology/dicomGraphicsResources';
it('releases the GPU texture with its owning window before invalidating cached slices', () => {
  const calls: string[] = [];
  const owner = {};
  const releaseGraphicsResources = vi.fn(window => {
    expect(window).toBe(owner);
    calls.push('release');
  });
  getVolume.mockReturnValue({
    vtkOpenGLTexture: { releaseGraphicsResources },
    invalidate: () => calls.push('upload cached slices'),
  });
  const engine = {
    getViewports: () => [{ id: 'synthetic-viewport' }],
    getOffscreenMultiRenderWindow: () => ({ getOpenGLRenderWindow: () => owner }),
  } as unknown as RenderingEngine;
  resetDicomVolumeGraphics(engine, 'synthetic-volume');
  expect(calls).toEqual(['release', 'upload cached slices']);
});
