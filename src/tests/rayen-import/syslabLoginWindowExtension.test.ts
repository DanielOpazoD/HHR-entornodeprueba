// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/syslab-login-window.js';

interface SyslabLoginWindowFactory {
  create: (dependencies: { chrome: unknown }) => { open: () => Promise<Record<string, unknown>> };
  register: (dependencies: { chrome: unknown; messageContract: unknown }) => void;
}

const factory = (
  globalThis as typeof globalThis & { HhrSyslabLoginWindow: SyslabLoginWindowFactory }
).HhrSyslabLoginWindow;

const createChrome = (existingTabs: Array<{ id: number; windowId: number }> = []) => ({
  runtime: { getURL: vi.fn(() => 'chrome-extension://test/syslab-login.html') },
  tabs: {
    query: vi.fn(async () => existingTabs),
    update: vi.fn(async () => ({})),
  },
  windows: {
    create: vi.fn(async () => ({ id: 9 })),
    update: vi.fn(async () => ({})),
  },
});

describe('Syslab login extension window', () => {
  it('opens the extension-owned credential form in a focused popup', async () => {
    const chrome = createChrome();
    const loginWindow = factory.create({ chrome });

    await expect(loginWindow.open()).resolves.toEqual({ ok: true, opened: true, reused: false });
    expect(chrome.windows.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/syslab-login.html',
      type: 'popup',
      width: 720,
      height: 230,
      focused: true,
    });
  });

  it('focuses an existing credential window instead of opening duplicates', async () => {
    const chrome = createChrome([{ id: 17, windowId: 4 }]);
    const loginWindow = factory.create({ chrome });

    await expect(loginWindow.open()).resolves.toEqual({ ok: true, opened: true, reused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(17, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(4, { focused: true });
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('registers its own isolated runtime route', () => {
    const chrome = createChrome();
    const addListener = vi.fn();
    Object.assign(chrome.runtime, { onMessage: { addListener } });
    const router = vi.fn(() => 'login-window-listener');
    const messageContract = {
      types: { SYSLAB_LOGIN_OPEN_REQUEST: 'RAYEN_SYSLAB_LOGIN_OPEN_REQUEST' },
      createRuntimeRouter: router,
    };

    factory.register({ chrome, messageContract });

    expect(router).toHaveBeenCalledWith({
      RAYEN_SYSLAB_LOGIN_OPEN_REQUEST: expect.objectContaining({
        handle: expect.any(Function),
        fallback: 'No se pudo abrir el acceso a Syslab.',
      }),
    });
    expect(addListener).toHaveBeenCalledWith('login-window-listener');
  });
});
