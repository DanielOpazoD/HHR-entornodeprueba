// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/health-check.js';
import '../../../extension/encounter-navigation.js';
import '../../../extension/connection-relay-recovery.js';
import '../../../extension/fichamedico-transport-runtime.js';
import '../../../extension/capture-read-recovery.js';

import { createRayenSyncRequestController } from '@/features/rayen-import/hooks/rayenSyncRequestLifecycle';

// Combined scenario: Ficha Médico tabs that answer the health ping but never answer the census
// read. The extension tries ready tabs one after another, each with its own message deadline,
// while HHR waits for the whole capture under a single request deadline. Synthetic tabs only.
const bridge = vi.hoisted(() => ({
  request: vi.fn(() => 'synthetic-sync-request'),
  cancel: vi.fn(),
}));
vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  requestRayenSyncBundle: bridge.request,
  cancelRayenSyncBundleRequest: bridge.cancel,
}));

type Tab = { id: number; active?: boolean; lastAccessed?: number };
type Response = Record<string, unknown>;

const globals = globalThis as typeof globalThis & {
  HhrExtensionHealth: Record<string, unknown>;
  HhrEncounterNavigation: Record<string, unknown>;
  HhrFichaMedicoTransportRuntime: {
    create: (dependencies: Record<string, unknown>) => {
      handleSnapshotRequest: () => Promise<Response>;
    };
  };
  HhrCaptureReadRecovery: {
    read: (input: Record<string, unknown>) => Promise<Response>;
  };
};

const backgroundSource = readFileSync(
  path.resolve(process.cwd(), 'extension/background.js'),
  'utf8'
);
const backgroundConstant = (name: string): number => {
  const match = backgroundSource.match(new RegExp(`const ${name} = ([\\d_]+);`));
  if (!match) throw new Error(`Missing ${name} in extension/background.js`);
  return Number(match[1].replaceAll('_', ''));
};
const TAB_MESSAGE_TIMEOUT_MS = backgroundConstant('TAB_MESSAGE_TIMEOUT_MS');
const HEALTH_PROBE_TIMEOUT_MS = backgroundConstant('HEALTH_PROBE_TIMEOUT_MS');

// Same contract as `withTimeout` in extension/background.js.
const withTimeout = (promise: Promise<unknown>, timeoutMs: number, message: string) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Object.assign(new Error(message), { code: 'HHR_TIMEOUT' })),
      timeoutMs
    );
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });

const createTransport = (readByTab: Record<number, () => Promise<Response>>) => {
  const tabs: Tab[] = [
    { id: 1, active: true, lastAccessed: 200 },
    { id: 2, lastAccessed: 100 },
  ];
  const sendMessage = vi.fn(async (tabId: number, message: { type: string }) =>
    message.type === 'RAYEN_EXTENSION_HEALTH_PING' ? { ready: true } : readByTab[tabId]()
  );
  const chrome = {
    tabs: { query: vi.fn(async () => tabs), sendMessage, update: vi.fn(), create: vi.fn() },
    windows: { update: vi.fn() },
  };
  const runtime = globals.HhrFichaMedicoTransportRuntime.create({
    chrome,
    extensionHealth: globals.HhrExtensionHealth,
    encounterNavigation: globals.HhrEncounterNavigation,
    withTimeout,
    tabMessageTimeoutMs: TAB_MESSAGE_TIMEOUT_MS,
    healthProbeTimeoutMs: HEALTH_PROBE_TIMEOUT_MS,
  });
  const readTabs = () =>
    sendMessage.mock.calls
      .filter(([, message]) => message.type === 'RAYEN_READ')
      .map(([tabId]) => tabId);
  return { runtime, readTabs };
};

const neverAnswers = () => new Promise<Response>(() => {});

