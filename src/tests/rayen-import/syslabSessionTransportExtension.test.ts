// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/syslab-session-transport.js';

interface TestSessionTransport {
  resolve: () => Promise<Record<string, unknown>>;
  send: (
    session: Record<string, unknown>,
    message: Record<string, unknown>,
    timeoutMs: number
  ) => Promise<Record<string, unknown>>;
  sendWithVisibleFallback: (
    session: Record<string, unknown>,
    message: Record<string, unknown>,
    timeoutMs: number
  ) => Promise<Record<string, unknown>>;
  waitAfterNavigation: (
    session: Record<string, unknown>,
    bridgeId: string,
    timeoutMs: number
  ) => Promise<Record<string, unknown>>;
  withVisibleFallback: (
    session: Record<string, unknown>,
    operation: (session: Record<string, unknown>) => Promise<Record<string, unknown>>,
    options: { timeoutMs: number }
  ) => Promise<Record<string, unknown>>;
}

const sessionTransportFactory = (
  globalThis as unknown as {
    HhrSyslabSessionTransport: {
      create: (dependencies: Record<string, unknown>) => TestSessionTransport;
    };
  }
).HhrSyslabSessionTransport;

const createTransport = ({
  tabs = [],
  tabResponse,
  offscreenResponse = { bridgeId: 'offscreen-1', loginRequired: false },
}: {
  tabs?: Array<{ id: number }>;
  tabResponse?: (tabId: number, message: { type: string }) => Promise<Record<string, unknown>>;
  offscreenResponse?: Record<string, unknown>;
} = {}) => {
  const sendMessage = vi.fn(
    tabResponse || (async () => ({ bridgeId: 'visible-1', loginRequired: false }))
  );
  const query = vi.fn(async () => tabs);
  const sendToOffscreen = vi.fn(async () => offscreenResponse);
  const transport = sessionTransportFactory.create({
    chrome: {
      tabs: {
        query,
        sendMessage,
      },
    },
    withTimeout: <T>(promise: Promise<T>) => promise,
    sendToOffscreen,
    delay: vi.fn(async () => undefined),
  });
  return { query, sendMessage, sendToOffscreen, transport };
};

