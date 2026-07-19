// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-discharge-actions-runtime.js';

type DischargeActionsRuntime = {
  ensureCorrectedDischargePrintItems: () => void;
  ensureNursingMedicalEpicrisisPrintItem: (nursingContext: boolean) => void;
  dispose: () => void;
};

type DischargeActionsOwner = {
  create: (dependencies: Record<string, unknown>) => DischargeActionsRuntime;
};

const owner = () =>
  (globalThis as typeof globalThis & { HhrDischargeActionsRuntime: DischargeActionsOwner })
    .HhrDischargeActionsRuntime;

const normalizedText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const resolveEncounterId = (value: unknown) =>
  String(value || '').match(/\/dashboard\/encounter-list(?:-nurse)?\/(\d+)/)?.[1] || '';

const activeRuntimes: DischargeActionsRuntime[] = [];

const makeRuntime = (sendMessage = vi.fn(async () => ({ ok: true })), showPageNotice = vi.fn()) => {
  const runtime = owner().create({
    documentRef: document,
    windowRef: window,
    cryptoApi: { randomUUID: () => 'capture-1' },
    normalizedText,
    resolveEncounterId,
    showPageNotice,
    sendMessage,
    runtimeMessages: {
      EPICRISIS_CORRECTED_PRINT_REQUEST: 'RAYEN_EPICRISIS_CORRECTED_PRINT_REQUEST',
      NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST: 'RAYEN_NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST',
    },
  });
  activeRuntimes.push(runtime);
  return { runtime, sendMessage, showPageNotice };
};

const rowMarkup = ({
  run = '15.066.726-7',
  encounterId = '141987',
  actionId = 'open-actions',
  expanded = true,
} = {}) => `
  <tr role="row">
    <td>
      <a href="/dashboard/encounter-list-nurse/${encounterId}">Paciente egresado</a>
      <p>RUN: ${run}</p>
    </td>
    <td><button id="${actionId}" aria-expanded="${expanded}">Acciones</button></td>
  </tr>
`;

const captureArm = (postMessage: { mock: { calls: unknown[][] } }) =>
  postMessage.mock.calls
    .map((call: unknown[]) => call[0] as { type?: string; reqId?: string })
    .find((message: { type?: string }) => message.type === 'RAYEN_EPICRISIS_PDF_CAPTURE_ARM');

const dispatchCaptureResult = (reqId: string, pdfBase64 = 'JVBERi0xLjQ=') => {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: window.location.origin,
      data: {
        type: 'RAYEN_EPICRISIS_PDF_CAPTURE_RESULT',
        reqId,
        pdfBase64,
      },
    })
  );
};

