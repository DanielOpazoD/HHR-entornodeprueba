// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixture } from './gestionCamasRuntimeTestHarness';

// Real session/health/runtime owners, with only Chrome and the Rayen network mocked.
const createPopupLifecycle = () => {
  const tabs: Array<{ id: number; windowId: number }> = [];
  const fixture = createFixture({}, { tabs, fullLifecycle: true });
  const popupTab = { id: 27, windowId: 12 };
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString('base64url');
  const info = {
    token: `Bearer fixture.${payload}.signature`,
    apiBase: 'https://hospbackend.rayensalud.cl/api',
    facId: '1342',
  };
  fixture.chromeApi.windows.create.mockImplementation(async () => {
    tabs.push(popupTab);
    return { id: popupTab.windowId, tabs: [popupTab] };
  });
  fixture.chromeApi.windows.remove.mockImplementation(async () => {
    tabs.splice(0);
  });
  fixture.chromeApi.tabs.sendMessage.mockImplementation(async (_id, message) =>
    message.type === 'RAYEN_GC_SET_CONNECTION_ATTEMPT'
      ? { ok: true }
      : message.type === 'RAYEN_EXTENSION_HEALTH_PING'
        ? { ready: true, bridgeVersion: 'fixture', bridgeGeneration: 'generation' }
        : { error: 'No live credential available.' }
  );
  fixture.fetchWithTimeout.mockResolvedValue({ ok: true, status: 200 });
  const connectAndVerify = async () => {
    await expect(fixture.runtime.connect()).resolves.toMatchObject({ ok: true, reused: false });
    expect(fixture.chromeApi.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://hospitalizado.rayensalud.cl/',
        type: 'popup',
      })
    );
    expect(fixture.values['gc-pending']).toMatchObject({
      tabId: 27,
      windowId: 12,
      closeOnVerify: false,
    });
    expect(fixture.chromeApi.tabs.sendMessage).toHaveBeenCalledWith(27, {
      type: 'RAYEN_GC_SET_CONNECTION_ATTEMPT',
      connectionAttemptId: expect.any(String),
      rehydrated: false,
    });
    await expect(fixture.runtime.captureSession(info, { tab: popupTab })).resolves.toMatchObject({
      ok: true,
      connection: { status: 'stale', verification: 'pending' },
    });
    await expect(fixture.runtime.health('generation')).resolves.toMatchObject({
      status: 'ready',
      reason: 'connected',
      verification: 'fresh',
    });
    expect(fixture.fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/facility/1342/encounter'),
      { headers: { Authorization: info.token } },
      5_000
    );
    expect(fixture.values['gc-pending']).toBeUndefined();
  };
  return { ...fixture, tabs, popupTab, info, expiresAt, connectAndVerify };
};

describe('Gestión de Camas new-popup lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the verified popup alive after 450ms and still requires its live tab and relay', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.connectAndVerify();
    await vi.advanceTimersByTimeAsync(450);
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    expect(fixture.values['gc-closing']).toBeUndefined();
    expect(fixture.tabs).toEqual([fixture.popupTab]);
    await expect(fixture.runtime.health('generation')).resolves.toMatchObject({
      status: 'ready',
      verification: 'fresh',
      bridgeGeneration: 'generation',
    });
    expect(fixture.chromeApi.tabs.sendMessage).toHaveBeenCalledWith(27, {
      type: 'RAYEN_EXTENSION_HEALTH_PING',
      runtimeGeneration: 'generation',
    });
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1);

    fixture.chromeApi.tabs.sendMessage.mockResolvedValue({
      ready: false,
      reason: 'relay_disconnected',
      message: 'Relay unavailable.',
    });
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'stale',
      reason: 'relay_disconnected',
    });
    fixture.tabs.splice(0); // The user can still close the source intentionally.
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'tab_missing',
    });
    expect(fixture.values['gc-session']).toBeDefined(); // Stored credentials cannot bypass either gate.
  });

  it('blocks silent recapture after intentional disconnect even though the popup stays open', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.connectAndVerify();
    const attemptId = (fixture.values['gc-session'] as Record<string, unknown>).connectionAttemptId;
    await expect(fixture.runtime.disconnect()).resolves.toMatchObject({
      ok: true,
      connection: { status: 'missing' },
    });
    fixture.chromeApi.tabs.sendMessage.mockImplementation(async (_id, message) =>
      message.type === 'RAYEN_EXTENSION_HEALTH_PING' ? { ready: true } : { info: fixture.info }
    );
    for (const info of [fixture.info, { ...fixture.info, connectionAttemptId: attemptId }]) {
      await expect(fixture.runtime.captureSession(info, { tab: fixture.popupTab })).rejects.toThrow(
        /intento de conexión anterior/
      );
    }
    await vi.advanceTimersByTimeAsync(450);
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'session_unverified',
    });
    expect(fixture.values['gc-session']).toBeUndefined();
    expect(fixture.values['gc-pending']).toBeUndefined();
    expect(fixture.values['gc-control']).toMatchObject({ blocked: true });
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    expect(fixture.tabs).toEqual([fixture.popupTab]);
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('clears the retained popup session when re-verification receives a 401', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.connectAndVerify();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1);
    fixture.fetchWithTimeout.mockResolvedValue({ ok: false, status: 401 });
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'stale',
      reason: 'session_expired',
    });
    expect(fixture.values['gc-session']).toBeUndefined();
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    expect(fixture.tabs).toEqual([fixture.popupTab]);
  });

  it('does not keep readiness after the retained popup credential expires', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.connectAndVerify();
    await vi.advanceTimersByTimeAsync(fixture.expiresAt - Date.now() + 1);
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'session_unverified',
    });
    expect(fixture.values['gc-session']).toBeUndefined();
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    expect(fixture.tabs).toEqual([fixture.popupTab]);
  });

  it('preserves the legacy explicitly requested closeOnVerify mechanism', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.runtime.connect();
    (fixture.values['gc-pending'] as Record<string, unknown>).closeOnVerify = true;
    await fixture.runtime.captureSession(fixture.info, { tab: fixture.popupTab });
    await expect(fixture.runtime.health()).resolves.toMatchObject({ status: 'ready' });
    await vi.advanceTimersByTimeAsync(449);
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.chromeApi.windows.remove).toHaveBeenCalledWith(12);
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'tab_missing',
    });
  });
});
