import { describe, expect, it, vi } from 'vitest';
import {
  createCensusDialogRuntime,
  createCensusStorageRuntime,
} from '@/features/census/controllers/censusBrowserRuntimeAdapter';
import type { BrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

const createMockBrowserRuntime = (): BrowserWindowRuntime => ({
  alert: vi.fn(),
  confirm: vi.fn().mockReturnValue(true),
  open: vi.fn(),
  reload: vi.fn(),
  getLocationOrigin: vi.fn().mockReturnValue(''),
  getLocationPathname: vi.fn().mockReturnValue(''),
  getLocationHref: vi.fn().mockReturnValue(''),
  getViewportWidth: vi.fn().mockReturnValue(0),
  getLocalStorageItem: vi.fn().mockReturnValue('v'),
  setLocalStorageItem: vi.fn(),
  removeLocalStorageItem: vi.fn(),
});

describe('censusBrowserRuntimeAdapter', () => {
  it('maps dialog operations to browser runtime', () => {
    const runtime = createMockBrowserRuntime();
    const dialog = createCensusDialogRuntime(runtime);

    dialog.alert('hola');
    const confirmed = dialog.confirm('ok?');
    dialog.open('https://example.com');

    expect(runtime.alert).toHaveBeenCalledWith('hola');
    expect(runtime.confirm).toHaveBeenCalledWith('ok?');
    expect(confirmed).toBe(true);
    expect(runtime.open).toHaveBeenCalledWith('https://example.com', '_blank');
  });

  it('maps storage operations to browser runtime', () => {
    const runtime = createMockBrowserRuntime();
    const storage = createCensusStorageRuntime(runtime);

    expect(storage.getItem('k')).toBe('v');
    storage.setItem('k', 'x');
    storage.removeItem('k');

    expect(runtime.getLocalStorageItem).toHaveBeenCalledWith('k');
    expect(runtime.setLocalStorageItem).toHaveBeenCalledWith('k', 'x');
    expect(runtime.removeLocalStorageItem).toHaveBeenCalledWith('k');
  });
});
