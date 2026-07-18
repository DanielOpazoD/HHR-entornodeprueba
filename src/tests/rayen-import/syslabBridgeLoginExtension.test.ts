// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
