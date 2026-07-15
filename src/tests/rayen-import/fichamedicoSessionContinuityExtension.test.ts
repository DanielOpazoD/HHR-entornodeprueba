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
    identityVerified?: boolean;
  } | null;
};

const createHarness = async (href: string, role = 'Médico') => {
  const listeners = new Map<string, Array<(event: unknown) => unknown>>();
  const posted: PostedMessage[] = [];
  let sessionActive = true;
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
            },
          }),
        }
      : {
          ok: false,
          status: 401,
          json: async () => ({ ok: false }),
        };

  const windowObject = {
    location: { href: location.href, origin: location.origin },
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
      identityVerified: true,
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
