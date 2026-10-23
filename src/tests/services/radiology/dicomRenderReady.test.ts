import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@cornerstonejs/core', () => ({ Enums: { Events: { IMAGE_RENDERED: 'image-rendered' } } }));
import { waitForDicomRender } from '@/services/radiology/dicomRenderReady';

describe('DICOM render readiness', () => {
  afterEach(() => vi.useRealTimers());
  it('subscribes before a synchronous render and waits for every viewport', async () => {
    const views = [document.createElement('div'), document.createElement('div')];
    const controller = new AbortController();
    let complete = false;
    const ready = waitForDicomRender(
      views,
      () => views[0].dispatchEvent(new Event('image-rendered')),
      controller.signal
    ).then(() => {
      complete = true;
    });
    await Promise.resolve();
    expect(complete).toBe(false);
    views[1].dispatchEvent(new Event('image-rendered'));
    await ready;
    expect(complete).toBe(true);
  });
  it('cancels pending rendering and removes its listeners on close', async () => {
    const element = document.createElement('div');
    const remove = vi.spyOn(element, 'removeEventListener');
    const controller = new AbortController();
    const ready = waitForDicomRender([element], () => undefined, controller.signal);
    const rejected = expect(ready).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(remove).toHaveBeenCalledWith('image-rendered', expect.any(Function));
  });
  it('fails instead of leaving capture enabled for an unfinished view', async () => {
    vi.useFakeTimers();
    const ready = waitForDicomRender(
      [document.createElement('div')],
      () => undefined,
      new AbortController().signal
    );
    const rejected = expect(ready).rejects.toThrow('No se completó la imagen');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates a render error and clears the timeout', async () => {
    vi.useFakeTimers();
    await expect(
      waitForDicomRender(
        [document.createElement('div')],
        () => {
          throw new Error('render failed');
        },
        new AbortController().signal
      )
    ).rejects.toThrow('render failed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
