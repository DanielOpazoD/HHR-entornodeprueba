import { vi } from 'vitest';
import type { BrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

export type BrowserWindowRuntimeMockOverrides = Partial<BrowserWindowRuntime>;

export const createMockBrowserWindowRuntime = (
  overrides: BrowserWindowRuntimeMockOverrides = {}
): BrowserWindowRuntime => ({
  alert: vi.fn(),
  confirm: vi.fn(() => true),
  open: vi.fn(() => null),
  reload: vi.fn(),
  getLocationOrigin: vi.fn(() => 'http://localhost'),
  getLocationPathname: vi.fn(() => '/'),
  getLocationHref: vi.fn(() => 'http://localhost/'),
  getViewportWidth: vi.fn(() => 1024),
  getLocalStorageItem: vi.fn(() => null),
  setLocalStorageItem: vi.fn(),
  removeLocalStorageItem: vi.fn(),
  ...overrides,
});
