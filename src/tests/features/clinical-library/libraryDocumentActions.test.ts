import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  openLibraryDocument,
  printLibraryDocument,
  toLibraryDocumentHref,
} from '@/features/clinical-library/services/libraryDocumentActions';
import type { BrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const runtimeStub = (): BrowserWindowRuntime =>
  ({ open: vi.fn(() => null) }) as unknown as BrowserWindowRuntime;

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

    const frame = printLibraryDocument('/docs/consentimiento.pdf', { runtime });
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
    });
    expect(document.body.contains(lingering)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(document.body.contains(lingering)).toBe(false);
  });

  it('does nothing without a document host', () => {
    expect(printLibraryDocument('/docs/consentimiento.pdf', { host: null })).toBeNull();
  });
});
