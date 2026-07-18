// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import '../../../extension/hhr-imaging-center.js';

type Runtime = {
  renderImagingCenter: (root: HTMLElement, encId: string) => void;
};

type RuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => Runtime;
};

const runtimeOwner = () =>
  (globalThis as unknown as { HhrImagingCenterRuntime: RuntimeOwner }).HhrImagingCenterRuntime;

const runtimeMessages = {
  IMAGING_FORM_PRINT_REQUEST: 'RAYEN_IMAGING_FORM_PRINT_REQUEST',
};

const requestForms = {
  IMAGING_DOCUMENTS: {
    solicitud: {
      id: 'solicitud',
      title: 'Solicitud',
      image: 'forms/solicitud_imagenologia.png',
      aspectRatio: '1 / 1.4',
      overlays: (patient: { name: string }, physician: string) => [
        { text: patient.name, left: '10%', top: '12%', bold: true },
        { text: physician, left: '10%', top: '18%' },
      ],
    },
    encuesta: {
      id: 'encuesta',
      title: 'Encuesta',
      image: 'forms/encuesta_imagenologia.png',
      aspectRatio: '1 / 1.4',
      overlays: () => [],
    },
    consentimiento: {
      id: 'consentimiento',
      title: 'Consentimiento',
      image: 'forms/consentimiento.png',
      aspectRatio: '1 / 1.4',
      overlays: () => [],
    },
  },
};

const makeRoot = () => {
  const root = document.createElement('div');
  root.dataset.activeModule = 'imaging';
  root.innerHTML = '<main class="hhr-center-main"></main>';
  document.body.appendChild(root);
  return root;
};

const makeDependencies = (
  sendMessage: (message: Record<string, unknown>) => Promise<unknown>,
  fetchPatientHeaderView: () => Promise<unknown> = vi.fn(async () => ({
    patient: { name: 'Ana Riroroko' },
    view: { name: 'Ana Riroroko' },
  }))
) => ({
  requestForms,
  runtimeMessages,
  sendMessage,
  setLiveRegion: (element: HTMLElement, text: string, state = '') => {
    element.textContent = text;
    element.dataset.state = state;
  },
  fetchPatientHeaderView,
});

describe('Centro HHR imaging runtime', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fails closed and is loaded before its content-script consumer', () => {
    expect(() => runtimeOwner().create({})).toThrow(/Centro de Imágenes HHR/);
    expect(Object.isFrozen(runtimeOwner())).toBe(true);

    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
      content_scripts?: Array<{ js?: string[] }>;
    };
    const scripts =
      manifest.content_scripts?.find(entry => entry.js?.includes('content-prescription-print.js'))
        ?.js || [];
    const contentSource = readFileSync(
      path.resolve('extension/content-prescription-print.js'),
      'utf8'
    );
    const ownerSource = readFileSync(path.resolve('extension/hhr-imaging-center.js'), 'utf8');

    expect(scripts.indexOf('hhr-imaging-center.js')).toBeGreaterThan(-1);
    expect(scripts.indexOf('hhr-imaging-center.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(contentSource).toContain('const imagingCenterRuntime = imagingCenterOwner');
    expect(contentSource).toContain('if (!imagingCenterRuntime) {');
    expect(contentSource).toContain('imagingCenterRuntime.renderImagingCenter(root, targetEncId)');
    expect(contentSource).not.toContain('const renderImagingCenter =');
    expect(contentSource.split('\n').length).toBeLessThanOrEqual(2_250);
    expect(ownerSource.split('\n').length).toBeLessThanOrEqual(350);
  });

  it('preserves patient overlays, pointer and keyboard marks, text focus and print payloads', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('chrome', {
      runtime: { getURL: (value: string) => `chrome-extension://test/${value}` },
    });
    const messages: Array<Record<string, unknown>> = [];
    const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
      messages.push(message);
      return { ok: true };
    });
    const root = makeRoot();

    runtimeOwner().create(makeDependencies(sendMessage)).renderImagingCenter(root, '141121');
    await Promise.resolve();
    await Promise.resolve();

    const canvas = root.querySelector<HTMLElement>('.hhr-imaging-canvas') as HTMLElement;
    const physician = root.querySelector<HTMLInputElement>(
      '.hhr-imaging-physician'
    ) as HTMLInputElement;
    const print = root.querySelector<HTMLButtonElement>('.hhr-imaging-print') as HTMLButtonElement;
    expect(print.disabled).toBe(false);
    expect(root.querySelector('.hhr-imaging-overlay')?.textContent).toBe('Ana Riroroko');
    expect(root.querySelector<HTMLImageElement>('.hhr-imaging-image')?.src).toContain(
      'forms/solicitud_imagenologia.png'
    );

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    canvas.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: 50,
        clientY: 25,
      })
    );
    expect(root.querySelector<HTMLElement>('.hhr-imaging-mark')?.style.left).toBe('25%');
    expect(root.querySelector<HTMLElement>('.hhr-imaging-mark')?.style.top).toBe('25%');

    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(root.querySelectorAll('.hhr-imaging-mark')).toHaveLength(2);

    root.querySelector<HTMLButtonElement>('[data-tool="text"]')?.click();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const editor = root.querySelector<HTMLInputElement>(
      '.hhr-imaging-text-editor'
    ) as HTMLInputElement;
    const canvasFocus = vi.spyOn(canvas, 'focus');
    editor.value = 'perfil derecho';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    vi.runAllTimers();
    expect(canvasFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(Array.from(root.querySelectorAll('.hhr-imaging-mark')).at(-1)?.textContent).toBe(
      'PERFIL DERECHO'
    );

    physician.value = 'Dr. Riroroko';
    physician.dispatchEvent(new Event('input', { bubbles: true }));
    print.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(messages).toEqual([
      {
        type: runtimeMessages.IMAGING_FORM_PRINT_REQUEST,
        encId: '141121',
        doc: 'solicitud',
        physician: 'Dr. Riroroko',
        marks: [
          { x: 25, y: 25 },
          { x: 51, y: 50 },
          { x: 51, y: 50, text: 'perfil derecho' },
        ],
      },
    ]);
    expect(print.textContent).toBe('Imprimir');
    expect(root.querySelector('.hhr-imaging-feedback')?.textContent).toContain('Se abrió el PDF');
  });

  it('ignores a late patient response after the imaging root is replaced', async () => {
    let resolvePatient: ((value: unknown) => void) | undefined;
    const fetchPatientHeaderView = vi.fn(
      () =>
        new Promise(resolve => {
          resolvePatient = resolve;
        })
    );
    const root = makeRoot();
    runtimeOwner()
      .create(
        makeDependencies(
          vi.fn(async () => ({ ok: true })),
          fetchPatientHeaderView
        )
      )
      .renderImagingCenter(root, '141121');

    root.dataset.activeModule = 'lab';
    resolvePatient?.({ patient: { name: 'Ana' }, view: { name: 'Ana' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector<HTMLButtonElement>('.hhr-imaging-print')?.disabled).toBe(true);
    expect(root.querySelector('.hhr-imaging-overlay')).toBeNull();
  });
});