describe('HHR discharge actions runtime', () => {
  afterEach(() => {
    activeRuntimes.splice(0).forEach(runtime => runtime.dispose());
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('owns the discharge flows, fails closed and loads before its consumer', () => {
    const runtimeSource = readFileSync(
      path.resolve('extension/hhr-discharge-actions-runtime.js'),
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
      'No se pudo inicializar el runtime de acciones de alta HHR.'
    );
    expect(scripts.indexOf('hhr-discharge-actions-runtime.js')).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf('hhr-discharge-actions-runtime.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(contentSource).toContain(
      'const dischargeActionsOwner = globalThis.HhrDischargeActionsRuntime'
    );
    expect(contentSource).toContain('dischargeActionsOwner.create({');
    [
      'const runFromPatientRow =',
      'const waitForEpicrisisCapture =',
      'const requestCorrectedDischargePrint =',
      'const requestNursingMedicalEpicrisisPrint =',
    ].forEach(definition => {
      expect(runtimeSource).toContain(definition);
      expect(contentSource).not.toContain(definition);
    });
  });

  it('captures a corrected discharge once and forwards the exact patient-bound request', async () => {
    document.body.innerHTML = `
      <table><tbody>${rowMarkup()}</tbody></table>
      <div role="menu">
        <button id="native-print" type="button">
          <span class="MuiListItemText-primary">Imprimir Alta Médica</span>
        </button>
      </div>
    `;
    const postMessage = vi.spyOn(window, 'postMessage');
    const { runtime, sendMessage } = makeRuntime();
    runtime.ensureCorrectedDischargePrintItems();
    const corrected = document.getElementById('hhr-corrected-discharge-print') as HTMLButtonElement;

    corrected.click();
    const arm = captureArm(postMessage);
    expect(arm?.reqId).toBe('capture-1');
    dispatchCaptureResult(String(arm?.reqId));

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'RAYEN_EPICRISIS_CORRECTED_PRINT_REQUEST',
        pdfBase64: 'JVBERi0xLjQ=',
        patientRun: '15.066.726-7',
      });
      expect(corrected.getAttribute('aria-busy')).toBeNull();
    });
  });

  it('cleans the waiter immediately when the native print click throws', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <table><tbody>${rowMarkup()}</tbody></table>
      <div role="menu"><button id="native-print">Imprimir Alta Médica</button></div>
    `;
    const nativePrint = document.getElementById('native-print') as HTMLButtonElement;
    vi.spyOn(nativePrint, 'click').mockImplementation(() => {
      throw new Error('click nativo falló');
    });
    const postMessage = vi.spyOn(window, 'postMessage');
    const setTimeout = vi.spyOn(window, 'setTimeout');
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const { runtime, showPageNotice } = makeRuntime();
    runtime.ensureCorrectedDischargePrintItems();

    document.getElementById('hhr-corrected-discharge-print')?.click();
    await Promise.resolve();
    const captureTimerIndex = setTimeout.mock.calls.findIndex(call => call[1] === 32_000);
    const captureTimer = setTimeout.mock.results[captureTimerIndex]?.value;

    expect(showPageNotice).toHaveBeenCalledWith('click nativo falló', {
      title: 'Alta corregida',
      error: true,
    });
    expect(captureTimerIndex).toBeGreaterThanOrEqual(0);
    expect(clearTimeout).toHaveBeenCalledWith(captureTimer);
    expect(
      postMessage.mock.calls
        .map(call => (call[0] as { type?: string }).type)
        .filter(type => type === 'RAYEN_EPICRISIS_PDF_CAPTURE_CANCEL')
    ).toHaveLength(1);
  });

  it('settles timeout and explicit disposal without retaining capture timers', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <table><tbody>${rowMarkup()}</tbody></table>
      <div role="menu"><button>Imprimir Alta Médica</button></div>
    `;
    const setTimeout = vi.spyOn(window, 'setTimeout');
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const first = makeRuntime();
    first.runtime.ensureCorrectedDischargePrintItems();
    document.getElementById('hhr-corrected-discharge-print')?.click();
    const timeoutTimerIndex = setTimeout.mock.calls.findIndex(call => call[1] === 32_000);
    const timeoutTimer = setTimeout.mock.results[timeoutTimerIndex]?.value;

    await vi.advanceTimersByTimeAsync(32_000);
    expect(first.showPageNotice).toHaveBeenCalledWith(
      'Eloísa no generó el PDF de alta dentro del tiempo esperado.',
      { title: 'Alta corregida', error: true }
    );
    expect(clearTimeout).toHaveBeenCalledWith(timeoutTimer);

    first.runtime.dispose();
    document.body.innerHTML = `
      <table><tbody>${rowMarkup({ actionId: 'second-actions' })}</tbody></table>
      <div role="menu"><button>Imprimir Alta Médica</button></div>
    `;
    const second = makeRuntime();
    second.runtime.ensureCorrectedDischargePrintItems();
    document.getElementById('hhr-corrected-discharge-print')?.click();
    const pendingTimerIndex = setTimeout.mock.calls.findLastIndex(call => call[1] === 32_000);
    const pendingTimer = setTimeout.mock.results[pendingTimerIndex]?.value;
    expect(pendingTimerIndex).toBeGreaterThan(timeoutTimerIndex);
    second.runtime.dispose();
    await Promise.resolve();
    expect(clearTimeout).toHaveBeenCalledWith(pendingTimer);
    expect(second.sendMessage).not.toHaveBeenCalled();
  });

  it('removes its document and window listeners exactly once on disposal', () => {
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const { runtime } = makeRuntime();
    const clickListener = documentAdd.mock.calls.find(
      call => call[0] === 'click' && call[2] === true
    )?.[1];
    const focusListener = documentAdd.mock.calls.find(
      call => call[0] === 'focusin' && call[2] === true
    )?.[1];
    const messageListener = windowAdd.mock.calls.find(call => call[0] === 'message')?.[1];

    runtime.dispose();
    runtime.dispose();

    expect(documentRemove).toHaveBeenCalledTimes(2);
    expect(documentRemove).toHaveBeenCalledWith('click', clickListener, true);
    expect(documentRemove).toHaveBeenCalledWith('focusin', focusListener, true);
    expect(windowRemove).toHaveBeenCalledTimes(1);
    expect(windowRemove).toHaveBeenCalledWith('message', messageListener);
  });

  it('blocks duplicate corrected-discharge clicks while the first capture is pending', async () => {
    document.body.innerHTML = `
      <table><tbody>${rowMarkup()}</tbody></table>
      <div role="menu"><button id="native-print">Imprimir Alta Médica</button></div>
    `;
    const nativePrint = document.getElementById('native-print') as HTMLButtonElement;
    const nativeClick = vi.spyOn(nativePrint, 'click');
    const postMessage = vi.spyOn(window, 'postMessage');
    const { runtime, sendMessage } = makeRuntime();
    runtime.ensureCorrectedDischargePrintItems();
    const corrected = document.getElementById('hhr-corrected-discharge-print') as HTMLButtonElement;

    corrected.click();
    corrected.click();
    expect(nativeClick).toHaveBeenCalledTimes(1);
    expect(
      postMessage.mock.calls.filter(
        call => (call[0] as { type?: string }).type === 'RAYEN_EPICRISIS_PDF_CAPTURE_ARM'
      )
    ).toHaveLength(1);

    dispatchCaptureResult(String(captureArm(postMessage)?.reqId));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  });

  it('rejects stale nursing patient context and injects each portal action idempotently', async () => {
    window.history.replaceState({}, '', '/dashboard/encounter-list-nurse?tab=3');
    document.body.innerHTML = `
      <table><tbody>${rowMarkup()}</tbody></table>
      <div role="menu" id="discharge-menu">
        <button type="button">
          <span class="MuiListItemIcon-root"></span>
          <span class="MuiListItemText-primary">Revertir alta de enfermería</span>
        </button>
        <button type="button"><span>Imprimir Alta Médica</span></button>
      </div>
    `;
    const { runtime, sendMessage, showPageNotice } = makeRuntime();
    runtime.ensureCorrectedDischargePrintItems();
    runtime.ensureCorrectedDischargePrintItems();
    runtime.ensureNursingMedicalEpicrisisPrintItem(true);
    runtime.ensureNursingMedicalEpicrisisPrintItem(true);

    expect(document.querySelectorAll('[data-hhr-corrected-discharge-print="true"]')).toHaveLength(
      1
    );
    expect(document.querySelectorAll('[data-hhr-nursing-medical-epicrisis="true"]')).toHaveLength(
      1
    );

    const action = document.getElementById('open-actions') as HTMLButtonElement;
    action.setAttribute('aria-expanded', 'false');
    document
      .querySelector('tbody')
      ?.insertAdjacentHTML(
        'beforeend',
        rowMarkup({ run: '18.222.333-4', encounterId: '999999', actionId: 'new-actions' })
      );
    document.querySelector<HTMLElement>('[data-hhr-nursing-medical-epicrisis="true"]')?.click();
    await Promise.resolve();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(showPageNotice).toHaveBeenCalledWith(
      'No se pudo identificar al paciente de esta alta. Cierra el menú y vuelve a abrirlo desde su fila.',
      { title: 'Epicrisis médica', error: true }
    );
  });
});
