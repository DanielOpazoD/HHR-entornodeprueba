// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-center-shell-runtime.js';

type Runtime = {
  openCenterModule: (module: string | undefined, encId: string, trigger?: HTMLElement) => void;
  prepareCenterModalRoot: (options: {
    existingRoot?: HTMLElement | null;
    activeModule: string;
    encId: string;
    focusReturnTarget?: HTMLElement | null;
  }) => HTMLElement | null;
  setupCenterPatientContext: (
    root: HTMLElement,
    module: string,
    initialEncId: string,
    renderModule: (encId: string) => void
  ) => void;
};

type RuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => Runtime;
};

const owner = () =>
  (globalThis as unknown as { HhrCenterShellRuntime: RuntimeOwner }).HhrCenterShellRuntime;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
};

const createRuntime = (overrides: Record<string, unknown> = {}) => {
  const openOperationsCenter = vi.fn(
    (module: string, encId: string, _trigger?: HTMLElement, existingRoot?: HTMLElement) => {
      const root = runtime.prepareCenterModalRoot({
        existingRoot,
        activeModule: module,
        encId,
        focusReturnTarget: null,
      });
      if (root) root.querySelector('.hhr-center-main')!.textContent = module;
    }
  );
  const runtime = owner().create({
    modalId: 'hhr-prescription-print-modal',
    closeModal: vi.fn(() => true),
    ensureStyles: vi.fn(),
    getClinicalGuard: vi.fn(() => ({})),
    runClinicalTransition: (_root: HTMLElement, action: () => void) => {
      action();
      return true;
    },
    trapModalFocus: vi.fn(),
    currentRouteEncounterId: vi.fn(() => '141121'),
    normalizedText: (value: unknown) =>
      String(value || '')
        .trim()
        .toLowerCase(),
    sendMessage: vi.fn(async () => ({})),
    runtimeMessages: {
      PATIENT_HEADER_REQUEST: 'PATIENT_HEADER_REQUEST',
      CENSUS_LIST_REQUEST: 'CENSUS_LIST_REQUEST',
    },
    openPrescriptionCenter: vi.fn(),
    openHospitalizedDocuments: vi.fn(),
    openOperationsCenter,
    openRegimenQuickDialog: vi.fn(),
    ...overrides,
  });
  return { runtime, openOperationsCenter };
};

describe('Centro HHR shared shell runtime', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the same modal root and focuses the active nav item across module changes', () => {
    const { runtime } = createRuntime();
    const root = runtime.prepareCenterModalRoot({
      activeModule: 'home',
      encId: '141121',
      focusReturnTarget: null,
    })!;

    root.querySelector<HTMLButtonElement>('[data-module="handoff"]')!.click();

    expect(document.getElementById('hhr-prescription-print-modal')).toBe(root);
    expect(root.dataset.encounterId).toBe('141121');
    expect(root.dataset.activeModule).toBe('handoff');
    expect(root.querySelector('.hhr-center-main')?.textContent).toBe('handoff');
    expect(document.activeElement).toBe(
      root.querySelector('[data-module="handoff"][aria-current="page"]')
    );
  });

  it('restores focus after dismissing the unique root', () => {
    vi.useFakeTimers();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { runtime } = createRuntime();
    const root = runtime.prepareCenterModalRoot({
      activeModule: 'home',
      encId: '141121',
      focusReturnTarget: trigger,
    })!;

    root.querySelector<HTMLButtonElement>('.hhr-rx-close')!.click();
    vi.runAllTimers();

    expect(root.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('rejects a stale patient header after the selected encounter changes', async () => {
    const firstHeader = deferred<Record<string, unknown>>();
    const secondHeader = deferred<Record<string, unknown>>();
    const sendMessage = vi.fn((message: { type: string; encId?: string }) => {
      if (message.type === 'CENSUS_LIST_REQUEST') {
        return Promise.resolve({
          patients: [{ encounterId: '141122', name: 'Paciente B', run: '2-7', bed: 'H2' }],
        });
      }
      return message.encId === '141122' ? secondHeader.promise : firstHeader.promise;
    });
    const { runtime } = createRuntime({ sendMessage });
    const root = runtime.prepareCenterModalRoot({
      activeModule: 'lab',
      encId: '141121',
      focusReturnTarget: null,
    })!;
    const renderModule = vi.fn();
    runtime.setupCenterPatientContext(root, 'lab', '141121', renderModule);

    root.querySelector<HTMLButtonElement>('.hhr-patientbar-change')!.click();
    const option = await vi.waitFor(() => {
      const element = root.querySelector<HTMLButtonElement>('.hhr-patientbar-option');
      expect(element).not.toBeNull();
      return element!;
    });
    option.click();
    secondHeader.resolve({ patient: { name: 'Paciente B', run: '2-7', bed: 'H2' } });
    await vi.waitFor(() => {
      expect(root.querySelector('.hhr-patientbar-name')?.textContent).toBe('Paciente B');
    });
    firstHeader.resolve({ patient: { name: 'Paciente A obsoleto' } });
    await Promise.resolve();

    expect(root.dataset.selectedEncounterId).toBe('141122');
    expect(root.querySelector('.hhr-patientbar-name')?.textContent).toBe('Paciente B');
    expect(renderModule).toHaveBeenCalledWith('141122');
  });

  it('loads before the orchestrator and stays within its explicit line budget', () => {
    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
      content_scripts?: Array<{ js?: string[] }>;
    };
    const scripts =
      (manifest.content_scripts || []).find(entry =>
        entry.js?.includes('content-prescription-print.js')
      )?.js || [];
    const source = readFileSync(path.resolve('extension/hhr-center-shell-runtime.js'), 'utf8');

    expect(scripts.indexOf('hhr-center-shell-runtime.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(source.split('\n').length).toBeLessThanOrEqual(400);
    expect(Object.isFrozen(owner())).toBe(true);
    expect(Object.isFrozen(createRuntime().runtime)).toBe(true);
  });
});
