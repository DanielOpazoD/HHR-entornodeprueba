import { describe, expect, it, vi } from 'vitest';
import { defaultSharedCensusBrowserRuntime } from '@/features/census/controllers/sharedCensusBrowserRuntimeController';

describe('sharedCensusBrowserRuntimeController', () => {
  it('delegates alert and open to window runtime', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    defaultSharedCensusBrowserRuntime.alert('hola');
    defaultSharedCensusBrowserRuntime.open('https://example.com', '_blank');

    expect(alertSpy).toHaveBeenCalledWith('hola');
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
  });
});
