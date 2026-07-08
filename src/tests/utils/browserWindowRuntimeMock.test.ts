import { describe, expect, it, vi } from 'vitest';
import { createMockBrowserWindowRuntime } from '@/tests/utils/browserWindowRuntimeMock';

describe('browserWindowRuntimeMock', () => {
  it('creates a BrowserWindowRuntime with safe jsdom defaults', () => {
    const runtime = createMockBrowserWindowRuntime();

    expect(runtime.alert).toEqual(expect.any(Function));
    expect(runtime.confirm('Confirmar')).toBe(true);
    expect(runtime.open('/ruta', '_blank')).toBeNull();
    expect(runtime.getLocationOrigin()).toBe('http://localhost');
    expect(runtime.getLocationPathname()).toBe('/');
    expect(runtime.getLocationHref()).toBe('http://localhost/');
    expect(runtime.getViewportWidth()).toBe(1024);
    expect(runtime.getLocalStorageItem('missing')).toBeNull();

    runtime.reload();
    runtime.setLocalStorageItem('key', 'value');
    runtime.removeLocalStorageItem('key');

    expect(runtime.reload).toHaveBeenCalledTimes(1);
    expect(runtime.setLocalStorageItem).toHaveBeenCalledWith('key', 'value');
    expect(runtime.removeLocalStorageItem).toHaveBeenCalledWith('key');
  });

  it('keeps test-specific overrides explicit', () => {
    const alert = vi.fn();
    const open = vi.fn(() => ({ closed: false }) as Window);
    const runtime = createMockBrowserWindowRuntime({
      alert,
      getViewportWidth: vi.fn(() => 480),
      open,
    });

    runtime.alert('Error visible');

    expect(alert).toHaveBeenCalledWith('Error visible');
    expect(runtime.getViewportWidth()).toBe(480);
    expect(runtime.open('', '_blank')).toEqual({ closed: false });
  });
});
