/** Stable identity for this extension installation (MV3 worker/update safe). */
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

    // The generation is a non-secret routing marker, not a credential. Keep it in
    // local storage so an extension update does not have to infer it from every
    // open Rayen tab while some tabs may be temporarily unreadable.
    const remember = async record => {
      try { await chromeApi.storage.local?.set({ [STORAGE_KEY]: record }); }
      catch (_error) { /* The session copy still keeps the current worker usable. */ }
    };
    const persist = async record => {
      await chromeApi.storage.session.set({ [STORAGE_KEY]: record });
      await remember(record);
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
        .then(async stored => {
          const record = stored && stored[STORAGE_KEY];
          if (isRecord(record)) {
            await remember(record); // Migrate a running pre-update installation.
            return record;
          }
          let remembered;
          try {
            remembered = (await chromeApi.storage.local?.get(STORAGE_KEY))?.[STORAGE_KEY];
          } catch (_error) { /* Fall back to the surviving MAIN readers. */ }
          if (isRecord(remembered)) return persist(remembered);
          const recovered = await root.HhrRuntimeGenerationRecovery?.recover({ chromeApi, now });
          return persist(recovered || makeRecord());
        })
        .catch(error => {
          pending = null;
          throw error;
        });
      return pending;
    };

    // The MAIN-reader consensus is a migration path for installations predating
    // the local copy. An uninstall clears both Chrome storage areas.
    const start = () => Boolean(chromeApi.storage?.session);

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
