import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const extensionSource = (file: string) => readFileSync(path.resolve('extension', file), 'utf8');
const injectSource = extensionSource('inject-fichamedico.js');
const bridgeGenerationSource = extensionSource('bridge-generation.js');
const isolationNormalizationSource = extensionSource('fichamedico-isolation-normalization.js');
const normalizationSource = extensionSource('fichamedico-normalization.js');
const resilienceSource = extensionSource('fichamedico-read-resilience.js');
const AUTH_HEADER_FIXTURE = ['HSP', 'fixture'].join(' ');
const RUNTIME_GENERATION_FIXTURE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MAIN_WORLD_GENERATION_KEY = '__hhrExtensionRuntimeGenerationV1__';

export type PostedMessage = {
  type?: string;
  reqId?: string;
  runtimeGeneration?: string;
  ready?: boolean;
  message?: string;
  error?: string | null;
  identity?: Record<string, unknown> | null;
  info?: Record<string, unknown> | null;
  snapshot?: {
    encounters?: Array<Record<string, unknown>>;
  };
};

export const createHarness = async (
  href: string,
  role = 'Médico',
  storedNursingContexts = new Map<string, string>(),
  additionalSessionFields: Record<string, unknown> = {},
  initiallyActive = true,
  apiResolver?: (url: string) => unknown,
  sessionInterceptor?: () => Promise<void>
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
      if (String(input) === '/api/auth/session') {
        await sessionInterceptor?.();
        return sessionResponse();
      }
      if (apiResolver) {
        const value = apiResolver(String(input));
        return {
          ok: true,
          status: 200,
          json: async () => value,
        };
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    },
    addEventListener: addListener,
    dispatchEvent: (event: { type: string }) => {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
    postMessage: (message: PostedMessage) => posted.push(message),
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

  vm.runInContext(isolationNormalizationSource, context, {
    filename: 'fichamedico-isolation-normalization.js',
  });
  vm.runInContext(normalizationSource, context, { filename: 'fichamedico-normalization.js' });
  vm.runInContext(resilienceSource, context, { filename: 'fichamedico-read-resilience.js' });
  vm.runInContext(bridgeGenerationSource, context, { filename: 'bridge-generation.js' });
  vm.runInContext(injectSource, context, { filename: 'inject-fichamedico.js' });

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

  if (!sessionInterceptor) {
    await send({ type: 'RAYEN_FM_SESSION_STATUS_REQUEST', reqId: 'harness-ready' });
  }

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
