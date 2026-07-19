// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/message-contract.js';
import '../../../extension/hhr-ui.js';
import '../../../extension/hhr-center-styles.js';
import '../../../extension/hhr-center-shell-runtime.js';
import '../../../extension/hhr-prescription-center.js';
import '../../../extension/hhr-hospitalized-documents-center.js';
import '../../../extension/hhr-handoff-center.js';
import '../../../extension/hhr-scores-center.js';
import '../../../extension/hhr-lab-center.js';
import '../../../extension/hhr-discharge-actions-runtime.js';
import '../../../extension/hhr-medication-actions-runtime.js';
import '../../../extension/prescription-print.js';

type HandoffRuntime = {
  renderHandoffCenter: (root: HTMLElement, encId: string) => void;
};

type ScoresRuntime = {
  renderScoresCenter: (root: HTMLElement, encId: string) => void;
};

type HandoffRuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => HandoffRuntime;
};

type ScoresRuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => ScoresRuntime;
};

const handoffRuntimeOwner = () =>
  (globalThis as unknown as { HhrHandoffCenterRuntime: HandoffRuntimeOwner })
    .HhrHandoffCenterRuntime;

const scoresRuntimeOwner = () =>
  (globalThis as unknown as { HhrScoresCenterRuntime: ScoresRuntimeOwner })
    .HhrScoresCenterRuntime;

const runtimeMessages = {
  HANDOFF_OPTIONS_REQUEST: 'RAYEN_HANDOFF_OPTIONS_REQUEST',
  HANDOFF_REPORT_REQUEST: 'RAYEN_HANDOFF_REPORT_REQUEST',
  HANDOFF_SAVE_REQUEST: 'RAYEN_HANDOFF_SAVE_REQUEST',
  SCORES_OPTIONS_REQUEST: 'RAYEN_SCORES_OPTIONS_REQUEST',
  SCORE_FORM_REQUEST: 'RAYEN_SCORE_FORM_REQUEST',
  SCORE_SAVE_REQUEST: 'RAYEN_SCORE_SAVE_REQUEST',
};

const makeRoot = (module: 'handoff' | 'scores') => {
  const root = document.createElement('div');
  root.dataset.activeModule = module;
  root.innerHTML = '<main class="hhr-center-main"></main>';
  document.body.appendChild(root);
  return root;
};

