// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-clinical-write-client-runtime.js';

type ClinicalWriteClientRuntime = {
  acknowledgeClinicalWrite: (
    receipt: Record<string, unknown> | null
  ) => Promise<Record<string, unknown>>;
  clinicalWriteKey: (kind: string, encId: string, instrument?: string) => string;
  finishRouteChangeWrite: (root: HTMLElement, state: string) => void;
  freezeClinicalModalForEncounterChange: (root: HTMLElement) => void;
  getActiveUncertainWrite: (key: string) => Record<string, unknown> | null;
  getClinicalGuard: (root: HTMLElement) => {
    dirty: Set<string>;
    pending: Set<string>;
    uncertain: Set<string>;
    confirming: boolean;
  };
  hydrateClinicalWriteProtection: (
    key: string,
    protection: Record<string, unknown> | null
  ) => Record<string, unknown> | null;
  releaseClinicalWriteProtection: (
    key: string,
    protection: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  runClinicalTransition: (
    root: HTMLElement,
    action: () => void,
    options?: { allowUncertain?: boolean }
  ) => boolean;
  setClinicalGuardState: (
    root: HTMLElement,
    state: 'dirty' | 'pending' | 'uncertain',
    key: string,
    active: boolean
  ) => void;
  uncertainClinicalWrites: Map<string, Record<string, unknown>>;
};

type RuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => ClinicalWriteClientRuntime;
};

const owner = () =>
  (globalThis as typeof globalThis & { HhrClinicalWriteClientRuntime: RuntimeOwner })
    .HhrClinicalWriteClientRuntime;

const ACK = 'RAYEN_CLINICAL_WRITE_ACK';
const RECOVERY = 'RAYEN_CLINICAL_WRITE_RECOVERY_REQUEST';
const recoveryChallenge = ['review', 'challenge', 'fixture'].join('-');
const receipt = {
  key: 'score:141437:CUDYR',
  generationId: 'generation-1',
  receiptId: 'receipt-1',
};

const makeRuntime = ({
  sendAck,
  sendMessage = vi.fn(async () => ({ ok: true })),
  requestPageConfirmation = vi.fn(async () => true),
  ackTimeoutMs = 9_000,
}: {
  sendAck?: (message: Record<string, unknown>, callback: (response?: unknown) => void) => void;
  sendMessage?: ReturnType<typeof vi.fn>;
  requestPageConfirmation?: ReturnType<typeof vi.fn>;
  ackTimeoutMs?: number;
} = {}) => {
  let runtimeLastError: { message: string } | undefined;
  const chromeApi = {
    runtime: {
      get lastError() {
        return runtimeLastError;
      },
      sendMessage: vi.fn(sendAck || ((_message, callback) => callback({ ok: true }))),
    },
  };
  const showPageNotice = vi.fn();
  const setRouteChangeState = vi.fn();
  const runtime = owner().create({
    chromeApi,
    windowRef: window,
    helper: { formatDateTimeLabel: (value: unknown) => `fecha:${String(value)}` },
    runtimeMessages: {
      CLINICAL_WRITE_ACK: ACK,
      CLINICAL_WRITE_RECOVERY_REQUEST: RECOVERY,
    },
    sendMessage,
    requestPageConfirmation,
    showPageNotice,
    setRouteChangeState,
    ackTimeoutMs,
  });
  return {
    runtime,
    chromeApi,
    sendMessage,
    requestPageConfirmation,
    showPageNotice,
    setRouteChangeState,
    setRuntimeLastError: (value: { message: string } | undefined) => {
      runtimeLastError = value;
    },
  };
};

