import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer synthetic' })),
}));
import { autoConnectExalab, disconnectExalab } from '@/services/laboratory/exalabService';
import { onExalabSessionAvailable } from '@/services/laboratory/exalabExtensionBridge';

const pair = 'P'.repeat(43);
type Reply = (message: { type: string; reqId: string; pair?: string }) => unknown;
/** Simulates the extension relay: answers each request on the page channel. */
const extension = (reply: Reply | null) => {
  const sent: { type: string; pair?: string }[] = [];
  vi.spyOn(window, 'postMessage').mockImplementation(data => {
    const message = data as { type: string; reqId: string; pair?: string };
    sent.push({ type: message.type, ...(message.pair ? { pair: message.pair } : {}) });
    if (!reply) return;
    const result = reply(message);
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: { type: `${message.type}_RESULT`, reqId: message.reqId, result },
        })
      )
    );
  });
  return sent;
};
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, pair })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const signal = () => new AbortController().signal;

describe('Exalab silent reconnection from HHR', () => {
  it('pairs and asks the extension to reconnect only when consent and an Exalab session exist', async () => {
    const sent = extension(message =>
      message.type === 'HHR_EXALAB_SESSION_STATUS'
        ? { permission: true, autoConnect: true, session: true }
        : { connected: true, reason: 'connected' }
    );
    await expect(autoConnectExalab(signal())).resolves.toBe('connected');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('action=pair');
    expect(sent).toEqual([
      { type: 'HHR_EXALAB_SESSION_STATUS' },
      { type: 'HHR_EXALAB_AUTO_CONNECT', pair },
    ]);
  });
  it.each([
    [{ permission: false, autoConnect: true, session: true }, 'needs_consent'],
    [{ permission: true, autoConnect: false, session: true }, 'needs_consent'],
    [{ permission: true, autoConnect: true, session: false }, 'no_session'],
    [{ permission: 'yes' }, 'unavailable'],
  ])('spends no pairing when it cannot succeed (%o → %s)', async (status, outcome) => {
    extension(() => status);
    await expect(autoConnectExalab(signal())).resolves.toBe(outcome);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('treats a silent or unknown extension answer as unavailable, never as connected', async () => {
    vi.useFakeTimers();
    extension(null);
    const pending = autoConnectExalab(signal());
    await vi.advanceTimersByTimeAsync(3100);
    await expect(pending).resolves.toBe('unavailable');
    vi.useRealTimers();
    extension(message =>
      message.type === 'HHR_EXALAB_SESSION_STATUS'
        ? { permission: true, autoConnect: true, session: true }
        : { connected: true, reason: 'everything-fine' }
    );
    await expect(autoConnectExalab(signal())).resolves.toBe('unavailable');
  });
  it('withdraws this PC’s automatic reconnection when disconnecting', async () => {
    const sent = extension(() => ({ forgotten: true }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, connected: false })));
    await disconnectExalab(signal());
    expect(sent).toContainEqual({ type: 'HHR_EXALAB_FORGET' });
  });
  it('hears only same-window session announcements', () => {
    const listener = vi.fn();
    const stop = onExalabSessionAvailable(listener);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: 'https://attacker.test',
        data: { type: 'HHR_EXALAB_SESSION_AVAILABLE' },
      })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: { type: 'HHR_EXALAB_SESSION_AVAILABLE' },
      })
    );
    stop();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: { type: 'HHR_EXALAB_SESSION_AVAILABLE' },
      })
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
