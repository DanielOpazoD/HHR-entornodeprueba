// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-lab-center.js';

type Runtime = {
  renderLabCenter: (root: HTMLElement, encId: string) => void;
  renderLabRequestView: (root: HTMLElement, encId: string) => void;
};

type RuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => Runtime;
};

const runtimeOwner = () =>
  (globalThis as unknown as { HhrLabCenterRuntime: RuntimeOwner }).HhrLabCenterRuntime;

const runtimeMessages = {
  SYSLAB_STATUS_REQUEST: 'RAYEN_SYSLAB_STATUS_REQUEST',
  LAB_SEARCH_REQUEST: 'RAYEN_LAB_SEARCH_REQUEST',
  LAB_DETAILS_REQUEST: 'RAYEN_LAB_DETAILS_REQUEST',
  LAB_PDF_OPEN_REQUEST: 'RAYEN_LAB_PDF_OPEN_REQUEST',
};

const requestForms = {
  EXAM_CATEGORIES: [{ id: 'hematologia', name: 'Hematología', tube: 'Lila', exams: ['Hemograma'] }],
  PROCEDENCIA_OPTIONS: ['Hospitalización', 'Urgencia'],
  FONASA_LEVELS: ['A', 'B'],
  LAB_FORM_COLUMNS: [['hematologia']],
  buildLabRequestPrintHtml: vi.fn(() => '<!doctype html><title>Solicitud</title>'),
};

const makeRoot = () => {
  const root = document.createElement('div');
  root.dataset.activeModule = 'lab';
  root.innerHTML = '<main class="hhr-center-main"></main>';
  document.body.appendChild(root);
  return root;
};

const makeDependencies = (
  sendMessage: (message: Record<string, unknown>) => Promise<unknown>,
  runClinicalTransition = (_root: HTMLElement, action: () => void) => {
    action();
    return true;
  }
) => ({
  labHelper: { comparisonClipboard: vi.fn(() => 'tabla') },
  requestForms,
  runtimeMessages,
  runClinicalTransition,
  normalizedText: (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase(),
  sendMessage,
  setLiveRegion: (element: HTMLElement, text: string, state = '') => {
    element.textContent = text;
    element.dataset.state = state;
  },
  fetchPatientHeaderView: vi.fn(async () => ({
    patient: {
      name: 'Ana Riroroko',
      formattedRun: '12.345.678-5',
      diagnosis: 'Neumonía',
    },
    view: { nacimiento: '01-02-1980' },
  })),
});

const analysis = {
  summary: { reportCount: 2, findingCount: 2, alertCount: 1 },
  columns: [
    { key: 'exam-1', label: '17-07-2026' },
    { key: 'exam-2', label: '18-07-2026' },
  ],
  comparison: [
    {
      analysis: 'Hemoglobina',
      section: 'HEMOGRAMA',
      values: {
        'exam-1': { result: '12.1', unit: 'g/dL', refValue: '12 - 16', alert: false },
        'exam-2': { result: '11.4', unit: 'g/dL', refValue: '12 - 16', alert: true },
      },
    },
  ],
  trends: [],
  reports: [],
};

describe('Centro HHR Laboratorio runtime', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    requestForms.buildLabRequestPrintHtml.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves the Syslab search, selection and analysis message contracts', async () => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (value: string) => `chrome-extension://test/${value}` },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    const messages: Array<Record<string, unknown>> = [];
    const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
      messages.push(message);
      if (message.type === runtimeMessages.SYSLAB_STATUS_REQUEST) {
        return { connected: true };
      }
      if (message.type === runtimeMessages.LAB_SEARCH_REQUEST) {
        return {
          batchId: 'batch-lab-1',
          patient: { name: 'Ana Riroroko', run: '12.345.678-5', bed: 'H1', service: 'MQ' },
          exams: [
            {
              id: 'exam-2',
              date: '18-07-2026',
              time: '09:10',
              origin: 'HHR',
              exams: ['Hemograma'],
            },
            {
              id: 'exam-1',
              date: '17-07-2026',
              time: '08:30',
              origin: 'HHR',
              exams: ['Hemograma'],
            },
          ],
        };
      }
      if (message.type === runtimeMessages.LAB_DETAILS_REQUEST) {
        return { analysis };
      }
      return { ok: true };
    });
    const root = makeRoot();

    runtimeOwner().create(makeDependencies(sendMessage)).renderLabCenter(root, '141121');
    const analyze = await vi.waitFor(() => {
      const element = root.querySelector<HTMLButtonElement>('.hhr-lab-analyze');
      expect(element?.disabled).toBe(false);
      expect(element?.textContent).toBe('Analizar 2');
      return element as HTMLButtonElement;
    });
    analyze.click();

    await vi.waitFor(() => {
      expect(messages).toContainEqual({
        type: runtimeMessages.LAB_DETAILS_REQUEST,
        batchId: 'batch-lab-1',
        examIds: ['exam-1', 'exam-2'],
      });
      expect(root.querySelector('.hhr-lab-stat')?.textContent).toBe('2 informes');
      expect(root.querySelector('.hhr-lab-comparison')?.textContent).toContain('Hemoglobina');
    });
  });

  it('keeps one root while navigating request to results and preserves printable patient data', async () => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (value: string) => `chrome-extension://test/${value}` },
    });
    const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
      if (message.type === runtimeMessages.SYSLAB_STATUS_REQUEST) return { connected: false };
      return { ok: true };
    });
    const transition = vi.fn((_root: HTMLElement, action: () => void) => {
      action();
      return true;
    });
    const fakePrintWindow = {
      closed: false,
      focus: vi.fn(),
      print: vi.fn(),
      addEventListener: vi.fn((_event: string, handler: () => void) => handler()),
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
    };
    vi.spyOn(window, 'open').mockReturnValue(fakePrintWindow as unknown as Window);
    const runtime = runtimeOwner().create(makeDependencies(sendMessage, transition));
    const root = makeRoot();

    runtime.renderLabRequestView(root, '141121');
    const exam = await vi.waitFor(() => {
      const element = root.querySelector<HTMLInputElement>('.hhr-labreq-exam input');
      expect(element).not.toBeNull();
      return element as HTMLInputElement;
    });
    exam.checked = true;
    exam.dispatchEvent(new Event('change', { bubbles: true }));
    const print = await vi.waitFor(() => {
      const element = root.querySelector<HTMLButtonElement>('.hhr-labreq-print');
      expect(element?.disabled).toBe(false);
      return element as HTMLButtonElement;
    });
    print.click();

    expect(requestForms.buildLabRequestPrintHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: {
          name: 'Ana Riroroko',
          run: '12.345.678-5',
          birthDate: '01-02-1980',
        },
        diagnosis: 'Neumonía',
        procedencia: 'Hospitalización',
        selected: ['hematologia|Hemograma'],
        logoUrl: 'chrome-extension://test/hhr-logo.svg',
      })
    );
    expect(fakePrintWindow.print).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('[data-flow="results"]')?.click();
    await vi.waitFor(() => {
      expect(transition).toHaveBeenCalledTimes(1);
      expect(root.querySelector('.hhr-lab-selection')?.textContent).toBe(
        'Inicio de sesión requerido'
      );
      expect(root.isConnected).toBe(true);
    });
  });
});