/** Starts HHR's request deadline and the extension read on the same fake clock. */
const startCapture = (handleSnapshotRequest: () => Promise<Response>) => {
  const onHhrTimeout = vi.fn(() => Date.now());
  createRayenSyncRequestController().start('2026-07-03', '2026-07-03', 'run-1', onHhrTimeout);
  let settledAt: number | undefined;
  const read = handleSnapshotRequest().then(result => {
    settledAt = Date.now();
    return result;
  });
  return { read, onHhrTimeout, settledAt: () => settledAt };
};

describe('Ficha Médico tabs that pass the ping but stall on read', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    bridge.request.mockClear();
    bridge.cancel.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers from the next ready tab inside the HHR capture deadline', async () => {
    const { runtime, readTabs } = createTransport({
      1: neverAnswers,
      2: async () => ({ snapshot: { encounters: [] } }),
    });
    const capture = startCapture(runtime.handleSnapshotRequest);

    await vi.advanceTimersByTimeAsync(TAB_MESSAGE_TIMEOUT_MS);

    await expect(capture.read).resolves.toEqual({ snapshot: { encounters: [] } });
    expect(readTabs()).toEqual([1, 2]);
    expect(capture.settledAt()).toBe(TAB_MESSAGE_TIMEOUT_MS);
    expect(capture.onHhrTimeout).not.toHaveBeenCalled();
  });

  it('known limit: two stalled tabs outlast the HHR deadline and hide the tab timeout stage', async () => {
    const { runtime, readTabs } = createTransport({ 1: neverAnswers, 2: neverAnswers });
    const capture = startCapture(runtime.handleSnapshotRequest);

    await vi.advanceTimersByTimeAsync(2 * TAB_MESSAGE_TIMEOUT_MS);

    // HHR fails the run with its generic capture timeout and cancels the request first...
    expect(capture.onHhrTimeout).toHaveBeenCalledOnce();
    const hhrDeadline = capture.onHhrTimeout.mock.results[0].value as number;
    expect(hhrDeadline).toBeGreaterThan(TAB_MESSAGE_TIMEOUT_MS);
    expect(hhrDeadline).toBeLessThan(2 * TAB_MESSAGE_TIMEOUT_MS);
    // The 50 s / 75 s figures are documented in docs/SYNC_PERFORMANCE_REGRESSION_CHECKS.md.
    expect([TAB_MESSAGE_TIMEOUT_MS, hhrDeadline]).toEqual([50_000, 75_000]);
    expect(bridge.cancel).toHaveBeenCalledWith('synthetic-sync-request');

    // ...while the extension still reports the classified stage, but only afterwards.
    const result = await capture.read;
    expect(readTabs()).toEqual([1, 2]);
    expect(capture.settledAt()).toBe(2 * TAB_MESSAGE_TIMEOUT_MS);
    expect(result).toMatchObject({ timeoutStage: 'ficha_tab_relay' });

    // Capture recovery does not retry this result, so the wait is not repeated.
    const recover = async (fichaResult: Response) => {
      const readHealth = vi.fn();
      const reads = await globals.HhrCaptureReadRecovery.read({
        readFicha: async () => fichaResult,
        readGestion: async () => ({ ok: true, rows: [] }),
        readHealth,
        healthError: () => null,
        isCancelled: () => false,
        withinBudget: () => true,
      });
      return { reads, readHealth };
    };
    const stalled = await recover(result);
    expect(stalled.reads).toMatchObject({ snapshotResult: result, captureRetries: 0 });
    expect(stalled.readHealth).not.toHaveBeenCalled();

    // The staged timeout alone blocks the retry, even when its detail looks transient.
    const transientDetail = { ...result, error: 'No se pudo leer Rayen. Detalle: Failed to fetch' };
    const staged = await recover(transientDetail);
    expect(staged.reads).toMatchObject({ captureRetries: 0 });
    expect(staged.readHealth).not.toHaveBeenCalled();
    const unstaged = await recover({ error: transientDetail.error });
    expect(unstaged.reads).toMatchObject({ captureRetries: 1 });
  });
});
