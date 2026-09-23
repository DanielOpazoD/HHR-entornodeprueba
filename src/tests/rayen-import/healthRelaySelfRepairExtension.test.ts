// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/health-relay-self-repair.js';

type SelfRepair = {
  create: (options: {
    repairRelay: (file: string) => Promise<unknown>;
    publishHealth?: () => Promise<unknown>;
    now?: () => number;
    cooldownMs?: number;
    log?: (...args: unknown[]) => void;
  }) => { schedule: (report: Record<string, unknown>) => void };
};

const selfRepair = (globalThis as unknown as { HhrHealthRelaySelfRepair: SelfRepair })
  .HhrHealthRelaySelfRepair;
const disconnected = { status: 'stale', reason: 'relay_disconnected' };
const connected = { status: 'ready', reason: 'connected' };

describe('health relay self-repair', () => {
  it('repairs only the orphaned clinical relay and never opens a clean tab', async () => {
    const repairRelay = vi.fn(async () => ({ injectedTabs: 1 }));
    const runtime = selfRepair.create({ repairRelay });

    runtime.schedule({ fichaMedico: connected, gestionCamas: disconnected, hhr: connected });

    await vi.waitFor(() =>
      expect(repairRelay).toHaveBeenCalledExactlyOnceWith('content-gestioncamas.js')
    );
  });

  it('coalesces repeated diagnoses and bounds retries after a failed repair', async () => {
    let now = 10_000;
    let release: ((value: unknown) => void) | undefined;
    const repairRelay = vi.fn(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    const runtime = selfRepair.create({ repairRelay, now: () => now, cooldownMs: 30_000 });

    runtime.schedule({ fichaMedico: disconnected });
    runtime.schedule({ fichaMedico: disconnected });
    await vi.waitFor(() => expect(repairRelay).toHaveBeenCalledTimes(1));
    release?.({ injectedTabs: 0, failedTabs: 1 });
    await Promise.resolve();
    await Promise.resolve();
    runtime.schedule({ fichaMedico: disconnected });
    expect(repairRelay).toHaveBeenCalledTimes(1);

    now += 30_000;
    await vi.waitFor(() => {
      runtime.schedule({ fichaMedico: disconnected });
      expect(repairRelay).toHaveBeenCalledTimes(2);
    });
  });

  it('retries a new disconnection immediately after a successful repair', async () => {
    const repairRelay = vi.fn(async () => ({ complete: true, injectedTabs: 1 }));
    const runtime = selfRepair.create({ repairRelay, now: () => 10_000 });

    runtime.schedule({ hhr: disconnected });
    await vi.waitFor(() => expect(repairRelay).toHaveBeenCalledTimes(1));
    runtime.schedule({ hhr: connected });
    runtime.schedule({ hhr: disconnected });
    await vi.waitFor(() => expect(repairRelay).toHaveBeenCalledTimes(2));
  });

  it('does not loop when an injected relay remains disconnected', async () => {
    let now = 10_000;
    const repairRelay = vi.fn(async () => ({ complete: true, injectedTabs: 1 }));
    const runtime = selfRepair.create({ repairRelay, now: () => now, cooldownMs: 30_000 });

    runtime.schedule({ hhr: disconnected });
    await vi.waitFor(() => expect(repairRelay).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setImmediate(resolve));
    runtime.schedule({ hhr: disconnected });
    expect(repairRelay).toHaveBeenCalledTimes(1);
    now = 39_999;
    runtime.schedule({ hhr: disconnected });
    expect(repairRelay).toHaveBeenCalledTimes(1);
    now = 40_000;
    await vi.waitFor(() => {
      runtime.schedule({ hhr: disconnected });
      expect(repairRelay).toHaveBeenCalledTimes(2);
    });
  });

  it('starts the cooldown when a slow repair fails', async () => {
    let now = 10_000;
    let fail: ((error: Error) => void) | undefined;
    const repairRelay = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const log = vi.fn();
    const runtime = selfRepair.create({
      repairRelay,
      now: () => now,
      cooldownMs: 30_000,
      log,
    });

    runtime.schedule({ gestionCamas: disconnected });
    await vi.waitFor(() => expect(repairRelay).toHaveBeenCalledTimes(1));
    now = 40_000;
    fail?.(new Error('receiver unavailable'));
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      runtime.schedule({ gestionCamas: disconnected });
      expect(repairRelay).toHaveBeenCalledTimes(1);
    });
    now = 69_999;
    runtime.schedule({ gestionCamas: disconnected });
    expect(repairRelay).toHaveBeenCalledTimes(1);
    now = 70_000;
    await vi.waitFor(() => {
      runtime.schedule({ gestionCamas: disconnected });
      expect(repairRelay).toHaveBeenCalledTimes(2);
    });
  });

  it('does not reinterpret expired sessions or incompatible readers as missing relays', async () => {
    const repairRelay = vi.fn(async () => undefined);
    const runtime = selfRepair.create({ repairRelay });

    runtime.schedule({
      fichaMedico: { status: 'stale', reason: 'session_expired' },
      gestionCamas: { status: 'stale', reason: 'outdated_tab' },
      hhr: { status: 'missing', reason: 'tab_missing' },
    });
    await Promise.resolve();

    expect(repairRelay).not.toHaveBeenCalled();
  });

  it('publishes a second healthy probe even when reinjection was unnecessary', async () => {
    const repairRelay = vi.fn(async () => ({ complete: true, injectedTabs: 0 }));
    const publishHealth = vi.fn(async () => undefined);
    const runtime = selfRepair.create({ repairRelay, publishHealth });

    runtime.schedule({ hhr: disconnected });

    await vi.waitFor(() => expect(publishHealth).toHaveBeenCalledTimes(1));
    expect(repairRelay).toHaveBeenCalledExactlyOnceWith('content-hhr.js');
  });
});
