// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-connection-repair-controls.js';

type ControlsOwner = {
  diagnosticText: (report: unknown) => string;
  create: (dependencies: Record<string, unknown>) => {
    attach: (dependencies: Record<string, unknown>) => void;
  };
};

const owner = () => (globalThis as unknown as {
  HhrConnectionRepairControls: ControlsOwner;
}).HhrConnectionRepairControls;

const report = () => ({
  version: '0.48.10',
  runtimeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  fichaMedico: { status: 'ready', reason: 'connected' },
  gestionCamas: { status: 'ready', reason: 'connected' },
  hhr: { status: 'ready', reason: 'connected' },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('connection repair controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('recommends verification instead of claiming an unverified session is current', () => {
    const unverified = report();
    unverified.fichaMedico.reason = 'session_unverified';
    unverified.fichaMedico.status = 'stale';
    expect(owner().diagnosticText(unverified)).toContain(
      'Acción recomendada: comprobar la sesión en las pestañas nuevas'
    );
  });

  it('re-enables repair controls when a newer action invalidates the pending response', async () => {
    const pendingRepair = deferred<unknown>();
    const repair = document.createElement('button');
    const copy = document.createElement('button');
    document.body.append(repair, copy);
    let currentAction = 0;
    const controls = owner().create({
      documentRef: document,
      windowRef: window,
      runtimeMessages: { CONNECTION_REPAIR_REQUEST: 'CONNECTION_REPAIR_REQUEST' },
      sendMessage: vi.fn(() => pendingRepair.promise),
    });
    controls.attach({
      repair,
      copy,
      beginAction: () => ++currentAction,
      isActionCurrent: (action: number) => action === currentAction,
      setFeedback: vi.fn(),
      load: vi.fn(),
      getReport: vi.fn(),
      rememberReport: vi.fn(),
    });

    repair.click();
    expect(repair.disabled).toBe(true);
    expect(copy.disabled).toBe(true);
    currentAction += 1;
    pendingRepair.resolve({ ok: true, report: report() });
    await flush();

    expect(repair.disabled).toBe(false);
    expect(copy.disabled).toBe(false);
  });
});
