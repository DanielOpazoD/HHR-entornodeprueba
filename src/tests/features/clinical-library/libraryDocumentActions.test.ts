import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canPrintInline,
  openLibraryDocument,
  printLibraryDocument,
  toLibraryDocumentHref,
} from '@/features/clinical-library/services/libraryDocumentActions';
import type { BrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const runtimeStub = (): BrowserWindowRuntime =>
  ({ open: vi.fn(() => null) }) as unknown as BrowserWindowRuntime;

// El user agent de jsdom contiene «AppleWebKit»: forzar un Chrome para probar la impresión inline.
const chromeNavigator = { userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/128' } as Navigator;

describe('library document actions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('encodes public paths with spaces and accents', () => {
    expect(toLibraryDocumentHref('/templates/Solicitud examen imagenología .docx')).toBe(
      '/templates/Solicitud%20examen%20imagenolog%C3%ADa%20.docx'
    );
    expect(toLibraryDocumentHref('/docs/consentimiento.pdf')).toBe('/docs/consentimiento.pdf');
    expect(toLibraryDocumentHref('/docs/Informe #3 (a+b)?.pdf')).toBe(
      '/docs/Informe%20%233%20(a%2Bb)%3F.pdf'
    );
  });

  it('prints inline only where the embedded PDF viewer is reliable', () => {
    const agent = (userAgent: string, pdfViewerEnabled?: boolean) =>
      ({ userAgent, pdfViewerEnabled }) as unknown as Navigator;
    expect(canPrintInline(undefined)).toBe(true);
    expect(canPrintInline(agent('Mozilla/5.0 AppleWebKit/537.36 Chrome/128 Safari/537.36'))).toBe(
      true
    );
    expect(canPrintInline(agent('Mozilla/5.0 Gecko/20100101 Firefox/130'))).toBe(true);
    expect(
      canPrintInline(agent('Mozilla/5.0 (iPad) AppleWebKit/605.1.15 Version/17 Safari/605.1.15'))
    ).toBe(false);
    expect(canPrintInline(agent('Mozilla/5.0 Chrome/128', false))).toBe(false);
  });

  it('opens a new tab instead of printing inline on WebKit', () => {
    const runtime = runtimeStub();
    const frame = printLibraryDocument('/docs/consentimiento.pdf', {
      runtime,
      navigator: { userAgent: 'AppleWebKit/605 Safari/605' } as Navigator,
    });
    expect(frame).toBeNull();
    expect(runtime.open).toHaveBeenCalledWith(
      '/docs/consentimiento.pdf',
      '_blank',
      'noopener,noreferrer'
    );
    expect(document.querySelector('iframe[data-library-print-frame]')).toBeNull();
  });

  it('never keeps two print frames alive at once', () => {
    vi.useFakeTimers();
    const runtime = runtimeStub();
    printLibraryDocument('/docs/a.pdf', { runtime, navigator: chromeNavigator });
    printLibraryDocument('/docs/b.pdf', { runtime, navigator: chromeNavigator });
    const frames = document.querySelectorAll('iframe[data-library-print-frame]');
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute('src')).toBe('/docs/b.pdf');
  });

  it('opens documents in a new isolated tab', () => {
    const runtime = runtimeStub();
    openLibraryDocument('/docs/a b.pdf', runtime);
    expect(runtime.open).toHaveBeenCalledWith('/docs/a%20b.pdf', '_blank', 'noopener,noreferrer');
  });

  it('prints through a hidden iframe and removes it after printing', () => {
    vi.useFakeTimers();
    const runtime = runtimeStub();
    const print = vi.fn();
    const listeners: Record<string, () => void> = {};
    const fakeWindow = {
      focus: vi.fn(),
      print,
      addEventListener: (type: string, listener: () => void) => {
        listeners[type] = listener;
      },
    };
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
      fakeWindow as unknown as Window
    );

    const frame = printLibraryDocument('/docs/consentimiento.pdf', {
      runtime,
      navigator: chromeNavigator,
    });
    expect(frame).not.toBeNull();
    expect(document.querySelector('iframe[data-library-print-frame]')).toBe(frame);
    expect(frame?.getAttribute('src')).toBe('/docs/consentimiento.pdf');
    expect(frame?.getAttribute('aria-hidden')).toBe('true');
    expect(frame?.tabIndex).toBe(-1);

    frame?.dispatchEvent(new Event('load'));
    expect(fakeWindow.focus).toHaveBeenCalled();
    expect(print).toHaveBeenCalledTimes(1);
    expect(runtime.open).not.toHaveBeenCalled();

    listeners.afterprint?.();
    expect(document.querySelector('iframe[data-library-print-frame]')).toBeNull();
  });

  it('falls back to a new tab when the frame cannot print, and always cleans up', () => {
    vi.useFakeTimers();
    const runtime = runtimeStub();
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(null);

    const frame = printLibraryDocument('/docs/consentimiento.pdf', {
      runtime,
      cleanupDelayMs: 1000,
      navigator: chromeNavigator,
    });
    frame?.dispatchEvent(new Event('load'));
    expect(runtime.open).toHaveBeenCalledWith(
      '/docs/consentimiento.pdf',
      '_blank',
      'noopener,noreferrer'
    );
    expect(document.querySelector('iframe[data-library-print-frame]')).toBeNull();

    const lingering = printLibraryDocument('/docs/consentimiento.pdf', {
      runtime,
      cleanupDelayMs: 1000,
      navigator: chromeNavigator,
    });
    expect(document.body.contains(lingering)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(document.body.contains(lingering)).toBe(false);
  });

  it('does nothing without a document host', () => {
    expect(printLibraryDocument('/docs/consentimiento.pdf', { host: null })).toBeNull();
  });
});
