// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/**
 * Lectura del censo desde la pestaña de Ficha Médico ante un fallo de red
 * (visto en vivo el 02-09: pestaña abierta toda la noche, salud «lista» por
 * la sesión same-origin, y cada lectura cross-origin muriendo con «Failed to
 * fetch» hasta recargar la pestaña). El MAIN world debe: (1) reintentar UNA
 * vez re-anclado al origen por defecto, (2) si vuelve a fallar, dejar de
 * declararse listo hasta que una lectura funcione, y (3) decir qué endpoint
 * falló.
 */

const injectSource = readFileSync(path.resolve('extension/inject-fichamedico.js'), 'utf8');
const isolationNormalizationSource = readFileSync(
  path.resolve('extension/fichamedico-isolation-normalization.js'),
  'utf8'
);
const normalizationSource = readFileSync(
  path.resolve('extension/fichamedico-normalization.js'),
  'utf8'
);
const resilienceSource = readFileSync(
  path.resolve('extension/fichamedico-read-resilience.js'),
  'utf8'
);
const AUTH_HEADER_FIXTURE = ['HSP', 'fixture'].join(' ');
const LIST_PATH = '/encounter/list/filter';

type PostedMessage = {
  type?: string;
  reqId?: string;
  ready?: boolean;
  message?: string;
  error?: string | null;
  snapshot?: { encounters?: Array<Record<string, unknown>> };
};

const createHarness = async (apiResolver: (url: string) => unknown) => {
  const listeners = new Map<string, Array<(event: unknown) => unknown>>();
  const posted: PostedMessage[] = [];
  const addListener = (type: string, listener: (event: unknown) => unknown) => {
    const current = listeners.get(type) || [];
    current.push(listener);
    listeners.set(type, current);
  };
  const location = new URL('https://fichamedico.rayensalud.cl/dashboard/encounter-list');
  const windowObject = {
    location: { href: location.href, origin: location.origin, pathname: location.pathname },
    fetch: async (input: unknown) => {
      if (String(input) === '/api/auth/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            session: {
              ...{ [['to', 'ken'].join('')]: AUTH_HEADER_FIXTURE },
              facilityId: 1342,
              healthCarePractitionerId: 7936,
              healthCarePractitionerRoleId: 2,
              role: 'Médico',
              fullName: 'Profesional Prueba',
            },
          }),
        };
      }
      const value = apiResolver(String(input)) as { __httpStatus?: number } | unknown;
      // Respuesta HTTP no-ok (a diferencia de un fetch rechazado): el marcador la simula.
      const httpStatus = (value as { __httpStatus?: number } | null)?.__httpStatus;
      if (typeof httpStatus === 'number') {
        return { ok: false, status: httpStatus, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => value };
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
    sessionStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    document: { hidden: false, addEventListener: addListener },
    history: { pushState: () => undefined, replaceState: () => undefined },
    XMLHttpRequest: XMLHttpRequestMock,
    CustomEvent: class CustomEventMock {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  });
  vm.runInContext(isolationNormalizationSource, context, {
    filename: 'fichamedico-isolation-normalization.js',
  });
  vm.runInContext(normalizationSource, context, { filename: 'fichamedico-normalization.js' });
  vm.runInContext(resilienceSource, context, { filename: 'fichamedico-read-resilience.js' });
  vm.runInContext(injectSource, context, { filename: 'inject-fichamedico.js' });
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();

  const send = async (data: PostedMessage) => {
    const callbacks = listeners.get('message') || [];
    await Promise.all(callbacks.map(callback => callback({ source: windowObject, data })));
    return posted.findLast(message => message.reqId === data.reqId);
  };
  /**
   * Simula tráfico propio de la página: la extensión captura la URL de lista y
   * el token al interceptar `window.fetch`. La respuesta de esa petición no
   * importa (puede fallar): la captura ocurre antes.
   */
  const captureListTraffic = async (listUrl: string) => {
    await (
      vm.runInContext(
        `window.fetch(${JSON.stringify(listUrl)}, { headers: { Authorization: ${JSON.stringify(
          AUTH_HEADER_FIXTURE
        )} } })`,
        context
      ) as Promise<unknown>
    ).catch(() => undefined);
  };
  return { send, captureListTraffic };
};

