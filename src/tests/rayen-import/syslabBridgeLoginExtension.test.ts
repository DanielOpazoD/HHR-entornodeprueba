// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/lab-result-parser.js';
import '../../../extension/lab-viewer.js';

const bridgeSource = readFileSync(path.resolve('extension/syslab-bridge.js'), 'utf8');

describe('Syslab login bridge', () => {
  afterEach(() => {
    delete (window as typeof window & { __HHR_SYSLAB_BRIDGE__?: boolean }).__HHR_SYSLAB_BRIDGE__;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('relays credentials once to the official form without persisting them', async () => {
    document.body.innerHTML = `
      <form>
        <input name="usuario" type="text">
        <input name="password" type="password">
        <button type="button">Ingresar</button>
      </form>
    `;
    const submit = document.querySelector('button') as HTMLButtonElement;
    const clickSpy = vi.spyOn(submit, 'click').mockImplementation(() => undefined);
    let listener: (
      message: Record<string, unknown>,
      sender: unknown,
      sendResponse: (response: unknown) => void
    ) => boolean = () => false;
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: {
        getURL: (value: string) => `chrome-extension://test/${value}`,
        onMessage: {
          addListener: (registered: typeof listener) => {
            listener = registered;
          },
        },
      },
    };

    vm.runInThisContext(bridgeSource, { filename: 'syslab-bridge.js' });
    const transientCredential = ['temporal', 123].join('-');
    const response = await new Promise<Record<string, unknown>>(resolve => {
      expect(
        listener(
          { type: 'RAYEN_SYSLAB_LOGIN', username: 'test-user', password: transientCredential },
          {},
          value => resolve(value as Record<string, unknown>)
        )
      ).toBe(true);
    });

    expect(response).toMatchObject({ ok: true, navigated: true });
    expect((document.querySelector('input[name="usuario"]') as HTMLInputElement).value).toBe(
      'test-user'
    );
    expect((document.querySelector('input[name="password"]') as HTMLInputElement).value).toBe(
      transientCredential
    );
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(bridgeSource).not.toContain('chrome.storage');
    expect(bridgeSource).not.toContain('localStorage');
    expect(bridgeSource).not.toContain('sessionStorage');
  });

  it('starts without Web Crypto on legacy HTTP and accepts only extension-parent relays', async () => {
    const frameListeners: { message?: (event: MessageEvent) => void } = {};
    const parentPostMessage = vi.fn();
    const extensionParent = { postMessage: parentPostMessage };
    const frameWindow: Record<string, unknown> = {
      parent: extensionParent,
      HhrLabViewer: (globalThis as typeof globalThis & { HhrLabViewer: unknown }).HhrLabViewer,
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') frameListeners.message = listener;
      },
      document: { querySelector: () => null, querySelectorAll: () => [] },
      location: { href: 'http://10.4.69.90/syslab/' },
      setTimeout,
      clearTimeout,
      console,
      URL,
      AbortController,
      TextDecoder,
      Uint8Array,
      Promise,
      runtime: {
        getURL: (value: string) => `chrome-extension://test/${value}`,
        onMessage: { addListener: vi.fn() },
      },
    };
    frameWindow.window = frameWindow;
    frameWindow.self = frameWindow;
    frameWindow.chrome = { runtime: frameWindow.runtime };
    vm.runInNewContext(bridgeSource, frameWindow, { filename: 'syslab-bridge.js' });
    expect(frameListeners.message).toBeTypeOf('function');
    const request = {
      type: 'HHR_SYSLAB_FRAME_REQUEST',
      reqId: '11111111-1111-4111-8111-111111111111',
      message: { type: 'RAYEN_SYSLAB_STATUS' },
    };

    frameListeners.message?.(
      new MessageEvent('message', {
        data: request,
        origin: 'https://malicious.example',
        source: extensionParent as unknown as Window,
      })
    );
    frameListeners.message?.(
      new MessageEvent('message', {
        data: request,
        origin: 'chrome-extension://test',
        source: frameWindow as unknown as Window,
      })
    );
    expect(parentPostMessage).not.toHaveBeenCalled();

    frameListeners.message?.(
      new MessageEvent('message', {
        data: request,
        origin: 'chrome-extension://test',
        source: extensionParent as unknown as Window,
      })
    );
    await vi.waitFor(() =>
      expect(parentPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HHR_SYSLAB_FRAME_RESULT',
          reqId: request.reqId,
          response: expect.objectContaining({
            ok: true,
            bridgeId: expect.stringMatching(/^syslab-/),
          }),
        }),
        'chrome-extension://test'
      )
    );
  });

  it('reuses the results-page RUT form when Syslab no longer renders Aceptar', async () => {
    document.body.innerHTML = `
      <form>
        <input name="rut" type="text">
      </form>
      <button type="button">Buscar</button>
    `;
    const form = document.querySelector('form') as HTMLFormElement;
    const requestSubmitSpy = vi.spyOn(form, 'requestSubmit').mockImplementation(() => undefined);
    const unrelatedClickSpy = vi.spyOn(document.querySelector('button')!, 'click');
    let listener: (
      message: Record<string, unknown>,
      sender: unknown,
      sendResponse: (response: unknown) => void
    ) => boolean = () => false;
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: {
        getURL: (value: string) => `chrome-extension://test/${value}`,
        onMessage: {
          addListener: (registered: typeof listener) => {
            listener = registered;
          },
        },
      },
    };

    vm.runInThisContext(bridgeSource, { filename: 'syslab-bridge.js' });
    const response = await new Promise<Record<string, unknown>>(resolve => {
      listener({ type: 'RAYEN_SYSLAB_SUBMIT_SEARCH', rutBody: '12345678' }, {}, value =>
        resolve(value as Record<string, unknown>)
      );
    });

    expect(response).toMatchObject({ ok: true, navigated: true });
    expect((document.querySelector('input[name="rut"]') as HTMLInputElement).value).toBe(
      '12345678'
    );
    await vi.waitFor(() => expect(requestSubmitSpy).toHaveBeenCalledTimes(1));
    expect(unrelatedClickSpy).not.toHaveBeenCalled();
  });
});
