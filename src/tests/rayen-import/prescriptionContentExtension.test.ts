// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-ui.js';
import '../../../extension/prescription-print.js';

const contentSource = readFileSync(path.resolve('extension/content-prescription-print.js'), 'utf8');
const NativeMutationObserver = globalThis.MutationObserver;
const contentObservers = new Set<MutationObserver>();

describe('extension prescription print content flow', () => {
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

  it('keeps the print action available for consecutive prescriptions', async () => {
    vi.stubGlobal(
      'MutationObserver',
      class extends NativeMutationObserver {
        constructor(callback: MutationCallback) {
          super(callback);
          contentObservers.add(this);
        }
      }
    );
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    document.body.innerHTML = `
      <main>
        <section>
          <h2>Fármacos</h2>
          <label><input type="checkbox"> Mostrar Suspendidos</label>
        </section>
      </main>
    `;

    const helper = (
      globalThis as typeof globalThis & {
        HhrPrescriptionPrint: Record<string, unknown>;
      }
    ).HhrPrescriptionPrint;
    (
      globalThis as typeof globalThis & { HhrPrescriptionPrint: Record<string, unknown> }
    ).HhrPrescriptionPrint = {
      ...helper,
      resolveEncounterId: () => '141121',
      isNursingRouteUrl: () => true,
    };

    const messages: Array<{ type?: string }> = [];
    let runtimeLastError: { message: string } | undefined;
    let optionAttempts = 0;
    const sendMessage = vi.fn(
      (message: { type?: string }, callback: (response: unknown) => void) => {
        messages.push(message);
        if (message.type === 'RAYEN_PRESCRIPTION_OPTIONS_REQUEST') {
          optionAttempts += 1;
          if (optionAttempts === 1) {
            runtimeLastError = {
              message:
                'A listener indicated an asynchronous response, but the message channel closed before a response was received',
            };
            callback(undefined);
            runtimeLastError = undefined;
            return;
          }
          callback({
            patient: {
              name: 'Inés Leiva Riroroko',
              run: '8.932.066-6',
              bed: 'H6C1',
              room: 'H6',
              service: 'Área Médico Quirúrgica',
            },
            groups: [
              {
                key: 'professional:elena-diaz',
                professional: 'Elena Díaz',
                professionalRun: '17.752.753-K',
                prescriberVerified: true,
                count: 2,
                externalCount: 1,
                validationDate: '15-07-2026',
                validationDateTime: '15-07-2026 08:10',
              },
              {
                key: 'professional-run:189809670',
                professional: 'Antonio Hernández',
                professionalRun: '18.980.967-0',
                prescriberVerified: true,
                count: 4,
                externalCount: 0,
                validationDate: '',
                validationDateTime: '',
                printDate: '2026-07-14',
                printDateTime: '2026-07-14T09:40:00-06:00',
                printDateSource: 'indication',
              },
            ],
            externalGroups: [
              {
                key: 'external:901',
                external: true,
                medication: 'Mometasona Furoato 50 mcg/dosis Suspensión Nasal',
                professional: 'Elena Díaz',
                professionalRun: '17.752.753-K',
                prescriberVerified: true,
                count: 1,
                validationDate: '',
                validationDateTime: '',
                printDate: '2026-07-14',
                printDateTime: '2026-07-14T09:41:00-06:00',
                printDateSource: 'indication',
              },
            ],
            validation: { date: '15-07-2026', dateTime: '15-07-2026 08:10' },
          });
          return;
        }
        if (message.type === 'RAYEN_PRESCRIPTION_PRINT_REQUEST') {
          callback({ ok: true, printTabId: 77 });
          return;
        }
        callback({ ok: true });
      }
    );
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: {
        getManifest: () => ({ version: '0.21.0' }),
        getURL: (path: string) => `chrome-extension://test/${path}`,
        get lastError() {
          return runtimeLastError;
        },
        sendMessage,
      },
    };

    vm.runInThisContext(contentSource, { filename: 'content-prescription-print.js' });

    const pageButton = await vi.waitFor(() => {
      const button = document.getElementById('hhr-prescription-print-button');
      expect(button).not.toBeNull();
      return button as HTMLButtonElement;
    });
    pageButton.click();

    const firstPrint = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('.hhr-rx-submit');
      expect(button).not.toBeNull();
      expect(button?.disabled).toBe(false);
      return button as HTMLButtonElement;
    });
    const currentTab = document.getElementById('hhr-rx-tab-current') as HTMLButtonElement;
    const hospitalizedTab = document.getElementById('hhr-rx-tab-hospitalized') as HTMLButtonElement;
    const tabPanel = document.getElementById('hhr-rx-tabpanel');
    expect(currentTab.getAttribute('aria-controls')).toBe('hhr-rx-tabpanel');
    expect(currentTab.getAttribute('aria-selected')).toBe('true');
    expect(currentTab.tabIndex).toBe(0);
    expect(hospitalizedTab.tabIndex).toBe(-1);
    expect(tabPanel?.getAttribute('role')).toBe('tabpanel');
    expect(tabPanel?.getAttribute('aria-labelledby')).toBe('hhr-rx-tab-current');
    expect(document.querySelector('.hhr-rx-patient-context')?.textContent).toContain(
      'Inés Leiva Riroroko'
    );
    expect(document.querySelector('.hhr-rx-patient-context')?.textContent).toContain(
      'RUN 8.932.066-6'
    );
    expect(
      messages.filter(message => message.type === 'RAYEN_PRESCRIPTION_OPTIONS_REQUEST')
    ).toHaveLength(2);
    const externalOption = document.querySelector<HTMLInputElement>('input[value="external:901"]');
    expect(externalOption).not.toBeNull();
    expect(externalOption?.disabled).toBe(false);
    expect(externalOption?.closest('label')?.textContent).toContain('Externa · Mometasona');
    expect(externalOption?.closest('label')?.textContent).toContain('última indicación');
    const antonioOption = document.querySelector<HTMLInputElement>(
      'input[value="professional-run:189809670"]'
    );
    expect(antonioOption?.disabled).toBe(false);
    expect(antonioOption?.closest('label')?.textContent).toContain('última indicación');
    const completeOption = document.querySelector<HTMLInputElement>('input[value="complete"]');
    expect(completeOption?.closest('label')?.textContent).toContain('incluye 1 receta externa');
    firstPrint.click();

    await vi.waitFor(() => {
      expect(document.querySelector('.hhr-rx-print-feedback')?.textContent).toContain(
        'Puedes imprimir otra'
      );
      expect(firstPrint.isConnected).toBe(true);
      expect(firstPrint.disabled).toBe(false);
      expect(document.getElementById('hhr-prescription-print-button')).toBe(pageButton);
    });

    firstPrint.click();
    await vi.waitFor(() => {
      expect(
        messages.filter(message => message.type === 'RAYEN_PRESCRIPTION_PRINT_REQUEST')
      ).toHaveLength(2);
      expect(firstPrint.isConnected).toBe(true);
      expect(firstPrint.disabled).toBe(false);
    });
  });

  it('keeps clinical print retries usable and acknowledges writes before detached-panel exits', async () => {
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(contentSource).toContain("submit.textContent = 'Imprimir regímenes y BRADEN'");
    expect(contentSource).toContain("submit.textContent = 'Reintentar impresión'");

    const scoreAck = contentSource.indexOf(
      'const acknowledged = await acknowledgeClinicalWrite(result.clinicalWriteReceipt)',
      contentSource.indexOf('const renderScoresCenter')
    );
    const scoreDisconnect = contentSource.indexOf('if (!panel.isConnected) return;', scoreAck);
    expect(scoreAck).toBeGreaterThan(-1);
    expect(scoreDisconnect).toBeGreaterThan(scoreAck);

    const handoffRequest = contentSource.indexOf("type: 'RAYEN_HANDOFF_SAVE_REQUEST'");
    const handoffAck = contentSource.indexOf(
      'const acknowledged = await acknowledgeClinicalWrite(result.clinicalWriteReceipt)',
      handoffRequest
    );
    const handoffDisconnect = contentSource.indexOf(
      'if (!root.isConnected) return;',
      handoffRequest
    );
    expect(handoffAck).toBeGreaterThan(handoffRequest);
    expect(handoffDisconnect).toBeGreaterThan(handoffAck);
  });

  it('keeps credentials on the official Rayen page and exposes session controls in Centro HHR', () => {
    expect(contentSource).toContain("type: 'RAYEN_GC_CONNECT_REQUEST'");
    expect(contentSource).toContain("type: 'RAYEN_GC_DISCONNECT_REQUEST'");
    expect(contentSource).toContain(
      'La contraseña se ingresa únicamente en la página oficial de Rayen'
    );
    expect(contentSource).toContain("createOperationsCenterModal('connection'");
    expect(contentSource).toContain('hhr-ops-connection-dot');
    expect(contentSource).not.toMatch(/type=["']password["']/i);
  });

  it('adds the corrected discharge option beside Eloísa’s native alta print action', async () => {
    vi.stubGlobal(
      'MutationObserver',
      class extends NativeMutationObserver {
        constructor(callback: MutationCallback) {
          super(callback);
          contentObservers.add(this);
        }
      }
    );
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    document.body.innerHTML = `
      <table><tbody><tr><td><span>Paciente prueba · Alta médica</span><p aria-label="15.066.726-7">RUN : 15.066.726-7</p></td><td>80 a</td><td><button id="open-actions" aria-expanded="true">⋮</button></td></tr></tbody></table>
      <table><tbody><tr><td>Paciente sin identificador</td><td><button id="open-actions-without-run" aria-expanded="false">⋮</button></td></tr></tbody></table>
      <div role="menu"><button id="native-print-1" type="button"><span class="MuiListItemIcon-root"><svg data-testid="LocalPrintshopRoundedIcon"></svg></span><span class="MuiListItemText-primary">Imprimir Alta Médica</span></button></div>
      <div role="menu" hidden><button id="native-print-2" type="button">Imprimir Alta Médica</button></div>
      <div role="menu" hidden><button id="native-print-3" type="button">Imprimir Alta Médica</button></div>
    `;
    const messages: Array<{ type?: string; patientRun?: string }> = [];
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: {
        getManifest: () => ({ version: '0.30.0' }),
        getURL: (value: string) => `chrome-extension://test/${value}`,
        get lastError() {
          return undefined;
        },
        sendMessage: (message: { type?: string }, callback: (response: unknown) => void) => {
          messages.push(message);
          callback({ ok: true });
        },
      },
    };
    const nativePrint = document.querySelector('[role="menu"] button') as HTMLButtonElement;
    nativePrint.addEventListener('click', () => undefined);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    let captureArmCount = 0;
    window.addEventListener('message', event => {
      if (event.data?.type !== 'RAYEN_EPICRISIS_PDF_CAPTURE_ARM') return;
      captureArmCount += 1;
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: {
            type: 'RAYEN_EPICRISIS_PDF_CAPTURE_RESULT',
            reqId: event.data.reqId,
            pdfBase64: 'JVBERi0xLjQ=',
          },
        })
      );
    });

    vm.runInThisContext(contentSource, { filename: 'content-prescription-print.js' });
    (document.getElementById('open-actions') as HTMLButtonElement).focus();
    const corrected = await vi.waitFor(() => {
      const element = document.getElementById('hhr-corrected-discharge-print');
      expect(element?.textContent).toContain('Imprimir alta corregida');
      expect(element?.querySelector('[data-testid="LocalPrintshopRoundedIcon"]')).not.toBeNull();
      const correctedItems = Array.from(
        document.querySelectorAll<HTMLElement>('[data-hhr-corrected-discharge-print="true"]')
      );
      expect(correctedItems).toHaveLength(3);
      expect(correctedItems.map(item => item.id)).toEqual([
        'hhr-corrected-discharge-print',
        '',
        '',
      ]);
      return element as HTMLButtonElement;
    });
    corrected.click();
    corrected.click();
    await vi.waitFor(() => {
      const correctedMessages = messages.filter(
        message => message.type === 'RAYEN_EPICRISIS_CORRECTED_PRINT_REQUEST'
      );
      expect(correctedMessages).toHaveLength(1);
      expect(correctedMessages[0]?.patientRun).toBe('15.066.726-7');
      expect(captureArmCount).toBe(1);
    });
    (document.getElementById('open-actions') as HTMLButtonElement).setAttribute(
      'aria-expanded',
      'false'
    );
    (document.getElementById('open-actions-without-run') as HTMLButtonElement).setAttribute(
      'aria-expanded',
      'true'
    );
    (document.getElementById('open-actions-without-run') as HTMLButtonElement).focus();
    corrected.click();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('No se pudo identificar al paciente')
    );
    expect(captureArmCount).toBe(1);
  });
});
