import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const injectSource = readFileSync(path.resolve('extension/inject-fichamedico.js'), 'utf8');
const bridgeGenerationSource = readFileSync(
  path.resolve('extension/bridge-generation-main.js'),
  'utf8'
);
const connectionRecoverySource = readFileSync(
  path.resolve('extension/connection-relay-recovery.js'),
  'utf8'
);
const isolationNormalizationSource = readFileSync(
  path.resolve('extension/fichamedico-isolation-normalization.js'),
  'utf8'
);
const diagnosisCodingSource = readFileSync(
  path.resolve('extension/fichamedico-diagnosis-coding.js'),
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
const censusSource = readFileSync(path.resolve('extension/fichamedico-census-runtime.js'), 'utf8');
const AUTH_HEADER_FIXTURE = ['HSP', 'fixture'].join(' ');
export const LIST_PATH = '/encounter/list/filter';
const RUNTIME_GENERATION_FIXTURE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MAIN_WORLD_GENERATION_KEY = '__hhrExtensionRuntimeGenerationV1__';

type PostedMessage = {
  type?: string;
  reqId?: string;
  runtimeGeneration?: string;
  ready?: boolean;
  mainReady?: boolean;
  message?: string;
  error?: string | null;
  snapshot?: {
    encounters?: Array<Record<string, unknown>>;
    isComplete?: boolean;
    clinicalCoverage?: Record<string, number>;
    capturePhasesMs?: Record<string, number>;
  };
};

export const createFichamedicoReadHarness = async (apiResolver: (url: string) => unknown) => {
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
    removeEventListener: (type: string, listener: (event: unknown) => unknown) => {
      const current = listeners.get(type) || [];
      listeners.set(
        type,
        current.filter(candidate => candidate !== listener)
      );
    },
    dispatchEvent: (event: { type: string }) => {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
    postMessage: (message: PostedMessage) => {
      posted.push(message);
      queueMicrotask(() => {
        for (const listener of listeners.get('message') || []) {
          void listener({
            source: windowObject,
            origin: windowObject.location.origin,
            data: message,
          });
        }
      });
    },
  };
  Object.defineProperty(windowObject, MAIN_WORLD_GENERATION_KEY, {
    value: RUNTIME_GENERATION_FIXTURE,
    configurable: false,
    writable: false,
  });
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
  vm.runInContext(diagnosisCodingSource, context, { filename: 'fichamedico-diagnosis-coding.js' });
  vm.runInContext(normalizationSource, context, { filename: 'fichamedico-normalization.js' });
  vm.runInContext(resilienceSource, context, { filename: 'fichamedico-read-resilience.js' });
  vm.runInContext(
    readFileSync(path.resolve('extension/fichamedico-capture-cache.js'), 'utf8'),
    context,
    { filename: 'fichamedico-capture-cache.js' }
  );
  vm.runInContext(censusSource, context, { filename: 'fichamedico-census-runtime.js' });
  vm.runInContext(bridgeGenerationSource, context, { filename: 'bridge-generation-main.js' });
  vm.runInContext(connectionRecoverySource, context, {
    filename: 'connection-relay-recovery.js',
  });
  vm.runInContext(injectSource, context, { filename: 'inject-fichamedico.js' });
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
  const wrappedFetch = windowObject.fetch;

  const send = async (data: PostedMessage) => {
    const request = { runtimeGeneration: RUNTIME_GENERATION_FIXTURE, ...data };
    const callbacks = listeners.get('message') || [];
    await Promise.all(
      callbacks.map(callback =>
        callback({ source: windowObject, origin: windowObject.location.origin, data: request })
      )
    );
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
  return {
    send,
    captureListTraffic,
    disconnectBridge: () => listeners.set('message', []),
    disconnectReader: () =>
      listeners.set(
        'message',
        (listeners.get('message') || []).filter(listener => listener.name !== 'onBridgeMessage')
      ),
    reinject: () => vm.runInContext(injectSource, context, { filename: 'inject-fichamedico.js' }),
    messageListenerCount: () => (listeners.get('message') || []).length,
    fetchWasNotWrappedAgain: () => windowObject.fetch === wrappedFetch,
  };
};
