// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const injectSource = readFileSync(path.resolve('extension/inject-fichamedico.js'), 'utf8');
const AUTH_HEADER_FIXTURE = ['HSP', 'fixture'].join(' ');

type PostedMessage = {
  type?: string;
  reqId?: string;
  ready?: boolean;
  message?: string;
  error?: string | null;
  info?: {
    apiOrigin?: string;
    listUrl?: string;
    listSource?: string;
    facId?: string;
    practitionerId?: string;
    practitionerRoleId?: string;
    isNursing?: boolean;
    identityVerified?: boolean;
  } | null;
};

const createHarness = async (
  href: string,
  role = 'Médico',
  storedNursingContexts = new Map<string, string>(),
  additionalSessionFields: Record<string, unknown> = {},
  initiallyActive = true
) => {
  const listeners = new Map<string, Array<(event: unknown) => unknown>>();
  const posted: PostedMessage[] = [];
  let sessionActive = initiallyActive;
  const location = new URL(href);

  const addListener = (type: string, listener: (event: unknown) => unknown) => {
    const current = listeners.get(type) || [];
    current.push(listener);
    listeners.set(type, current);
  };

  const sessionResponse = async () =>
    sessionActive
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            session: {
              ...{ [['to', 'ken'].join('')]: AUTH_HEADER_FIXTURE },
              facilityId: 1342,
              healthCarePractitionerId: 7936,
              healthCarePractitionerRoleId: 2,
              role,
              fullName: 'Profesional Prueba',
              ...additionalSessionFields,
            },
          }),
        }
      : {
          ok: false,
          status: 401,
          json: async () => ({ ok: false }),
        };

  const sessionStorage = {
    getItem: (key: string) => storedNursingContexts.get(key) ?? null,
    setItem: (key: string, value: string) => storedNursingContexts.set(key, value),
    removeItem: (key: string) => storedNursingContexts.delete(key),
  };

  const windowObject = {
    location: { href: location.href, origin: location.origin, pathname: location.pathname },
    fetch: async (input: unknown) => {
      if (String(input) === '/api/auth/session') return sessionResponse();
      throw new Error(`Unexpected request: ${String(input)}`);
    },
    addEventListener: addListener,
    dispatchEvent: (event: { type: string }) => {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
    postMessage: (message: PostedMessage) => posted.push(message),
  };

  function XMLHttpRequestMock() {}
  XMLHttpRequestMock.prototype.open = () => undefined;
  XMLHttpRequestMock.prototype.setRequestHeader = () => undefined;

  const context = vm.createContext({
    console,
    URL,
    Headers,
    setTimeout,
    clearTimeout,
    window: windowObject,
    sessionStorage,
    document: {
      hidden: false,
      addEventListener: addListener,
    },
    history: {
      pushState: () => undefined,
      replaceState: () => undefined,
    },
    XMLHttpRequest: XMLHttpRequestMock,
    CustomEvent: class CustomEventMock {
      type: string;

      constructor(type: string) {
        this.type = type;
      }
    },
  });

  vm.runInContext(injectSource, context, { filename: 'inject-fichamedico.js' });
  await Promise.resolve();
  await Promise.resolve();

  const send = async (data: PostedMessage) => {
    const callbacks = listeners.get('message') || [];
    await Promise.all(callbacks.map(callback => callback({ source: windowObject, data })));
    return posted.findLast(message => message.reqId === data.reqId);
  };

  return {
    activateSession: () => {
      sessionActive = true;
    },
    expireSession: () => {
      sessionActive = false;
    },
    send,
  };
};