const STALE_LIST_URL =
  'https://fichamedicoback.rayensalud.cl/encounter/list/filter?facilityId=1342&healthCarePractitionerId=7936&healthCarePractitionerRoleId=2&stale=1';

const networkFailure = () => new TypeError('Failed to fetch');

const clinicalResolver =
  (listBehavior: (url: URL) => unknown) =>
  (url: string): unknown => {
    const parsed = new URL(url);
    if (parsed.pathname === LIST_PATH) return listBehavior(parsed);
    if (parsed.pathname.includes('/patientHeaderData/')) {
      return { preferredIdentifierCode: '17.764.680-6', firstGivenName: 'Jennifer' };
    }
    if (parsed.pathname.includes('/diagnosisEntry/')) return [];
    if (parsed.pathname.includes('/physician')) return [];
    return [];
  };

describe('Ficha Médico · lectura ante fallo de red', () => {
  it('reintenta una vez re-anclado al origen por defecto cuando la lista capturada falla en red', async () => {
    const requested: string[] = [];
    const harness = await createHarness(
      clinicalResolver(url => {
        requested.push(url.toString());
        if (url.searchParams.get('stale') === '1') throw networkFailure();
        return url.searchParams.get('filterType') === '3'
          ? [{ id: 142070, patientName: 'Jennifer Lopez' }]
          : [];
      })
    );
    await harness.captureListTraffic(STALE_LIST_URL);

    const response = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'heal' });

    expect(response?.error).toBeUndefined();
    expect(response?.snapshot?.encounters?.[0]).toMatchObject({ encounterId: '142070' });
    expect(requested.some(url => url.includes('stale=1'))).toBe(true);
    expect(requested.some(url => !url.includes('stale=1') && url.includes('filterType=3'))).toBe(
      true
    );

    const health = await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'h1' });
    expect(health?.ready).toBe(true);
  });

  it('si el reintento también falla, nombra el endpoint y deja de declararse listo hasta que una lectura funcione', async () => {
    let failing = true;
    const harness = await createHarness(
      clinicalResolver(url => {
        if (failing) throw networkFailure();
        return url.searchParams.get('filterType') === '3'
          ? [{ id: 142070, patientName: 'Jennifer Lopez' }]
          : [];
      })
    );

    const failed = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'fail' });
    expect(failed?.error).toContain('Failed to fetch');
    expect(failed?.error).toContain('al consultar https://fichamedicoback.rayensalud.cl');

    const blocked = await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'h2' });
    expect(blocked?.ready).toBe(false);
    expect(blocked?.message).toContain('Recarga la pestaña');

    failing = false;
    const recovered = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'ok' });
    expect(recovered?.error).toBeUndefined();
    const healthy = await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'h3' });
    expect(healthy?.ready).toBe(true);
  });

  it('un error HTTP no es un fallo de red: no reintenta ni bloquea la salud', async () => {
    // Una lectura pide la lista activa (filterType=3) y los egresos (filterType=2);
    // se cuenta solo la activa, que es la que decide el reintento.
    let activeListCalls = 0;
    const harness = await createHarness(
      clinicalResolver(url => {
        if (url.searchParams.get('filterType') === '3') activeListCalls += 1;
        // Respuesta HTTP 500 real (ok:false), no un fetch rechazado.
        return { __httpStatus: 500 };
      })
    );

    const failed = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'http' });
    expect(failed?.error).toContain(
      '500 en https://fichamedicoback.rayensalud.cl/encounter/list/filter'
    );
    expect(activeListCalls).toBe(1);

    const health = await harness.send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'h4' });
    expect(health?.ready).toBe(true);
  });
});
