// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../extension/fichamedico-manual-patient-copy.js';

type CopyFactory = {
  create: (dependencies: Record<string, unknown>) => {
    scan: () => Promise<void>;
  };
};

const factory = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoManualPatientCopy: CopyFactory;
  }
).HhrFichaMedicoManualPatientCopy;

describe('Ficha Médico manual patient copy action', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/dashboard/encounter-list-nurse');
    document.body.innerHTML =
      '<table><tbody><tr><td>Ana Pérez · 12.345.678-5</td><td></td></tr></tbody></table>';
  });

  it('adds one action per row, copies the selected patient code and never duplicates it', async () => {
    const sendMessage = vi.fn(async message =>
      (message as { type: string }).type === 'RAYEN_CENSUS_LIST_REQUEST'
        ? { patients: [{ encounterId: '91', name: 'Ana Pérez', run: '12.345.678-5' }] }
        : { ok: true, code: 'HHR-PACIENTE-1.payload.checksum' }
    );
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    const runtime = factory.create({
      document,
      MutationObserver,
      sendMessage,
      writeClipboard,
      setTimeout,
      clearTimeout,
    });

    await runtime.scan();
    await runtime.scan();
    const buttons = document.querySelectorAll('[data-hhr-patient-code-action="1"]');
    expect(buttons).toHaveLength(1);
    (buttons[0] as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(writeClipboard).toHaveBeenCalledWith('HHR-PACIENTE-1.payload.checksum')
    );
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_MANUAL_PATIENT_CODE_REQUEST',
      encId: '91',
    });
  });

  it('re-applies the action after a dynamic list replacement', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      patients: [
        { encounterId: '91', name: 'Ana Pérez', run: '12.345.678-5' },
        { encounterId: '92', name: 'Tomás Riroroko', run: '11.111.111-1' },
      ],
    });
    const runtime = factory.create({
      document,
      MutationObserver,
      sendMessage,
      writeClipboard: vi.fn(),
      setTimeout,
      clearTimeout,
    });
    await runtime.scan();
    document.querySelector('tbody')!.innerHTML =
      '<tr><td>Tomás Riroroko · 11.111.111-1</td><td></td></tr>';
    await runtime.scan();
    expect(document.querySelectorAll('[data-hhr-patient-code-action="1"]')).toHaveLength(1);
    expect(document.querySelector('tr')?.textContent).toContain('Copiar para HHR');
  });
});
