// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(
  path.resolve('extension/content-fichamedico-document-manager.js'),
  'utf8'
);

describe('Ficha Médico document-manager navigation marker', () => {
  it('opens the real Eloisa control once and removes the marker', () => {
    class FakeElement {
      click = vi.fn();
      hasAttribute = vi.fn(() => false);
      getAttribute = vi.fn(() => null);
      getClientRects = vi.fn(() => [{ width: 100, height: 100 }]);
    }
    const button = new FakeElement();
    const modal = new FakeElement();
    const replaceState = vi.fn();
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const context = vm.createContext({
      URL,
      window: {
        location: {
          href: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141121?hhrOpenDocumentManager=request-1',
        },
      },
      document: {
        getElementById: vi.fn((id: string) => id === 'gestor-documental-button' ? button : modal),
      },
      HTMLElement: FakeElement,
      history: { state: null, replaceState },
      Date,
      setTimeout: vi.fn(),
      chrome: { runtime: { sendMessage } },
    });

    vm.runInContext(source, context, { filename: 'content-fichamedico-document-manager.js' });

    expect(button.click).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_PATIENT_DOCUMENT_MANAGER_ACK',
      requestId: 'request-1',
      opened: true,
    });
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141121'
    );
  });

  it('does nothing without the explicit one-shot marker', () => {
    const getElementById = vi.fn();
    const context = vm.createContext({
      URL,
      window: {
        location: { href: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141121' },
      },
      document: { getElementById },
      HTMLElement: class {},
      history: { state: null, replaceState: vi.fn() },
      Date,
      setTimeout: vi.fn(),
      chrome: { runtime: { sendMessage: vi.fn() } },
    });

    vm.runInContext(source, context, { filename: 'content-fichamedico-document-manager.js' });
    expect(getElementById).not.toHaveBeenCalled();
  });

  it('does not acknowledge a disabled Eloisa control as opened', () => {
    class FakeElement {
      click = vi.fn();
      hasAttribute = vi.fn(() => true);
      getAttribute = vi.fn(() => null);
      getClientRects = vi.fn(() => []);
    }
    const button = new FakeElement();
    const sendMessage = vi.fn();
    const setTimeoutMock = vi.fn();
    const context = vm.createContext({
      URL,
      window: {
        location: {
          href: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141121?hhrOpenDocumentManager=request-2',
        },
      },
      document: { getElementById: vi.fn(() => button) },
      HTMLElement: FakeElement,
      history: { state: null, replaceState: vi.fn() },
      Date,
      setTimeout: setTimeoutMock,
      chrome: { runtime: { sendMessage } },
    });

    vm.runInContext(source, context, { filename: 'content-fichamedico-document-manager.js' });
    expect(button.click).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(setTimeoutMock).toHaveBeenCalledOnce();
  });
});