describe('HHR clinical write client runtime', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('owns coordination, fails closed and loads before the content orchestrator', () => {
    const runtimeSource = readFileSync(
      path.resolve('extension/hhr-clinical-write-client-runtime.js'),
      'utf8'
    );
    const contentSource = readFileSync(
      path.resolve('extension/content-prescription-print.js'),
      'utf8'
    );
    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
      content_scripts: Array<{ matches?: string[]; js?: string[] }>;
    };
    const scripts = manifest.content_scripts
      .filter(entry => entry.matches?.includes('https://fichamedico.rayensalud.cl/*'))
      .flatMap(entry => entry.js || []);

    expect(Object.isFrozen(owner())).toBe(true);
    expect(() => owner().create({})).toThrow(
      'No se pudo inicializar el coordinador de escrituras clínicas HHR.'
    );
    expect(scripts.indexOf('hhr-clinical-write-client-runtime.js')).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf('hhr-clinical-write-client-runtime.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(contentSource).toContain(
      'const clinicalWriteClientOwner = globalThis.HhrClinicalWriteClientRuntime'
    );
    expect(contentSource).toContain('clinicalWriteClientOwner.create({');
    [
      'const acknowledgeClinicalWrite =',
      'const hydrateClinicalWriteProtection =',
      'const runClinicalTransition =',
      'const freezeClinicalModalForEncounterChange =',
    ].forEach(definition => {
      expect(runtimeSource).toContain(definition);
      expect(contentSource).not.toContain(definition);
    });
  });

  it('acknowledges an exact valid receipt and clears its timeout', async () => {
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const { runtime, chromeApi } = makeRuntime();

    await expect(runtime.acknowledgeClinicalWrite(receipt)).resolves.toEqual({ ok: true });
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith(
      { type: ACK, ...receipt },
      expect.any(Function)
    );
    expect(clearTimeout).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid receipts without messaging and preserves transport failures', async () => {
    const invalid = makeRuntime();
    await expect(invalid.runtime.acknowledgeClinicalWrite(null)).resolves.toEqual({
      error: 'Eloísa no entregó un acuse local verificable para este guardado.',
    });
    expect(invalid.chromeApi.runtime.sendMessage).not.toHaveBeenCalled();

    let callback: ((response?: unknown) => void) | undefined;
    const failed = makeRuntime({
      sendAck: (_message, next) => {
        callback = next;
      },
    });
    const pending = failed.runtime.acknowledgeClinicalWrite(receipt);
    failed.setRuntimeLastError({ message: 'worker desconectado' });
    callback?.();
    await expect(pending).resolves.toEqual({ error: 'worker desconectado' });
  });

  it('settles once on timeout and ignores a late callback', async () => {
    vi.useFakeTimers();
    let callback: ((response?: unknown) => void) | undefined;
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const { runtime } = makeRuntime({
      ackTimeoutMs: 50,
      sendAck: (_message, next) => {
        callback = next;
      },
    });

    const pending = runtime.acknowledgeClinicalWrite(receipt);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual({
      error: 'La extensión no confirmó el acuse local dentro del tiempo esperado.',
    });
    callback?.({ ok: true });
    expect(clearTimeout).toHaveBeenCalledTimes(1);
  });

  it('settles a thrown sendMessage once and clears the pending timer', async () => {
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const { runtime } = makeRuntime({
      sendAck: () => {
        throw new Error('contexto inválido');
      },
    });

    await expect(runtime.acknowledgeClinicalWrite(receipt)).resolves.toEqual({
      error: 'contexto inválido',
    });
    expect(clearTimeout).toHaveBeenCalledTimes(1);
  });

  it('hydrates protection and performs preview/confirm without changing the protocol', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        recoveryPreview: {
          challenge: recoveryChallenge,
          review: {
            kind: 'handoff',
            present: true,
            value: 'Paciente estable',
            dateTime: '2026-07-18T10:00:00-06:00',
            author: 'Enfermera HHR',
          },
        },
      })
      .mockResolvedValueOnce({ ok: true });
    const context = makeRuntime({ sendMessage });
    const marker = context.runtime.hydrateClinicalWriteProtection(receipt.key, {
      state: 'awaiting-ack',
      generationId: receipt.generationId,
      receiptId: receipt.receiptId,
      createdAt: 1234,
    });

    expect(context.runtime.getActiveUncertainWrite(receipt.key)).toEqual(marker);
    await expect(
      context.runtime.releaseClinicalWriteProtection(receipt.key, marker || {})
    ).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: RECOVERY,
      key: receipt.key,
      generationId: receipt.generationId,
      phase: 'preview',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: RECOVERY,
      key: receipt.key,
      generationId: receipt.generationId,
      phase: 'confirm',
      ['recovery' + 'Token']: recoveryChallenge,
    });
    expect(context.requestPageConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Revisión del último guardado',
        message: expect.stringContaining('Paciente estable'),
      })
    );

    expect(context.runtime.hydrateClinicalWriteProtection(receipt.key, null)).toBeNull();
    expect(context.runtime.getActiveUncertainWrite(receipt.key)).toBeNull();
  });

  it('blocks pending and dirty transitions while uncertain state remains fail-closed', async () => {
    const confirmation = vi.fn(async () => true);
    const context = makeRuntime({ requestPageConfirmation: confirmation });
    const root = document.createElement('section');
    document.body.appendChild(root);
    const action = vi.fn();

    context.runtime.setClinicalGuardState(root, 'pending', 'handoff:1', true);
    expect(context.runtime.runClinicalTransition(root, action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(context.setRouteChangeState).toHaveBeenCalledWith(
      root,
      'Guardado clínico en curso · espera su confirmación',
      'uncertain'
    );

    context.runtime.setClinicalGuardState(root, 'pending', 'handoff:1', false);
    context.runtime.setClinicalGuardState(root, 'dirty', 'handoff:1', true);
    expect(context.runtime.runClinicalTransition(root, action)).toBe(false);
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(context.runtime.getClinicalGuard(root).dirty.size).toBe(0);

    context.runtime.setClinicalGuardState(root, 'uncertain', 'handoff:1', true);
    expect(context.runtime.runClinicalTransition(root, action)).toBe(true);
    expect(action).toHaveBeenCalledTimes(2);
    expect(context.showPageNotice).toHaveBeenCalledWith(
      expect.stringContaining('protección contra duplicados se mantiene activa'),
      { title: 'Verificación pendiente' }
    );
  });

  it('freezes a stale encounter and reports completion only after pending writes settle', () => {
    document.body.innerHTML = `
      <section id="modal"><header class="hhr-center-header"></header>
        <button class="hhr-rx-close">Cerrar</button><input id="clinical-input"></section>
    `;
    const root = document.getElementById('modal') as HTMLElement;
    const input = document.getElementById('clinical-input') as HTMLInputElement;
    const context = makeRuntime();
    const inputSpy = vi.fn();
    input.addEventListener('input', inputSpy);

    context.runtime.freezeClinicalModalForEncounterChange(root);
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    expect(root.dataset.routeStale).toBe('true');
    expect(root.querySelector('.hhr-route-change-state')).not.toBeNull();
    expect(inputSpy).not.toHaveBeenCalled();

    context.runtime.setClinicalGuardState(root, 'pending', receipt.key, true);
    context.runtime.finishRouteChangeWrite(root, 'synced');
    expect(context.setRouteChangeState).toHaveBeenLastCalledWith(
      root,
      'Episodio cambió · esperando confirmación del guardado'
    );
    context.runtime.setClinicalGuardState(root, 'pending', receipt.key, false);
    context.runtime.finishRouteChangeWrite(root, 'synced');
    expect(context.setRouteChangeState).toHaveBeenLastCalledWith(
      root,
      'Episodio cambió · guardado confirmado',
      'synced'
    );
  });
});