describe('Ficha Medico session continuity', () => {
  it.each([
    'https://fichamedico.rayensalud.cl/dashboard/encounter-list',
    'https://fichamedico.rayensalud.cl/dashboard/care-plan-execute',
    'https://fichamedico.rayensalud.cl/dashboard/reports',
  ])('rebuilds a verified clinical context from the live Eloisa session on %s', async href => {
    const harness = await createHarness(href);
    const response = await harness.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'context' });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      apiOrigin: 'https://fichamedicoback.rayensalud.cl',
      facId: '1342',
      practitionerId: '7936',
      practitionerRoleId: '2',
      identityVerified: true,
    });
    const listUrl = new URL(String(response?.info?.listUrl));
    expect(listUrl.pathname).toBe('/encounter/list/filter');
    expect(listUrl.searchParams.get('facilityId')).toBe('1342');
    expect(listUrl.searchParams.get('healthCarePractitionerId')).toBe('7936');
    expect(listUrl.searchParams.get('healthCarePractitionerRoleId')).toBe('2');
  });

  it('keeps nursing worklists available outside the medical encounter list', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      'Enfermera(o)'
    );
    const response = await harness.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'nursing' });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      apiOrigin: 'https://fichamedicoback.rayensalud.cl',
      listUrl: '',
      listSource: 'nursing',
      isNursing: true,
      identityVerified: true,
    });
  });

  it.each(['', 'Médico'])(
    'treats the nursing route as authoritative when the session role label is %j',
    async role => {
      const harness = await createHarness(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
        role
      );
      const response = await harness.send({
        type: 'RAYEN_FM_FETCHINFO_REQUEST',
        reqId: 'route-nursing',
      });

      expect(response?.error).toBeNull();
      expect(response?.info).toMatchObject({
        listUrl: '',
        listSource: 'nursing',
        isNursing: true,
      });
    }
  );

  it('keeps the observed nursing context across full route reloads in the same tab session', async () => {
    const storedNursingContexts = new Map<string, string>();
    const nursingRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      '',
      storedNursingContexts
    );
    await nursingRoute.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'nursing-route' });

    const reportsRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/reports',
      '',
      storedNursingContexts
    );
    const response = await reportsRoute.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'reports-route',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listUrl: '',
      listSource: 'nursing',
      isNursing: true,
    });
  });

  it('clears the observed nursing context on the authoritative medical list', async () => {
    const storedNursingContexts = new Map<string, string>();
    const nursingRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      '',
      storedNursingContexts
    );
    await nursingRoute.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'nursing-first' });

    const medicalRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list',
      '',
      storedNursingContexts
    );
    const response = await medicalRoute.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'medical-list',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listSource: 'medical',
      isNursing: false,
    });
  });

  it('does not keep a medical session in nursing mode after leaving the nursing route', async () => {
    const storedNursingContexts = new Map<string, string>();
    const nursingRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      'Médico',
      storedNursingContexts
    );
    await nursingRoute.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'medical-nursing-route' });

    const reportsRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/reports',
      'Médico',
      storedNursingContexts
    );
    const response = await reportsRoute.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'medical-reports',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listSource: 'medical',
      isNursing: false,
    });
  });

  it('recognizes the alternate nursing role label outside the nursing list', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/reports',
      '',
      new Map(),
      { healthCarePractitionerRoleName: 'Enfermera(o)' }
    );
    const response = await harness.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'alternate-role-label',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listUrl: '',
      listSource: 'nursing',
      isNursing: true,
    });
  });

  it('clears a persisted nursing context when a fresh document finds an expired session', async () => {
    const storedNursingContexts = new Map<string, string>();
    const nursingRoute = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse?tab=0',
      '',
      storedNursingContexts
    );
    await nursingRoute.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'prime-nursing' });

    const reportsAfterLogout = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/reports',
      '',
      storedNursingContexts,
      {},
      false
    );
    reportsAfterLogout.activateSession();
    const response = await reportsAfterLogout.send({
      type: 'RAYEN_FM_FETCHINFO_REQUEST',
      reqId: 'new-session',
    });

    expect(response?.error).toBeNull();
    expect(response?.info).toMatchObject({
      listSource: 'medical',
      isNursing: false,
    });
  });

  it('keeps the binding only while Eloisa reports an active session', async () => {
    const harness = await createHarness(
      'https://fichamedico.rayensalud.cl/dashboard/care-plan-execute'
    );

    await expect(
      harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'active' })
    ).resolves.toMatchObject({ ready: true, message: expect.stringContaining('vigente') });

    harness.expireSession();

    await expect(
      harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'expired' })
    ).resolves.toMatchObject({
      ready: false,
      message: expect.stringContaining('no está disponible'),
    });
    await expect(
      harness.send({ type: 'RAYEN_FM_FETCHINFO_REQUEST', reqId: 'after-expiry' })
    ).resolves.toMatchObject({ info: null, error: expect.stringContaining('no está disponible') });
  });
});
