// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/runtime-generation-recovery.js';
import '../../../extension/runtime-generation.js';
import '../../../extension/bridge-generation-main.js';

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
  const openReaderGenerations: string[] = [];
  const unreadableReaderTabIds = new Set<number>();
  let sequence = 0;
  const chromeApi = {
    scripting: {
      executeScript: vi.fn(async (details: { args?: unknown[]; target: { tabId: number } }) => {
        if (!details.args && unreadableReaderTabIds.has(details.target.tabId)) {
          throw new Error('tab transiently unavailable');
        }
        return details.args
          ? [{ result: true }]
          : [{ result: openReaderGenerations[details.target.tabId - 1] || '' }];
      }),
    },
    tabs: {
      query: vi.fn(async () =>
        openReaderGenerations.map((_generation, index) => ({ id: index + 1 }))
      ),
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
  return {
    values,
    installed,
    openReaderGenerations,
    unreadableReaderTabIds,
    chromeApi,
    cryptoApi,
  };
};

describe('runtime generation (extension)', () => {
  it('loads different bridge owners in MAIN and ISOLATED worlds', () => {
    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
      content_scripts: Array<{ js?: string[]; world?: string }>;
    };
    const mainFiles = new Set(
      manifest.content_scripts
        .filter(entry => entry.world === 'MAIN')
        .flatMap(entry => entry.js || [])
    );
    const isolatedFiles = new Set(
      manifest.content_scripts
        .filter(entry => entry.world !== 'MAIN')
        .flatMap(entry => entry.js || [])
    );

    expect(mainFiles).toContain('bridge-generation-main.js');
    expect(isolatedFiles).toContain('bridge-generation.js');
    expect(mainFiles).not.toContain('bridge-generation.js');
    expect(isolatedFiles).not.toContain('bridge-generation-main.js');
  });

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

  it('recovers the surviving MAIN generation when Chrome clears session storage on update', async () => {
    const fixture = createFixture();
    const runtime = owner.create({ ...fixture, now: () => 100 });
    const previous = await runtime.get();
    expect(runtime.start()).toBe(true);

    delete fixture.values[owner.STORAGE_KEY];
    fixture.openReaderGenerations.push(previous.id);
    const updated = owner.create({ ...fixture, now: () => 200 });
    const current = await updated.get();
    expect(current.id).toBe(previous.id);
    expect(current.createdAt).toBe(200);
    expect(fixture.chromeApi.runtime.onInstalled.addListener).not.toHaveBeenCalled();
  });

  it('creates a fresh generation after browser restart when no MAIN reader survives', async () => {
    const fixture = createFixture();
    const first = owner.create({ ...fixture, now: () => 100 });
    const previous = await first.get();
    delete fixture.values[owner.STORAGE_KEY];

    const restarted = owner.create({ ...fixture, now: () => 200 });
    const current = await restarted.get();

    expect(current.id).not.toBe(previous.id);
    expect(current.createdAt).toBe(200);
  });

  it('fails closed whenever open readers disagree, even if one has a majority', async () => {
    const fixture = createFixture();
    fixture.openReaderGenerations.push(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      'ffffffff-1111-4222-8333-444444444444'
    );

    const runtime = owner.create({ ...fixture, now: () => 300 });
    const current = await runtime.get();

    expect(current.id).not.toBe(fixture.openReaderGenerations[0]);
    expect(current.id).not.toBe(fixture.openReaderGenerations[1]);
  });

  it('recovers readable consensus while a discarded reader is temporarily unavailable', async () => {
    const fixture = createFixture();
    fixture.openReaderGenerations.push(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    );
    fixture.unreadableReaderTabIds.add(2);

    const runtime = owner.create({ ...fixture, now: () => 300 });
    const current = await runtime.get();

    expect(current.id).toBe(fixture.openReaderGenerations[0]);
  });

  it('rotates only when a clean repair explicitly requests a new lifecycle', async () => {
    const fixture = createFixture();
    const runtime = owner.create({ ...fixture, now: () => 100 });
    const previous = await runtime.get();

    const current = await runtime.rotate();

    expect(current.id).not.toBe(previous.id);
    expect(current.createdAt).toBe(100);
  });

  it('binds Rayen MAIN world through Chrome injection instead of trusting page messages', async () => {
    const fixture = createFixture();
    const runtime = owner.create({ ...fixture, now: () => 100 });
    await expect(
      runtime.bindMainWorld(
        {
          tab: { id: 9, url: 'https://fichamedico.rayensalud.cl/' },
          url: 'https://fichamedico.rayensalud.cl/',
          frameId: 0,
        },
        'generation-current'
      )
    ).resolves.toBe(true);
    expect(fixture.chromeApi.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 9, frameIds: [0] },
        world: 'MAIN',
        args: ['generation-current'],
      })
    );
  });

  it('never lets a page request replace the immutable MAIN-world generation', () => {
    const key = owner.MAIN_WORLD_GENERATION_KEY;
    const windowStub = {
      [key]: 'generation-original',
      location: { origin: 'https://fichamedico.rayensalud.cl' },
      postMessage: vi.fn(),
    };
    const bridge = (
      globalThis as unknown as {
        HhrBridgeGeneration: {
          createMain: (input: Record<string, unknown>) => {
            contextFor: (request: Record<string, unknown>) => Record<string, unknown>;
          };
        };
      }
    ).HhrBridgeGeneration.createMain({ version: '0.48.11', windowRef: windowStub });

    expect(bridge.contextFor({ runtimeGeneration: 'generation-forged' })).toEqual({
      bridgeGeneration: 'generation-original',
      current: false,
    });
    expect(windowStub[key]).toBe('generation-original');
  });
});
