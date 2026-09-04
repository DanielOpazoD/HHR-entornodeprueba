// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/connection-repair-runtime.js';

type Source = { status: string; reason: string };
type Report = { fichaMedico: Source; gestionCamas: Source; hhr: Source };
type Owner = {
  create: (dependencies: Record<string, unknown>) => {
    repair: () => Promise<Record<string, unknown>>;
  };
};

const owner = (globalThis as unknown as { HhrConnectionRepairRuntime: Owner })
  .HhrConnectionRepairRuntime;
const ready: Report = {
  fichaMedico: { status: 'ready', reason: 'connected' },
  gestionCamas: { status: 'ready', reason: 'connected' },
  hhr: { status: 'ready', reason: 'connected' },
};

const createFixture = (reports: Report[], maxAttempts = reports.length) => {
  const tabs = {
    create: vi.fn()
      .mockResolvedValueOnce({ id: 41 })
      .mockResolvedValueOnce({ id: 42 }),
    update: vi.fn(),
    remove: vi.fn(),
  };
  const readHealth = vi.fn(async () => reports.shift());
  const delay = vi.fn(async () => undefined);
  const runtime = owner.create({ chromeApi: { tabs }, readHealth, delay, maxAttempts });
  return { runtime, tabs, readHealth, delay };
};

describe('clean Eloisa connection repair', () => {
  it('opens new documents, preserves old tabs and waits for all three links to be current', async () => {
    const stale = {
      ...ready,
      fichaMedico: { status: 'stale', reason: 'outdated_tab' },
    };
    const { runtime, tabs, readHealth, delay } = createFixture([stale, ready]);

    await expect(runtime.repair()).resolves.toMatchObject({
      ok: true,
      state: 'connected',
      opened: { fichaMedicoTabId: 41, gestionCamasTabId: 42 },
      report: ready,
    });
    expect(tabs.create).toHaveBeenNthCalledWith(1, {
      url: 'https://fichamedico.rayensalud.cl/',
      active: true,
    });
    expect(tabs.create).toHaveBeenNthCalledWith(2, {
      url: 'https://hospitalizado.rayensalud.cl/',
      active: false,
    });
    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.remove).not.toHaveBeenCalled();
    expect(readHealth).toHaveBeenCalledTimes(2);
    expect(readHealth).toHaveBeenNthCalledWith(1, {
      fichaMedicoTabIds: [41],
      gestionCamasTabIds: [42],
    });
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('asks for manual login only after clean tabs remain explicitly session-expired', async () => {
    const expired = {
      ...ready,
      fichaMedico: { status: 'stale', reason: 'session_expired' },
      gestionCamas: { status: 'missing', reason: 'session_expired' },
    };
    const { runtime } = createFixture([expired, expired]);

    await expect(runtime.repair()).resolves.toMatchObject({
      ok: false,
      state: 'requires_login',
      requiresLogin: true,
      loginSources: ['fichaMedico', 'gestionCamas'],
      report: expired,
    });
  });

  it('does not claim success while the HHR relay remains disconnected', async () => {
    const disconnected = {
      ...ready,
      hhr: { status: 'stale', reason: 'relay_disconnected' },
    };
    const { runtime } = createFixture([disconnected]);

    await expect(runtime.repair()).resolves.toMatchObject({
      ok: false,
      state: 'incomplete',
      report: disconnected,
    });
  });
});
