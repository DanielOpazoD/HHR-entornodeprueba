import { afterEach, describe, expect, it, vi } from 'vitest';
import { printHtmlDocument } from '@/features/census/components/clinical-explorer/clinicalExplorerPrint';

const frame = (): HTMLIFrameElement => {
  const found = document.querySelector('iframe');
  if (!found) throw new Error('no print frame');
  return found;
};

describe('printHtmlDocument', () => {
  afterEach(() => document.querySelectorAll('iframe').forEach(node => node.remove()));

  it('prints once from a hidden frame when it loads', async () => {
    const printing = printHtmlDocument('<p>Indicaciones</p>');
    const print = vi.spyOn(frame().contentWindow!, 'print').mockImplementation(() => undefined);
    frame().dispatchEvent(new Event('load'));
    await expect(printing).resolves.toBeUndefined();
    expect(print).toHaveBeenCalledTimes(1);
    expect(frame().getAttribute('aria-hidden')).toBe('true');
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