describe('Syslab session transport', () => {
  it('prefers an authenticated visible Syslab tab without reading cookies or credentials', async () => {
    const { sendMessage, sendToOffscreen, transport } = createTransport({ tabs: [{ id: 42 }] });

    const session = await transport.resolve();

    expect(session).toMatchObject({
      kind: 'visible-tab',
      tabId: 42,
      status: { loginRequired: false },
    });
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'RAYEN_SYSLAB_STATUS' });
    expect(sendToOffscreen).not.toHaveBeenCalled();
  });

  it('prefers the search-capable Syslab tab when several authenticated reports are open', async () => {
    const { transport } = createTransport({
      tabs: [{ id: 40 }, { id: 42 }],
      tabResponse: async tabId => ({
        bridgeId: `visible-${tabId}`,
        loginRequired: false,
        url:
          tabId === 42
            ? 'http://10.4.69.90/syslab/aplicacion.php'
            : 'http://10.4.69.90/syslab/detalleexamenes.php?id=1',
      }),
    });

    await expect(transport.resolve()).resolves.toMatchObject({
      kind: 'visible-tab',
      tabId: 42,
    });
  });

  it('falls back to the isolated offscreen session when visible tabs are absent', async () => {
    const { sendToOffscreen, transport } = createTransport();

    await expect(transport.resolve()).resolves.toMatchObject({
      kind: 'offscreen',
      status: { bridgeId: 'offscreen-1' },
    });
    expect(sendToOffscreen).toHaveBeenCalledWith({ type: 'RAYEN_SYSLAB_STATUS' }, 4_000);
  });

  it('preserves the offscreen fallback when visible tab discovery fails', async () => {
    const { query, transport } = createTransport();
    query.mockRejectedValueOnce(new Error('tabs unavailable'));

    await expect(transport.resolve()).resolves.toMatchObject({ kind: 'offscreen' });
  });

  it('ignores visible login pages and preserves the offscreen fallback', async () => {
    const { transport } = createTransport({
      tabs: [{ id: 51 }],
      tabResponse: async () => ({ bridgeId: 'visible-login', loginRequired: true }),
    });

    await expect(transport.resolve()).resolves.toMatchObject({ kind: 'offscreen' });
  });

  it('ignores errored visible tabs and preserves the offscreen fallback', async () => {
    const { transport } = createTransport({
      tabs: [{ id: 52 }],
      tabResponse: async () => ({
        bridgeId: 'visible-error',
        loginRequired: false,
        error: 'El contenido de la pestaña ya no responde.',
      }),
    });

    await expect(transport.resolve()).resolves.toMatchObject({ kind: 'offscreen' });
  });

  it('retries the offscreen bridge while its document finishes loading', async () => {
    const { sendToOffscreen, transport } = createTransport();
    sendToOffscreen
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ bridgeId: 'offscreen-ready', loginRequired: false });

    await expect(transport.resolve()).resolves.toMatchObject({
      kind: 'offscreen',
      status: { bridgeId: 'offscreen-ready' },
    });
    expect(sendToOffscreen).toHaveBeenCalledTimes(2);
  });

  it('keeps navigation bound to the same visible Syslab tab', async () => {
    let statusCalls = 0;
    const { transport } = createTransport({
      tabs: [{ id: 73 }],
      tabResponse: async (_tabId, message) => {
        if (message.type !== 'RAYEN_SYSLAB_STATUS') return { ok: true };
        statusCalls += 1;
        return {
          bridgeId: statusCalls === 1 ? 'before-navigation' : 'after-navigation',
          loginRequired: false,
        };
      },
    });
    const session = await transport.resolve();

    await expect(
      transport.waitAfterNavigation(session, 'before-navigation', 2_000)
    ).resolves.toMatchObject({
      kind: 'visible-tab',
      tabId: 73,
      status: { bridgeId: 'after-navigation' },
    });
  });

  it('preserves the unavailable-tab marker while navigation is being verified', async () => {
    const { sendMessage, transport } = createTransport({ tabs: [{ id: 76 }] });
    const session = await transport.resolve();
    sendMessage.mockRejectedValueOnce(new Error('No tab with id: 76'));

    await expect(
      transport.waitAfterNavigation(session, 'before-navigation', 2_000)
    ).rejects.toMatchObject({ code: 'SYSLAB_VISIBLE_TAB_UNAVAILABLE' });
  });

  it('retries a transient missing receiver while the same visible tab navigates', async () => {
    const { sendMessage, sendToOffscreen, transport } = createTransport({ tabs: [{ id: 77 }] });
    const session = await transport.resolve();
    sendMessage
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.')
      )
      .mockResolvedValueOnce({
        bridgeId: 'after-navigation',
        loginRequired: false,
      });

    await expect(
      transport.waitAfterNavigation(session, 'before-navigation', 2_000)
    ).resolves.toMatchObject({
      kind: 'visible-tab',
      tabId: 77,
      status: { bridgeId: 'after-navigation' },
    });
    expect(sendToOffscreen).not.toHaveBeenCalled();
  });

  it('preserves the receiver marker when navigation retries expire', async () => {
    const { sendMessage, transport } = createTransport({ tabs: [{ id: 78 }] });
    const session = await transport.resolve();
    sendMessage.mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.')
    );
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValue(11);

    await expect(
      transport.waitAfterNavigation(session, 'before-navigation', 10)
    ).rejects.toMatchObject({ code: 'SYSLAB_VISIBLE_RECEIVER_UNAVAILABLE' });
    now.mockRestore();
  });

  it('retries a read-only report operation offscreen when the visible tab disappears', async () => {
    const { sendMessage, sendToOffscreen, transport } = createTransport({ tabs: [{ id: 74 }] });
    const session = await transport.resolve();
    sendMessage.mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.')
    );
    sendToOffscreen.mockResolvedValueOnce({ bridgeId: 'offscreen-ready', loginRequired: false });
    sendToOffscreen.mockResolvedValueOnce({ ok: true, details: [] });

    await expect(
      transport.sendWithVisibleFallback(
        session,
        { type: 'RAYEN_SYSLAB_READ_DETAILS' },
        4_000
      )
    ).resolves.toMatchObject({ ok: true });
  });

  it('restarts a search workflow offscreen only after a definite pre-delivery failure', async () => {
    const { sendMessage, sendToOffscreen, transport } = createTransport({ tabs: [{ id: 75 }] });
    const session = await transport.resolve();
    sendMessage.mockRejectedValueOnce(new Error('No tab with id: 75'));
    sendToOffscreen.mockResolvedValueOnce({ bridgeId: 'offscreen-ready', loginRequired: false });
    sendToOffscreen.mockResolvedValueOnce({ ok: true });

    const operation = (activeSession: Record<string, unknown>) =>
      transport.send(activeSession, { type: 'RAYEN_SYSLAB_PREPARE_SEARCH' }, 4_000);

    await expect(
      transport.withVisibleFallback(session, operation, { timeoutMs: 4_000 })
    ).resolves.toMatchObject({ ok: true });
  });
});
