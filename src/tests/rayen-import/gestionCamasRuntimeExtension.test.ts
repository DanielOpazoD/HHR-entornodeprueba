// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createFixture, FINITE_SESSION_TIMESTAMP } from './gestionCamasRuntimeTestHarness';

// Deliberately unsigned, generated test data; never an actual session credential.
const sessionTokenFixture = (expiresAt: number, signature: string) => {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString('base64url');
  return ['Bearer fixture', payload, signature].join('.');
};

describe('Gestión de Camas connection runtime', () => {
  it('fails closed when its required dependencies are incomplete', () => {
    const factory = (
      globalThis as typeof globalThis & {
        HhrGestionCamasRuntime: { create: (dependencies: unknown) => unknown };
      }
    ).HhrGestionCamasRuntime;

    expect(() => factory.create({})).toThrow(/inicializar el runtime/);
  });

  it('binds an initial captured session to its source tab and rejects stale captures', async () => {
    const { runtime, values } = createFixture({}, { tabs: [{ id: 17 }] });
    const info = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
    };

    await expect(runtime.captureSession(info, { tab: { id: 17 } })).resolves.toMatchObject({
      ok: true,
      connection: { status: 'ready' },
    });
    expect(values['gc-session']).toMatchObject({
      sourceTabId: 17,
      connectionAttemptId: '',
    });
    await expect(runtime.captureSession(info, { tab: { id: 18 } })).rejects.toThrow(
      /intento de conexión anterior/
    );
  });

  it('acepta la captura adelantada al handshake desde la pestaña del intento pendiente', async () => {
    // La ventana oficial emite su bootstrap autenticado antes de recibir el id
    // del intento: la captura llega sin attemptId pero desde la pestaña del
    // intento. Debe aceptarse y adoptar el id pendiente para que la
    // verificación pueda completar el intento manteniendo la pestaña viva.
    const { runtime, values } = createFixture(
      { 'gc-pending': { tabId: 21, attemptId: 'attempt-x' } },
      { tabs: [{ id: 21 }] }
    );

    await expect(
      runtime.captureSession(
        {
          accessValue: 'bootstrap',
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
        },
        { tab: { id: 21 } }
      )
    ).resolves.toMatchObject({ ok: true });
    expect(values['gc-session']).toMatchObject({
      sourceTabId: 21,
      connectionAttemptId: 'attempt-x',
    });

    // Desde OTRA pestaña, la captura sin attemptId sigue rechazada mientras
    // el intento pendiente está vivo.
    const other = createFixture(
      { 'gc-pending': { tabId: 21, attemptId: 'attempt-x' } },
      { tabs: [{ id: 21 }, { id: 22 }] }
    );
    await expect(
      other.runtime.captureSession(
        {
          accessValue: 'ajena',
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
        },
        { tab: { id: 22 } }
      )
    ).rejects.toThrow(/intento de conexión anterior/);
  });

  it('adopta la captura de una pestaña viva cuando la sesión vigente quedó huérfana', async () => {
    // La pestaña 17 (dueña de la sesión) ya no existe; la 18 está viva y
    // autenticada. La sesión huérfana no debe exigir reconexión manual.
    const { runtime, values } = createFixture(
      {
        'gc-session': {
          accessValue: 'huérfana',
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
          sourceTabId: 17,
          connectionAttemptId: '',
        },
      },
      { tabs: [{ id: 18 }] }
    );

    await expect(
      runtime.captureSession(
        {
          accessValue: 'viva',
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
        },
        { tab: { id: 18 } }
      )
    ).resolves.toMatchObject({ ok: true, connection: { status: 'ready' } });
    expect(values['gc-session']).toMatchObject({ accessValue: 'viva', sourceTabId: 18 });
  });

  it('forgets the temporary session and blocks silent recapture on disconnect', async () => {
    const { runtime, values, storage } = createFixture({
      'gc-session': { accessValue: 'fixture', apiBase: 'api', facId: '1342' },
      'gc-pending': { tabId: 4, attemptId: 'attempt' },
    });

    await expect(runtime.disconnect()).resolves.toMatchObject({
      ok: true,
      connection: { status: 'missing' },
    });
    expect(values['gc-session']).toBeUndefined();
    expect(values['gc-pending']).toBeUndefined();
    expect(values['gc-control']).toMatchObject({ blocked: true });
    expect(storage.remove).toHaveBeenCalledWith(['gc-session', 'gc-pending']);
  });

  it('keeps a fresh verified session without making another network probe', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: '',
      lastVerifiedAt: FINITE_SESSION_TIMESTAMP,
    };
    const { runtime, fetchWithTimeout } = createFixture({ 'gc-session': record });

    await expect(runtime.health()).resolves.toMatchObject({
      status: 'ready',
      connected: true,
    });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('scopes clean-repair health and the stored session to the exact new Gestión de Camas tab', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 8,
      connectionAttemptId: '',
      lastVerifiedAt: FINITE_SESSION_TIMESTAMP,
    };
    const { runtime, probeTabs } = createFixture(
      { 'gc-session': record },
      { tabs: [{ id: 7 }, { id: 8 }] }
    );

    await expect(runtime.health('generation', [8])).resolves.toMatchObject({ status: 'ready' });
    expect(probeTabs.mock.calls[0]?.[0]).toMatchObject({ tabs: [{ id: 8 }] });
  });

  it('does not report a stored session as ready after its source tab was closed', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: '',
      lastVerifiedAt: FINITE_SESSION_TIMESTAMP,
    };
    const { runtime } = createFixture({ 'gc-session': record }, { tabs: [] });

    await expect(runtime.health()).resolves.toMatchObject({
      status: 'missing',
      message: 'Abre Gestión de Camas.',
    });

    // Con una pestaña de reemplazo abierta, el health intenta adoptar su sesión
    // en vivo; si el relé no entrega credencial, queda stale (no ready).
    const replacementTab = createFixture({ 'gc-session': record }, { tabs: [{ id: 8 }] });
    await expect(replacementTab.runtime.health()).resolves.toMatchObject({
      status: 'stale',
    });
  });

  it('el health adopta en vivo la sesión de una pestaña de reemplazo autenticada', async () => {
    const record = {
      accessValue: 'huérfana',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: '',
      lastVerifiedAt: FINITE_SESSION_TIMESTAMP,
    };
    const fixture = createFixture({ 'gc-session': record }, { tabs: [{ id: 8 }] });
    // La pestaña viva entrega su credencial al relé y el probe la verifica.
    fixture.chromeApi.tabs.sendMessage.mockImplementation(
      async (...args: unknown[]): Promise<never> =>
        ((args[1] as { type?: string } | undefined)?.type === 'RAYEN_GC_GET_FETCH_INFO'
          ? {
              info: {
                accessValue: 'viva',
                apiBase: 'https://hospbackend.rayensalud.cl/api',
                facId: '1342',
              },
            }
          : { ready: true, message: 'Pestaña disponible.' }) as never
    );
    fixture.fetchWithTimeout.mockResolvedValue({ ok: true });

    await expect(fixture.runtime.health()).resolves.toMatchObject({ status: 'ready' });
    expect(fixture.values['gc-session']).toMatchObject({ accessValue: 'viva', sourceTabId: 8 });
  });

  it('preflights multiple tabs and requests credentials only from a healthy relay', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = sessionTokenFixture(expiresAt, 'healthy');
    const fixture = createFixture({}, { tabs: [{ id: 7 }, { id: 8 }], fullLifecycle: true });
    fixture.chromeApi.tabs.sendMessage.mockImplementation(async (tabId, message) => {
      if (message.type === 'RAYEN_EXTENSION_HEALTH_PING') {
        if (tabId === 7) throw new Error('relay obsoleto');
        return { ready: true };
      }
      return {
        info: {
          token,
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
        },
      };
    });
    fixture.fetchWithTimeout.mockResolvedValue({ ok: true });

    await expect(fixture.runtime.health()).resolves.toMatchObject({ status: 'ready' });
    expect(
      fixture.chromeApi.tabs.sendMessage.mock.calls
        .filter(([, message]) => message.type === 'RAYEN_EXTENSION_HEALTH_PING')
        .map(([tabId]) => tabId)
    ).toEqual([7, 8]);
    expect(
      fixture.chromeApi.tabs.sendMessage.mock.calls.filter(
        ([, message]) => message.type === 'RAYEN_GC_GET_FETCH_INFO'
      )
    ).toEqual([[8, { type: 'RAYEN_GC_GET_FETCH_INFO', connectionAttemptId: '' }]]);
  });

  it('recaptures and verifies a renewed token from the same tab after a 401', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = (suffix: string) => sessionTokenFixture(expiresAt, suffix);
    const record = {
      token: token('old'),
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: '',
      lastVerifiedAt: null,
      expiresAt,
      identity: {},
    };
    const fixture = createFixture(
      { 'gc-session': record },
      { tabs: [{ id: 7 }], fullLifecycle: true }
    );
    fixture.chromeApi.tabs.sendMessage.mockImplementation(async (_tabId, message) =>
      message.type === 'RAYEN_EXTENSION_HEALTH_PING'
        ? { ready: true }
        : {
            info: {
              token: token('renewed'),
              apiBase: record.apiBase,
              facId: record.facId,
            },
          }
    );
    fixture.fetchWithTimeout
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'ready',
      verification: 'fresh',
    });
    expect(
      fixture.chromeApi.tabs.sendMessage.mock.calls.filter(
        ([, message]) => message.type === 'RAYEN_EXTENSION_HEALTH_PING'
      )
    ).toHaveLength(1);
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(fixture.values['gc-session']).toMatchObject({ token: token('renewed'), sourceTabId: 7 });
  });

  it.each([200, 401])(
    'revalidates a renewed token when the old in-flight probe returns %i',
    async status => {
      const expiresAt = Date.now() + 60 * 60 * 1000;
      const oldToken = sessionTokenFixture(expiresAt, 'old');
      const newToken = sessionTokenFixture(expiresAt, 'new');
      const record = {
        token: oldToken,
        apiBase: 'https://hospbackend.rayensalud.cl/api',
        facId: '1342',
        sourceTabId: 7,
        connectionAttemptId: '',
        lastVerifiedAt: null,
        expiresAt,
        identity: {},
      };
      const fixture = createFixture(
        { 'gc-session': record },
        { tabs: [{ id: 7 }], fullLifecycle: true }
      );
      fixture.chromeApi.tabs.sendMessage.mockResolvedValue({ ready: true });
      let finishOldVerification!: (response: { ok: boolean; status: number }) => void;
      fixture.fetchWithTimeout
        .mockImplementationOnce(
          () =>
            new Promise(resolve => {
              finishOldVerification = resolve;
            })
        )
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const health = fixture.runtime.health();
      await vi.waitFor(() => expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1));
      await fixture.runtime.captureSession(
        { token: newToken, apiBase: record.apiBase, facId: record.facId },
        { tab: { id: 7 } }
      );
      finishOldVerification({ ok: status === 200, status });

      await expect(health).resolves.toMatchObject({ status: 'ready', verification: 'fresh' });
      expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(2);
      expect(fixture.values['gc-session']).toMatchObject({ token: newToken, sourceTabId: 7 });
    }
  );

  it('does not invalidate verification when the same tab recaptures the identical token', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const token = sessionTokenFixture(expiresAt, 'same');
    const record = {
      token,
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: '',
      lastVerifiedAt: null,
      expiresAt,
      identity: {},
    };
    const fixture = createFixture(
      { 'gc-session': record },
      { tabs: [{ id: 7 }], fullLifecycle: true }
    );
    fixture.chromeApi.tabs.sendMessage.mockResolvedValue({ ready: true });
    let finishVerification!: (response: { ok: boolean; status: number }) => void;
    fixture.fetchWithTimeout.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishVerification = resolve;
        })
    );

    const health = fixture.runtime.health();
    await vi.waitFor(() => expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1));
    await fixture.runtime.captureSession(
      { token, apiBase: record.apiBase, facId: record.facId },
      { tab: { id: 7 } }
    );
    finishVerification({ ok: true, status: 200 });

    await expect(health).resolves.toMatchObject({ status: 'ready', verification: 'fresh' });
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not call a missing capture an expired session without a Rayen rejection', async () => {
    const { runtime } = createFixture({}, { tabs: [{ id: 8 }] });

    await expect(runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'session_unverified',
    });
  });

  it('reports session_expired only after Rayen returns unauthorized', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: 'current',
      lastVerifiedAt: null,
    };
    const { runtime, fetchWithTimeout } = createFixture({ 'gc-session': record });
    fetchWithTimeout.mockResolvedValue({ ok: false, status: 401 });

    await expect(runtime.health()).resolves.toMatchObject({
      status: 'stale',
      reason: 'session_expired',
    });
  });

  it('clears only the matching session when Rayen returns an unauthorized response', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: 'current',
    };
    const { runtime, values } = createFixture({ 'gc-session': record });

    await expect(runtime.classifyRejection({ status: 401 }, record)).resolves.toBe('expired');
    expect(values['gc-session']).toBeUndefined();
  });
});
