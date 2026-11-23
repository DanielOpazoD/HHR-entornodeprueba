import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCensusEmailBrowserRuntime } from '@/features/census/email/controllers/censusEmailBrowserRuntimeController';

const defaultLocalStorage = globalThis.localStorage;

describe('censusEmailBrowserRuntimeController', () => {
  afterEach(() => {
    vi.stubGlobal('localStorage', defaultLocalStorage);
  });

  it('reads and clears legacy recipients from localStorage when available', () => {
    localStorage.setItem('censusEmailRecipients', '["a@hospital.cl"]');

    expect(defaultCensusEmailBrowserRuntime.getLegacyRecipients()).toBe('["a@hospital.cl"]');

    defaultCensusEmailBrowserRuntime.clearLegacyRecipients();
    expect(localStorage.getItem('censusEmailRecipients')).toBeNull();
  });

  it('degrades gracefully when localStorage throws SecurityError', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError');
      }),
      removeItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError');
      }),
    });

    expect(defaultCensusEmailBrowserRuntime.getLegacyRecipients()).toBeNull();
    expect(() => defaultCensusEmailBrowserRuntime.clearLegacyRecipients()).not.toThrow();
  });
});
