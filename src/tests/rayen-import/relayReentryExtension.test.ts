// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = (file: string) => readFileSync(path.resolve('extension', file), 'utf8');
const generation = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const nextGeneration = 'ffffffff-1111-4222-8333-444444444444';
const version = '0.99.1';
const relays = ['hhr', 'fichamedico', 'gestioncamas'] as const;
let publicationSequence = 0;
type Relay = (typeof relays)[number];
type Message = Record<string, unknown>;
type PageEvent = { source: unknown; origin: string; data: Message };
type RuntimeListener = (
  message: Message,
  sender: unknown,
  respond: (data: unknown) => void
) => unknown;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Separate globals model Chrome's ISOLATED context; only DOM attributes survive reload.
const createWorld = (
  relay: Relay,
  runtimeGeneration = generation,
  installedVersion = version,
  attributes = new Map<string, string>()
) => {
  const pageListeners = new Set<(event: PageEvent) => void>();
  const runtimeListeners: RuntimeListener[] = [];
  const posts: Message[] = [];
  const windowObject = {
    location: { origin: 'https://relay.test' },
    addEventListener: vi.fn((type: string, listener: (event: PageEvent) => void) => {
      if (type === 'message') pageListeners.add(listener);
    }),
    removeEventListener: (_type: string, listener: (event: PageEvent) => void) =>
      pageListeners.delete(listener),
    postMessage: (message: Message) => posts.push(message),
  };
  const sendMessage = vi.fn((message: Message, callback?: (value: unknown) => void) => {
    const response =
      message.type === 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST'
        ? { version: installedVersion, runtimeGeneration }
        : message.type === 'RAYEN_GC_DOCUMENT_READY'
          ? { connectionAttemptId: 'attempt-1' }
          : { ok: true };
    callback?.(response);
    return Promise.resolve(response);
  });
  const context = vm.createContext({
    window: windowObject,
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        getAttribute: (name: string) => attributes.get(name) ?? null,
      },
    },
    chrome: {
      runtime: {
        id: 'relay-test-extension',
        getManifest: () => ({ version: installedVersion }),
        lastError: undefined,
        sendMessage,
        onMessage: {
          addListener: (listener: RuntimeListener) => runtimeListeners.push(listener),
          removeListener: (listener?: RuntimeListener) => {
            const index = listener ? runtimeListeners.indexOf(listener) : -1;
            if (index >= 0) runtimeListeners.splice(index, 1);
          },
        },
      },
    },
    // Responses are explicitly delivered below; do not leave 45-second timers behind.
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
    console,
  });
  const inject = (dependencies = true) => {
    if (dependencies) {
      for (const file of [
        'message-contract.js',
        'bridge-generation.js',
        'health-push-ordering-runtime.js',
        'gestion-camas-bridge-health.js',
      ]) {
        vm.runInContext(source(file), context, { filename: file });
      }
    }
    vm.runInContext(source(`content-${relay}.js`), context, { filename: `content-${relay}.js` });
  };
  const dispatchPage = (data: Message) => {
    for (const listener of [...pageListeners]) {
      listener({ source: windowObject, origin: windowObject.location.origin, data });
    }
  };
  const dispatchRuntime = (data: Message) => {
    const respond = vi.fn();
    for (const listener of [...runtimeListeners]) listener(data, {}, respond);
    return respond;
  };
  const answer = (request: Message, bridgeGeneration = runtimeGeneration) =>
    dispatchPage({
      type: String(request.type).replace(/_REQUEST$/, '_RESULT'),
      reqId: request.reqId,
      injectVersion: installedVersion,
      bridgeGeneration,
      snapshot: { encounters: [] },
      results: [],
      ready: true,
    });
  return {
    inject,
    attributes,
    pageListeners,
    runtimeListeners,
    posts,
    sendMessage,
    dispatchPage,
    dispatchRuntime,
    answer,
    installedVersion,
  };
};

