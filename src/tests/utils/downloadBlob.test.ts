import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '@/utils/downloadBlob';

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers a hidden anchor download, cleans up the DOM node, and revokes the object URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:synthetic-download');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const blob = new Blob(['synthetic'], { type: 'text/plain' });
    downloadBlob(blob, 'reporte-sintetico.txt');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="reporte-sintetico.txt"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-download');
  });
});