const makeDependencies = (sendMessage: (message: Record<string, unknown>) => Promise<unknown>) => {
  const uncertainClinicalWrites = new Map<string, unknown>();
  return {
    helper: {
      formatDateTimeLabel: (value: unknown) => String(value || ''),
      cudyrSourceNotice: () => 'Fuente CUDYR verificada.',
    },
    runtimeMessages,
    runClinicalTransition: (_root: HTMLElement, action: () => void) => {
      action();
      return true;
    },
    normalizedText: (value: unknown) => String(value || '').trim().toLowerCase(),
    sendMessage,
    setLiveRegion: (element: HTMLElement, text: string, state = '') => {
      element.textContent = text;
      element.dataset.state = state;
    },
    clinicalWriteKey: (kind: string, encId: string, instrument = '') =>
      [kind, encId, instrument].filter(Boolean).join(':'),
    hydrateClinicalWriteProtection: () => null,
    setClinicalGuardState: vi.fn(),
    setSyncState: (element: HTMLElement, text: string, state = '') => {
      element.textContent = text;
      element.dataset.state = state;
    },
    releaseClinicalWriteProtection: vi.fn(async () => ({ ok: true })),
    uncertainClinicalWrites,
    normalizedClinicalText: (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim(),
    finishRouteChangeWrite: vi.fn(),
    acknowledgeClinicalWrite: vi.fn(async () => ({ ok: true })),
    clinicalWriteRecoveryReady: () => true,
    getActiveUncertainWrite: (key: string) => uncertainClinicalWrites.get(key) || null,
    showPageNotice: vi.fn(),
    trapModalFocus: vi.fn(),
  };
};

const handoffResponse = (label: string) => ({
  batchId: 'handoff-batch',
  handoffLabel: label,
  handoffKind: 'medical',
  currentProfessionalRole: 'Médico',
  currentProfessional: 'Dra. Ana',
  canPrint: true,
  canWrite: true,
  nurseStations: [],
  patients: [],
});

const NativeMutationObserver = globalThis.MutationObserver;
const contentObservers = new Set<MutationObserver>();
const contentSource = readFileSync(
  path.resolve('extension/content-prescription-print.js'),
  'utf8'
);

describe('Centro HHR Turno y Scores runtime', () => {
  afterEach(() => {
    contentObservers.forEach(observer => observer.disconnect());
    contentObservers.clear();
    delete (globalThis as typeof globalThis & { __hhrPrescriptionPrintInjected?: boolean })
      .__hhrPrescriptionPrintInjected;
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-hhr-prescription-print-script');
    document.documentElement.removeAttribute('data-hhr-prescription-print-state');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps one modal root through Inicio, Turno, Scores and Inicio, then unmounts it', async () => {
    vi.stubGlobal(
      'MutationObserver',
      class extends NativeMutationObserver {
        constructor(callback: MutationCallback) {
          super(callback);
          contentObservers.add(this);
        }
      }
    );
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    window.history.replaceState({}, '', '/dashboard/encounter-list-nurse/141121');
    const sendMessage = vi.fn(
      (message: { type?: string }, callback: (response: unknown) => void) => {
        if (message.type === 'RAYEN_EXTENSION_HEALTH_REQUEST') {
          callback({ fichaMedico: { status: 'ready', identity: {} }, gestionCamas: { status: 'missing' } });
          return;
        }
        if (message.type === runtimeMessages.HANDOFF_OPTIONS_REQUEST) {
          callback(handoffResponse('Entrega médica'));
          return;
        }
        if (message.type === runtimeMessages.SCORES_OPTIONS_REQUEST) {
          callback({ batchId: 'scores-batch', canWrite: true, patients: [] });
          return;
        }
        callback({ ok: true });
      }
    );
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          getManifest: () => ({ version: '0.31.0' }),
          getURL: (value: string) => `chrome-extension://test/${value}`,
          lastError: undefined,
          sendMessage,
        },
        storage: { local: { get: vi.fn(), set: vi.fn() } },
      },
    });

    vm.runInThisContext(contentSource, { filename: 'content-prescription-print.js' });
    const bar = await vi.waitFor(() => {
      const element = document.getElementById('hhr-clinical-operations-bar');
      expect(element).not.toBeNull();
      expect(element?.shadowRoot).not.toBeNull();
      return element as HTMLElement;
    });
    bar.shadowRoot?.querySelector<HTMLButtonElement>('.brand')?.click();
    const root = await vi.waitFor(() => {
      const element = document.getElementById('hhr-prescription-print-modal');
      expect(element?.querySelector('.hhr-center-heading')?.textContent).toBe('Inicio');
      return element as HTMLElement;
    });

    root.querySelector<HTMLButtonElement>('[data-module="handoff"]')?.click();
    await vi.waitFor(() => {
      expect(root.querySelector('.hhr-center-heading')?.textContent).toBe('Entrega médica');
      expect(document.getElementById('hhr-prescription-print-modal')).toBe(root);
    });
    root.querySelector<HTMLButtonElement>('[data-module="scores"]')?.click();
    await vi.waitFor(() => {
      expect(root.querySelector('.hhr-center-heading')?.textContent).toBe('Scores');
      expect(document.getElementById('hhr-prescription-print-modal')).toBe(root);
    });
    root.querySelector<HTMLButtonElement>('[data-module="home"]')?.click();
    expect(root.querySelector('.hhr-center-heading')?.textContent).toBe('Inicio');
    expect(document.getElementById('hhr-prescription-print-modal')).toBe(root);

    root.querySelector<HTMLButtonElement>('.hhr-rx-close')?.click();
    expect(root.isConnected).toBe(false);
  });

  it('ignores obsolete handoff renders and detached score renders', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const sendMessage = vi.fn(() => new Promise(resolve => pending.push(resolve)));
    const handoffRuntime = handoffRuntimeOwner().create(
      makeDependencies(sendMessage)
    );
    const handoffRoot = makeRoot('handoff');

    handoffRuntime.renderHandoffCenter(handoffRoot, '101');
    handoffRuntime.renderHandoffCenter(handoffRoot, '101');
    pending[1](handoffResponse('Respuesta vigente'));
    await vi.waitFor(() => {
      expect(handoffRoot.querySelector('.hhr-center-heading')?.textContent).toBe('Respuesta vigente');
    });
    pending[0](handoffResponse('Respuesta obsoleta'));
    await Promise.resolve();
    expect(handoffRoot.querySelector('.hhr-center-heading')?.textContent).toBe('Respuesta vigente');

    const scoresRoot = makeRoot('scores');
    const scoresRuntime = scoresRuntimeOwner().create(makeDependencies(sendMessage));
    scoresRuntime.renderScoresCenter(scoresRoot, '202');
    scoresRoot.remove();
    pending[2]({ batchId: 'scores-batch', canWrite: true, patients: [] });
    await Promise.resolve();
    expect(scoresRoot.querySelector('.hhr-center-empty')?.textContent).toContain('Leyendo instrumentos');
  });

  it('sends the unchanged Turno save contract', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
      messages.push(message);
      if (message.type === runtimeMessages.HANDOFF_OPTIONS_REQUEST) {
        return {
          ...handoffResponse('Entrega médica'),
          patients: [{
            encounterId: '303',
            name: 'Paciente Turno',
            run: '1-9',
            bed: 'C1',
            service: 'MQ',
            latestMedical: null,
            latestNursing: null,
          }],
        };
      }
      if (message.type === runtimeMessages.HANDOFF_SAVE_REQUEST) {
        return {
          record: { observation: 'Paciente estable', dateTime: '2026-07-18T08:00:00Z' },
          clinicalWriteReceipt: { key: 'handoff:303', generationId: 'g1', receiptId: 'r1' },
        };
      }
      return { ok: true };
    });
    const runtime = handoffRuntimeOwner().create(makeDependencies(sendMessage));
    const root = makeRoot('handoff');
    runtime.renderHandoffCenter(root, '303');
    const textarea = await vi.waitFor(() => {
      const element = root.querySelector<HTMLTextAreaElement>('.hhr-handoff-input');
      expect(element).not.toBeNull();
      return element as HTMLTextAreaElement;
    });
    textarea.value = 'Paciente estable';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.hhr-handoff-save')?.click();

    await vi.waitFor(() => {
      expect(messages).toContainEqual({
        type: runtimeMessages.HANDOFF_SAVE_REQUEST,
        batchId: 'handoff-batch',
        encId: '303',
        observation: 'Paciente estable',
      });
    });
  });

  it('sends the unchanged Score save contract', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
      messages.push(message);
      if (message.type === runtimeMessages.SCORES_OPTIONS_REQUEST) {
        return {
          batchId: 'scores-batch',
          canWrite: true,
          currentProfessional: 'Enf. Ana',
          patients: [{
            encounterId: '404',
            name: 'Paciente Score',
            run: '2-7',
            bed: 'C2',
            service: 'MQ',
            scores: { CUDYR: null },
            scoreProtections: {},
            scoreUnavailableReasons: {},
          }],
        };
      }
      if (message.type === runtimeMessages.SCORE_FORM_REQUEST) {
        return {
          definition: {
            fields: [{
              id: 'dependencia',
              label: 'Dependencia',
              type: 1,
              typeId: 1,
              options: [{ id: 'dep-2', value: 2, score: 2, description: 'Dependencia leve' }],
            }],
            results: [],
          },
        };
      }
      if (message.type === runtimeMessages.SCORE_SAVE_REQUEST) {
        return {
          record: { total: 'D3', dependency: 2, risk: 0, dateTime: '2026-07-18T08:00:00Z' },
          clinicalWriteReceipt: { key: 'score:404:CUDYR', generationId: 'g2', receiptId: 'r2' },
        };
      }
      return { ok: true };
    });
    const runtime = scoresRuntimeOwner().create(makeDependencies(sendMessage));
    const root = makeRoot('scores');
    runtime.renderScoresCenter(root, '404');
    const register = await vi.waitFor(() => {
      const element = root.querySelector<HTMLButtonElement>('.hhr-scores-table .hhr-center-action');
      expect(element?.textContent).toBe('Registrar');
      return element as HTMLButtonElement;
    });
    register.click();
    const control = await vi.waitFor(() => {
      const element = root.querySelector<HTMLSelectElement>('.hhr-score-control');
      expect(element).not.toBeNull();
      return element as HTMLSelectElement;
    });
    control.value = '2';
    control.dispatchEvent(new Event('change', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.hhr-score-save')?.click();

    await vi.waitFor(() => {
      expect(messages).toContainEqual({
        type: runtimeMessages.SCORE_SAVE_REQUEST,
        batchId: 'scores-batch',
        encId: '404',
        instrument: 'CUDYR',
        answers: { dependencia: '2' },
      });
    });
  });
});
