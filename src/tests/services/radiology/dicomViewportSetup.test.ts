import { expect, it, vi } from 'vitest';
import type { RenderingEngine } from '@cornerstonejs/core';
vi.mock('@cornerstonejs/core', () => ({
  cache: {},
  getShouldUseCPURendering: () => false,
  Enums: {
    OrientationAxis: { AXIAL: 'axial', CORONAL: 'coronal', SAGITTAL: 'sagittal' },
    ViewportType: { STACK: 'stack', VOLUME_3D: 'volume3d', ORTHOGRAPHIC: 'orthographic' },
  },
}));
vi.mock('@cornerstonejs/tools', () => ({
  ToolGroupManager: {
    createToolGroup: () => ({ addTool: vi.fn(), addViewport: vi.fn(), setToolActive: vi.fn() }),
  },
  StackScrollTool: { toolName: 'StackScroll' },
  Enums: { MouseBindings: { Wheel: 'wheel' } },
}));
vi.mock('@/features/radiology/services/dicomInitialization', () => ({ dicomTools: [] }));
import { configureDicomViewports } from '@/features/radiology/services/dicomViewportSetup';

/**
 * Mirrors Cornerstone 4.22 on one shared VTK window: setViewports forgets the old viewports
 * but keeps their renderers, and a deleted volume mapper leaves its textures registered.
 */
const syntheticEngine = () => {
  let viewports: string[] = [];
  const renderers = new Set<string>();
  const textures = new Map<string, Set<object>>();
  const mappers = new Map<string, { get: () => object }>();
  const window = {
    getViewNodeFor: (renderable: string) => mappers.get(renderable),
    unregisterGraphicsResourceUser: (texture: string, user: object) => {
      textures.get(texture)?.delete(user);
      if (!textures.get(texture)?.size) textures.delete(texture);
    },
  };
  const engine = {
    getViewports: () =>
      viewports.map(id => ({ id, getActors: () => [{ actor: { getMapper: () => id } }] })),
    getOffscreenMultiRenderWindow: () => ({ getOpenGLRenderWindow: () => window }),
    disableElement: (id: string) => {
      renderers.delete(id);
      viewports = viewports.filter(value => value !== id);
    },
    setViewports: (entries: { viewportId: string }[]) => {
      viewports = entries.map(entry => entry.viewportId);
      for (const id of viewports) {
        renderers.add(id);
        const mapper = { get: () => ({ _colorTextureCore: `${id}-color` }) };
        mappers.set(id, mapper);
        textures.set(`${id}-color`, new Set([mapper]));
      }
    },
  };
  return { engine: engine as unknown as RenderingEngine, renderers, textures };
};

it('keeps only the current mode renderers and textures after repeated mode changes', () => {
  const { engine, renderers, textures } = syntheticEngine();
  const elements = [0, 1, 2].map(() => document.createElement('div'));
  for (let i = 0; i < 3; i++) {
    configureDicomViewports(engine, elements.slice(0, 1), 'synthetic', '3d');
    configureDicomViewports(engine, elements.slice(0, 1), 'synthetic', 'original');
    configureDicomViewports(engine, elements, 'synthetic', 'mpr');
  }
  const current = ['synthetic-mpr-0', 'synthetic-mpr-1', 'synthetic-mpr-2'];
  expect([...renderers]).toEqual(current);
  expect([...textures.keys()]).toEqual(current.map(id => `${id}-color`));
});
