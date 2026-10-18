import { expect, type Page } from '@playwright/test';

type Probe = {
  syntheticGraphicsState: () => { live: number; recoverable: number };
  syntheticLoseGraphics: () => Promise<void>;
};
/** Synthetic-only probe: WeakRefs do not keep destroyed contexts alive during heap measurements. */
export const installDicomGraphicsProbe = (page: Page) =>
  page.addInitScript(() => {
    const contexts: WeakRef<WebGLRenderingContext>[] = [];
    const known = new WeakSet<EventTarget>();
    const listeners = new WeakMap<EventTarget, Set<EventListenerOrEventListenerObject>>();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, type, callback, options) {
      if (this instanceof HTMLCanvasElement && type === 'webglcontextlost' && callback) {
        known.add(this);
        const set = listeners.get(this) ?? new Set();
        set.add(callback);
        listeners.set(this, set);
      }
      add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (
      this: EventTarget,
      type,
      callback,
      options
    ) {
      if (type === 'webglcontextlost' && callback) listeners.get(this)?.delete(callback);
      remove.call(this, type, callback, options);
    };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      const value = original.apply(this, args);
      if (value && 'getExtension' in value && !contexts.some(ref => ref.deref() === value))
        contexts.push(new WeakRef(value as WebGLRenderingContext));
      return value;
    } as typeof original;
    const live = () =>
      contexts
        .flatMap(ref => (ref.deref() ? [ref.deref()!] : []))
        .filter(gl => known.has(gl.canvas) && !gl.isContextLost());
    // VTK installs its own loss listener. The active continuity owner installs the second;
    // the suspended primary engine must not be mistaken for the visible comparison engine.
    const active = () => live().filter(gl => (listeners.get(gl.canvas)?.size ?? 0) > 1);
    Object.assign(window, {
      syntheticGraphicsState: () => ({ live: live().length, recoverable: active().length }),
      syntheticLoseGraphics: () => {
        const gl = active()[0];
        if (!gl) throw new Error('No active synthetic viewer context');
        return new Promise<void>(resolve => {
          add.call(gl.canvas, 'webglcontextlost', () => resolve(), { once: true });
          gl.getExtension('WEBGL_lose_context')!.loseContext();
        });
      },
    });
  });
export const liveDicomContexts = (page: Page) =>
  page.evaluate(() => (window as unknown as Probe).syntheticGraphicsState().live);
export const loseDicomGraphics = async (page: Page, recover = true) => {
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Probe).syntheticGraphicsState().recoverable)
    )
    .toBe(1);
  await page.evaluate(() => (window as unknown as Probe).syntheticLoseGraphics());
  if (recover)
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as unknown as Probe).syntheticGraphicsState().recoverable),
        { timeout: 30000 }
      )
      .toBe(1);
};
