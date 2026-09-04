/** Stable identity for one loaded extension lifecycle (MV3 service-worker safe). */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'hhrRuntimeGenerationV1';
  const MAIN_WORLD_GENERATION_KEY = '__hhrExtensionRuntimeGenerationV1__';
  const installMainWorldGeneration = generation => {
    const key = '__hhrExtensionRuntimeGenerationV1__';
    const existing = Object.getOwnPropertyDescriptor(globalThis, key);
    if (existing) return existing.value === generation;
    Object.defineProperty(globalThis, key, {
      value: generation,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return true;
  };

  const create = ({ chromeApi, cryptoApi = root.crypto, now = () => Date.now() }) => {
    let pending = null;

    const makeRecord = () => ({
      id: cryptoApi.randomUUID(),
      createdAt: now(),
    });

    const isRecord = value => Boolean(
      value &&
      typeof value.id === 'string' &&
      /^[a-f0-9-]{20,}$/i.test(value.id) &&
      Number.isFinite(value.createdAt)
    );

    const persist = async record => {
      await chromeApi.storage.session.set({ [STORAGE_KEY]: record });
      return record;
    };

    const rotate = () => {
      pending = persist(makeRecord()).catch(error => {
        pending = null;
        throw error;
      });
      return pending;
    };

    const get = () => {
      if (pending) return pending;
      pending = chromeApi.storage.session.get(STORAGE_KEY)
        .then(stored => {
          const record = stored && stored[STORAGE_KEY];
          return isRecord(record) ? record : persist(makeRecord());
        })
        .catch(error => {
          pending = null;
          throw error;
        });
      return pending;
    };

    const start = () => {
      if (!chromeApi.runtime?.onInstalled) return false;
      // Registration happens before relay reinjection. rotate() assigns its promise
      // synchronously, so newly injected relays cannot observe the previous lifecycle.
      chromeApi.runtime.onInstalled.addListener(() => void rotate());
      return true;
    };

    const getContext = version => get().then(generation => ({
      version,
      runtimeGeneration: generation.id,
      runtimeStartedAt: generation.createdAt,
    }));

    const bindMainWorld = async (sender, generation) => {
      const tabId = Number(sender && sender.tab && sender.tab.id);
      const url = String(sender && (sender.url || sender.tab && sender.tab.url) || '');
      if (!Number.isInteger(tabId) || !/^https:\/\/(fichamedico|hospitalizado)\.rayensalud\.cl\//.test(url)) {
        return false;
      }
      const frameId = Number.isInteger(sender && sender.frameId) ? sender.frameId : 0;
      const results = await chromeApi.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: 'MAIN',
        func: installMainWorldGeneration,
        args: [generation],
      });
      return Array.isArray(results) && results.some(result => result && result.result === true);
    };

    const getContextForSender = async (version, sender) => {
      const context = await getContext(version);
      try {
        await bindMainWorld(sender, context.runtimeGeneration);
      } catch (_error) {
        // A navigation race leaves this document unbound and therefore fail-closed as outdated.
      }
      return context;
    };

    return Object.freeze({ bindMainWorld, get, getContext, getContextForSender, rotate, start });
  };

  root.HhrRuntimeGeneration = Object.freeze({
    create,
    installMainWorldGeneration,
    MAIN_WORLD_GENERATION_KEY,
    STORAGE_KEY,
  });
})(typeof self !== 'undefined' ? self : globalThis);
