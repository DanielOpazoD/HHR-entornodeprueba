// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/prescription-print.js';

const contentSource = readFileSync(path.resolve('extension/content-prescription-print.js'), 'utf8');

describe('extension prescription print content flow', () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __hhrPrescriptionPrintInjected?: boolean })
      .__hhrPrescriptionPrintInjected;
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-hhr-prescription-print-script');
    document.documentElement.removeAttribute('data-hhr-prescription-print-state');
    vi.restoreAllMocks();
  });

  it('keeps the print action available for consecutive prescriptions', async () => {
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
});
