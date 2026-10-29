// @vitest-environment jsdom
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupContent,
  contentObservers,
  contentSource,
  NativeMutationObserver,
  setupContent,
} from './prescriptionContentHarness';

describe('simplified Centro HHR', () => {
  beforeEach(setupContent);
  afterEach(cleanupContent);

  it('offers only prescriptions and exams across the floating bar and the center', async () => {
    vi.stubGlobal(
      'MutationObserver',
      class extends NativeMutationObserver {
        constructor(callback: MutationCallback) {
          super(callback);
          contentObservers.add(this);
        }
      }
    );
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({ version: '0.48.59' }),
        getURL: (file: string) => `chrome-extension://test/${file}`,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: (_message: unknown, callback: (value: unknown) => void) =>
          callback({ ok: true }),
      },
    });
    document.body.innerHTML = '<main><h2>Ficha sintética</h2></main>';
    vm.runInThisContext(contentSource, { filename: 'content-prescription-print.js' });
    const bar = await vi.waitFor(() => {
      const root = document.getElementById('hhr-clinical-operations-bar')?.shadowRoot;
      expect(root).toBeTruthy();
      return root!;
    });
    expect(bar.querySelectorAll('.hhr-ops-handoff,.hhr-ops-vitals,.hhr-ops-scores')).toHaveLength(
      0
    );
    bar.querySelector<HTMLButtonElement>('.brand')!.click();
    const modal = document.getElementById('hhr-prescription-print-modal')!;
    const modules = Array.from(modal.querySelectorAll<HTMLElement>('.hhr-center-nav-button')).map(
      button => button.dataset.module
    );
    expect(modules).toEqual(['home', 'recipes', 'lab', 'imaging', 'connection']);
    expect(
      Array.from(modal.querySelectorAll<HTMLElement>('.hhr-home-card')).map(
        card => card.dataset.module
      )
    ).toEqual(['recipes', 'lab', 'imaging']);
    expect(modal.textContent).not.toMatch(/Entrega de turno|Signos vitales|Scores|BRADEN/i);
    const appLink = modal.querySelector<HTMLAnchorElement>('a.hhr-center-app-link');
    expect(appLink?.href).toBe('https://hhr-hospitalizados.app/');
    expect(appLink?.rel).toContain('noopener');
  });
});
