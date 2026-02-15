import { describe, expect, it, vi } from 'vitest';
import { createBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

describe('browserWindowRuntime', () => {
  it('delegates alert, confirm and open to window', () => {
    const runtime = createBrowserWindowRuntime();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    runtime.alert('hola');
    const confirmed = runtime.confirm('seguro?');
    runtime.open('https://example.com', '_blank');

    expect(alertSpy).toHaveBeenCalledWith('hola');
    expect(confirmSpy).toHaveBeenCalledWith('seguro?');
    expect(confirmed).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
  });

  it('reads location properties and exposes reload operation', () => {
    const runtime = createBrowserWindowRuntime();

    expect(runtime.getLocationOrigin()).toBe(window.location.origin);
    expect(runtime.getLocationPathname()).toBe(window.location.pathname);
    expect(runtime.getLocationHref()).toBe(window.location.href);
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
});
