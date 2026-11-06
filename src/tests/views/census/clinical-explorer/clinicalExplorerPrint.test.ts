import { afterEach, describe, expect, it, vi } from 'vitest';
import { printHtmlDocument } from '@/features/census/components/clinical-explorer/clinicalExplorerPrint';

const frame = (): HTMLIFrameElement => {
  const found = document.querySelector('iframe');
  if (!found) throw new Error('no print frame');
  return found;
};

describe('printHtmlDocument', () => {
  afterEach(() => {
    document.querySelectorAll('iframe').forEach(node => node.remove());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('prints once from a hidden frame when it loads', async () => {
    const printing = printHtmlDocument('<p>Indicaciones</p>');
    const print = vi.spyOn(frame().contentWindow!, 'print').mockImplementation(() => undefined);
    frame().dispatchEvent(new Event('load'));
    await expect(printing).resolves.toBeUndefined();
    expect(print).toHaveBeenCalledTimes(1);
    expect(frame().getAttribute('aria-hidden')).toBe('true');
  });

  it.each(['focus', 'print'] as const)(
    'rejects and removes the frame when %s throws',
    async method => {
      vi.useFakeTimers();
      const printing = printHtmlDocument('<p>Sintético</p>');
      const printFrame = frame();
      vi.spyOn(printFrame.contentWindow!, 'focus').mockImplementation(() => undefined);
      vi.spyOn(printFrame.contentWindow!, 'print').mockImplementation(() => undefined);
      vi.spyOn(printFrame.contentWindow!, method).mockImplementation(() => {
        throw new Error('browser failure');
      });
      const rejected = expect(printing).rejects.toThrow('print_unavailable');
      printFrame.dispatchEvent(new Event('load'));
      await rejected;
      expect(document.querySelector('iframe')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('rejects a failed frame load', async () => {
    const printing = printHtmlDocument('<p>Sintético</p>');
    const rejected = expect(printing).rejects.toThrow('print_unavailable');
    frame().dispatchEvent(new Event('error'));
    await rejected;
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('times out an unloaded frame and ignores a late load instead of printing', async () => {
    vi.useFakeTimers();
    const printing = printHtmlDocument('<p>Sintético</p>');
    const printFrame = frame();
    const print = vi.spyOn(printFrame.contentWindow!, 'print').mockImplementation(() => undefined);
    const rejected = expect(printing).rejects.toThrow('print_load_timeout');
    vi.advanceTimersByTime(30_000);
    await rejected;
    printFrame.dispatchEvent(new Event('load'));
    expect(print).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('prints nothing and removes the frame when cancelled before it loads', async () => {
    const controller = new AbortController();
    const printing = printHtmlDocument('<p>Indicaciones</p>', controller.signal);
    const print = vi.spyOn(frame().contentWindow!, 'print').mockImplementation(() => undefined);
    controller.abort();
    await expect(printing).rejects.toMatchObject({ name: 'AbortError' });
    expect(document.querySelector('iframe')).toBeNull();
    expect(print).not.toHaveBeenCalled();
  });

  it('does not even create the frame when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(printHtmlDocument('<p>x</p>', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(document.querySelector('iframe')).toBeNull();
  });
});