const exerciseForwarding = async (
  relay: Relay,
  world: ReturnType<typeof createWorld>,
  expectedGeneration = generation
) => {
  world.posts.length = 0;
  world.sendMessage.mockClear();
  if (relay === 'hhr') {
    world.dispatchPage({ type: 'HHR_RAYEN_GC_CONNECT_REQUEST', reqId: 'connect-1', renew: true });
    await flush();
    expect(world.sendMessage).toHaveBeenCalledTimes(1);
    expect(world.sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_GC_CONNECT_REQUEST',
      renew: true,
    });
    expect(world.posts).toEqual([
      { type: 'HHR_RAYEN_GC_CONNECT_RESULT', reqId: 'connect-1', ok: true, error: undefined },
    ]);
    world.posts.length = 0;
    world.dispatchRuntime({
      type: 'RAYEN_EXTENSION_HEALTH_PUSH',
      report: { ready: true },
      reason: 'test',
      publicationSequence: ++publicationSequence,
    });
    expect(world.posts).toHaveLength(1);
    const respond = world.dispatchRuntime({
      type: 'RAYEN_EXTENSION_HHR_HEALTH_PING',
      runtimeGeneration: expectedGeneration,
    });
    await flush();
    expect(respond).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ ready: true, bridgeGeneration: expectedGeneration })
    );
    return;
  }
  const respond = world.dispatchRuntime({
    type: relay === 'fichamedico' ? 'RAYEN_READ' : 'RAYEN_GC_LOOKUP',
    runs: ['test-run'],
  });
  await flush();
  expect(world.posts).toHaveLength(1);
  expect(world.posts[0]).toMatchObject({
    type: relay === 'fichamedico' ? 'RAYEN_EXT_READ_REQUEST' : 'RAYEN_GC_LOOKUP_REQUEST',
    runtimeGeneration: expectedGeneration,
  });
  world.answer(world.posts[0]);
  await flush();
  expect(respond).toHaveBeenCalledExactlyOnceWith(
    relay === 'fichamedico' ? { snapshot: { encounters: [] } } : { results: [] }
  );
  expect(world.pageListeners.size).toBe(relay === 'fichamedico' ? 0 : 1);
  if (relay === 'gestioncamas') {
    world.dispatchPage({
      type: 'RAYEN_GC_SESSION_CAPTURED',
      injectVersion: world.installedVersion,
      bridgeGeneration: expectedGeneration,
      info: { apiBase: 'https://relay.test' },
    });
    await flush();
    expect(world.sendMessage).toHaveBeenCalledTimes(1);
  }
};

describe('ISOLATED relay same-world reentry', () => {
  for (const relay of relays) {
    it(`${relay}: two injections register and forward only once before and after the handshake`, async () => {
      const world = createWorld(relay);
      world.inject();
      world.inject(); // Before the generation handshake resolves, as in an onInstalled race.
      await flush();
      expect(world.runtimeListeners).toHaveLength(1);
      expect(world.pageListeners.size).toBe(relay === 'fichamedico' ? 0 : 1);
      expect(
        world.sendMessage.mock.calls.filter(
          ([m]) => m.type === 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST'
        )
      ).toHaveLength(1);
      if (relay === 'gestioncamas') {
        expect(
          world.sendMessage.mock.calls.filter(([m]) => m.type === 'RAYEN_GC_DOCUMENT_READY')
        ).toHaveLength(1);
        expect(world.posts.filter(m => m.type === 'RAYEN_GC_CONNECTION_ATTEMPT')).toHaveLength(1);
      }
      await exerciseForwarding(relay, world);
      world.inject(); // Settled reentry must also remain inert.
      await exerciseForwarding(relay, world);
      expect(world.runtimeListeners).toHaveLength(1);
    });

    it(`${relay}: a missing contract does not poison later installation`, async () => {
      const world = createWorld(relay);
      world.inject(false);
      expect(world.runtimeListeners).toHaveLength(0);
      world.inject();
      await flush();
      expect(world.runtimeListeners).toHaveLength(1);
      await exerciseForwarding(relay, world);
    });

    for (const installedVersion of [version, '0.99.2']) {
      it(`${relay}: a fresh context restores the same runtime id with version ${installedVersion} and a new generation`, async () => {
        const oldWorld = createWorld(relay);
        oldWorld.inject();
        await flush();
        const replacement = createWorld(
          relay,
          nextGeneration,
          installedVersion,
          oldWorld.attributes
        );
        replacement.inject();
        replacement.inject();
        await flush();
        expect(replacement.runtimeListeners).toHaveLength(1);
        await exerciseForwarding(relay, replacement, nextGeneration);
      });
    }
  }

  for (const relay of ['fichamedico', 'gestioncamas'] as const) {
    it(`${relay}: reinjection still rejects stale MAIN replies and accepts the next current reply`, async () => {
      const world = createWorld(relay);
      world.inject();
      world.inject();
      await flush();
      world.posts.length = 0;
      const respond = world.dispatchRuntime({
        type: relay === 'fichamedico' ? 'RAYEN_READ' : 'RAYEN_GC_LOOKUP',
      });
      await flush();
      world.inject(); // Reentry while the request's temporary listener is active.
      expect(world.runtimeListeners).toHaveLength(1);
      world.answer(world.posts[0], nextGeneration);
      await flush();
      expect(respond).toHaveBeenCalledExactlyOnceWith({ error: expect.any(String) });
      await exerciseForwarding(relay, world);
    });
  }
});
