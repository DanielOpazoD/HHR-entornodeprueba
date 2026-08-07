import { describe, expect, it, vi } from 'vitest';
import { createBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import {
  getNavigatorUserAgent,
  writeClipboardText,
} from '@/shared/runtime/browserClipboardRuntime';

describe('browserWindowRuntime', () => {
  it('delegates alert, confirm and open to window', () => {
    const runtime = createBrowserWindowRuntime();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    runtime.alert('hola');
    const confirmed = runtime.confirm('seguro?');
    runtime.open('https://example.com', '_blank');
    runtime.open('https://example.com/seguro', '_blank', 'noopener');

    expect(alertSpy).toHaveBeenCalledWith('hola');
    expect(confirmSpy).toHaveBeenCalledWith('seguro?');
    expect(confirmed).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/seguro',
      '_blank',
      'noopener'
    );
  });

  it('reads location properties and exposes reload operation', () => {
    const runtime = createBrowserWindowRuntime();

    expect(runtime.getLocationOrigin()).toBe(window.location.origin);
    expect(runtime.getLocationPathname()).toBe(window.location.pathname);
    expect(runtime.getLocationHref()).toBe(window.location.href);
    expect(runtime.getViewportWidth()).toBe(window.innerWidth);
    expect(typeof runtime.reload).toBe('function');
  });

  it('delegates localStorage operations', () => {
    const runtime = createBrowserWindowRuntime();
    const getItemSpy = vi.spyOn(window.localStorage, 'getItem');
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    const removeItemSpy = vi.spyOn(window.localStorage, 'removeItem');

    runtime.setLocalStorageItem('k', 'v');
    runtime.getLocalStorageItem('k');
    runtime.removeLocalStorageItem('k');

    expect(setItemSpy).toHaveBeenCalledWith('k', 'v');
    expect(getItemSpy).toHaveBeenCalledWith('k');
    expect(removeItemSpy).toHaveBeenCalledWith('k');
  });

  it('returns safe defaults when no window is available', () => {
    const runtime = createBrowserWindowRuntime({
      getWindow: () => null,
    });

    expect(runtime.alert).not.toThrow();
    expect(runtime.confirm('cualquier')).toBe(false);
    expect(runtime.open('https://example.com', '_blank')).toBeNull();
    expect(runtime.getLocationOrigin()).toBe('');
    expect(runtime.getLocationPathname()).toBe('');
    expect(runtime.getLocationHref()).toBe('');
    expect(runtime.getViewportWidth()).toBe(0);
    expect(runtime.getLocalStorageItem('missing')).toBeNull();
  });

  it('uses injected runtime provider for deterministic tests', () => {
    const fakeWindow = {
      alert: vi.fn(),
      confirm: vi.fn().mockReturnValue(false),
      open: vi.fn().mockReturnValue(null),
      location: {
        reload: vi.fn(),
        origin: 'https://fake.local',
        pathname: '/prueba',
        href: 'https://fake.local/prueba',
      },
      innerWidth: 1440,
      localStorage: {
        getItem: vi.fn().mockReturnValue('v'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    } as unknown as Window;

    const runtime = createBrowserWindowRuntime({
      getWindow: () => fakeWindow,
    });

    runtime.alert('hola');
    runtime.confirm('seguro?');
    runtime.open('https://example.com', '_self');
    runtime.reload();

    expect(fakeWindow.alert).toHaveBeenCalledWith('hola');
    expect(fakeWindow.confirm).toHaveBeenCalledWith('seguro?');
    expect(fakeWindow.open).toHaveBeenCalledWith('https://example.com', '_self');
    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
    expect(runtime.getLocationHref()).toBe('https://fake.local/prueba');
  });

  it('writes text to clipboard when available', async () => {
    if (!navigator.clipboard) {
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn(),
        },
      });
    }
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    await writeClipboardText('hola');

    expect(writeTextSpy).toHaveBeenCalledWith('hola');
  });

  it('returns navigator user agent through runtime helper', () => {
    expect(getNavigatorUserAgent()).toBe(navigator.userAgent);
  });
});
