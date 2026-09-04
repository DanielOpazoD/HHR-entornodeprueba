// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/runtime-generation.js';
import '../../../extension/bridge-generation.js';

type Owner = {
  MAIN_WORLD_GENERATION_KEY: string;
  STORAGE_KEY: string;
  create: (dependencies: Record<string, unknown>) => {
    get: () => Promise<{ id: string; createdAt: number }>;
    bindMainWorld: (sender: Record<string, unknown>, generation: string) => Promise<boolean>;
    rotate: () => Promise<{ id: string; createdAt: number }>;
    start: () => boolean;
  };
};

const owner = (globalThis as unknown as { HhrRuntimeGeneration: Owner }).HhrRuntimeGeneration;

const createFixture = () => {
  const values: Record<string, unknown> = {};
  const installed: Array<() => void> = [];
  let sequence = 0;
  const chromeApi = {
    scripting: {
      executeScript: vi.fn(async () => [{ result: true }]),
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => Object.assign(values, entries)),
      },
    },
    runtime: {
      onInstalled: { addListener: vi.fn((listener: () => void) => installed.push(listener)) },
    },
  };
  const cryptoApi = {
    randomUUID: () => `aaaaaaaa-bbbb-4ccc-8ddd-${String(++sequence).padStart(12, '0')}`,
  };
  return { values, installed, chromeApi, cryptoApi };
};

describe('runtime generation (extension)', () => {
  it('reuses one generation across service-worker runtimes in the same loaded lifecycle', async () => {
    const fixture = createFixture();
    const first = owner.create({ ...fixture, now: () => 100 });

    const [left, right] = await Promise.all([first.get(), first.get()]);
    expect(left).toEqual(right);
    expect(fixture.chromeApi.storage.session.set).toHaveBeenCalledTimes(1);

    const restarted = owner.create({ ...fixture, now: () => 200 });
    await expect(restarted.get()).resolves.toEqual(left);
    expect(fixture.chromeApi.storage.session.set).toHaveBeenCalledTimes(1);
  });

  it('rotates before relays can bind when Chrome installs, reloads or updates the extension', async () => {
    const fixture = createFixture();
    const runtime = owner.create({ ...fixture, now: () => 100 });
    const previous = await runtime.get();
    expect(runtime.start()).toBe(true);

    fixture.installed.forEach(listener => listener());
    const current = await runtime.get();
    expect(current.id).not.toBe(previous.id);
    expect(current.createdAt).toBe(100);
  });

  it('binds Rayen MAIN world through Chrome injection instead of trusting page messages', async () => {
    const fixture = createFixture();
    const runtime = owner.create({ ...fixture, now: () => 100 });
    await expect(runtime.bindMainWorld({
      tab: { id: 9, url: 'https://fichamedico.rayensalud.cl/' },
      url: 'https://fichamedico.rayensalud.cl/',
      frameId: 0,
    }, 'generation-current')).resolves.toBe(true);
    expect(fixture.chromeApi.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 9, frameIds: [0] },
      world: 'MAIN',
      args: ['generation-current'],
    }));
  });

  it('never lets a page request replace the immutable MAIN-world generation', () => {
    const key = owner.MAIN_WORLD_GENERATION_KEY;
    const windowStub = {
      [key]: 'generation-original',
      location: { origin: 'https://fichamedico.rayensalud.cl' },
      postMessage: vi.fn(),
    };
    const bridge = (globalThis as unknown as {
      HhrBridgeGeneration: { createMain: (input: Record<string, unknown>) => {
        contextFor: (request: Record<string, unknown>) => Record<string, unknown>;
      } };
    }).HhrBridgeGeneration.createMain({ version: '0.48.10', windowRef: windowStub });

    expect(bridge.contextFor({ runtimeGeneration: 'generation-forged' })).toEqual({
      bridgeGeneration: 'generation-original',
      current: false,
    });
    expect(windowStub[key]).toBe('generation-original');
  });
});
