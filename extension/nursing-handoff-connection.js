(() => {
  'use strict';
  const productionOrigin = 'https://hhr-hospitalizados.app';
  // The public package uses a fixed Chrome ID accepted by the HHR gateway.
  const registration = globalThis.HhrNursingHandoffDevice ??
    (globalThis.chrome?.runtime?.getManifest?.()?.key
      ? { origin: productionOrigin, endpoint: productionOrigin + '/api/entrega-turno-equipo' }
      : null);
  const origin = registration?.origin ?? productionOrigin;
  const portal = origin + '/conectar-entrega-turno';
  const deviceKey = 'hhr-nursing-handoff-device';
  const accessKey = 'hhr-nursing-handoff-access';
  const pendingKey = 'hhr-nursing-handoff-connecting';
  const project = registration?.endpoint ?? (origin + '/api/entrega-turno');
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const isHhr = value => {
    try { return new URL(value).origin === origin; } catch { return false; }
  };

  function registeredStore() {
    const db = new Promise((resolve, reject) => {
      const request = indexedDB.open('hhr-handoff-registration', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('accounts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const call = async (mode, operation) => {
      const transaction = (await db).transaction('accounts', mode);
      return new Promise((resolve, reject) => {
        const request = operation(transaction.objectStore('accounts'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
    };
    return {
      get: owner => call('readonly', items => items.get(owner)),
      set: (owner, value) => call('readwrite', items => items.put(value, owner)),
      remove: owner => call('readwrite', items => items.delete(owner)),
    };
  }

  function create(chrome, onAuthorized, { checkRegistered, persistent } = {}) {
    const registered = registration && (persistent ?? registeredStore());
    const store = chrome.storage.session;
    const get = async key => (await store.get(key))[key];
    let opening;
    let accessChange = Promise.resolve();
    const changeAccess = operation => {
      const result = accessChange.then(operation);
      accessChange = result.catch(() => {});
      return result;
    };

    async function authorized(owner) {
      await accessChange;
      if (registered) {
        const value = await registered.get(owner);
        return value ? { ...value, professionalRun: owner } : null;
      }
      const value = await get(accessKey);
      if (value?.owner !== owner || value.expiresAt <= Date.now()) return null;
      return { deviceId: value.deviceId, proof: value.proof };
    }
    function forget(owner, expectedProof) {
      return changeAccess(async () => {
        if (registered) {
          if ((await registered.get(owner))?.proof === expectedProof) await registered.remove(owner);
          return;
        }
        const current = await get(accessKey);
        if (current?.owner === owner && current.proof === expectedProof) await store.remove(accessKey);
      });
    }

    async function launch(owner, sourceTab) {
      const previous = await get(pendingKey);
      if (previous?.owner === owner && previous.until > Date.now()) {
        const tab = await chrome.tabs.get(previous.tabId).catch(() => null);
        if (isHhr(tab?.url)) {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          return { ok: true };
        }
      }
      const deviceId = registered ? crypto.randomUUID() :
        (await chrome.storage.local.get(deviceKey))[deviceKey] ?? crypto.randomUUID();
      if (!registered) await chrome.storage.local.set({ [deviceKey]: deviceId });
      const proof = hex(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))));
      const id = crypto.randomUUID();
      const [existing] = await chrome.tabs.query({ url: [origin + '/*'] });
      const duplicate = existing && isHhr(existing.url) &&
        await chrome.tabs.duplicate(existing.id).catch(() => null);
      const tab = duplicate || await chrome.tabs.create({ url: 'about:blank', active: false });
      await store.set({ [pendingKey]: { id, owner, sourceTab, tabId: tab.id, deviceId, proof, until: Date.now() + 5 * 60_000 } });
      const parameters = new URLSearchParams({ requestId: id, deviceId, challenge });
      if (registered) parameters.set('registerDevice', '1');
      await chrome.tabs.update(tab.id, { url: portal + '#' + parameters, active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true };
    }

    async function open(owner, sourceTab) {
      if (opening) return { error: 'Ya se está abriendo HHR.' };
      opening = launch(owner, sourceTab);
      try { return await opening; } finally { opening = undefined; }
    }

    async function receive({ id, expiresAt, registered: confirmed }, sender) {
      const pending = await get(pendingKey);
      if (!pending || sender.frameId !== 0 || !isHhr(sender.url) || !isHhr(sender.tab?.url) ||
          pending.tabId !== sender.tab.id || pending.id !== id || pending.until <= Date.now()) {
        return { error: 'Conexión no autorizada.' };
      }
      let registrationError;
      if (registered && confirmed === true) {
        const { owner, deviceId, proof } = pending;
        const result = await checkRegistered({ action: 'status', deviceId, proof, professionalRun: owner });
        if (result.authorized === true) {
          await changeAccess(() => registered.set(owner, { deviceId, proof }));
        } else {
          registrationError = result.error || 'HHR no pudo confirmar el registro del equipo.';
        }
        onAuthorized?.(pending.sourceTab, registrationError);
      } else if (!registered && Number.isSafeInteger(expiresAt) && expiresAt > Date.now() &&
          expiresAt <= Date.now() + 4 * 60 * 60_000) {
        const { owner, deviceId, proof } = pending;
        await changeAccess(() => store.set({ [accessKey]: { owner, deviceId, proof, expiresAt } }));
        onAuthorized?.(pending.sourceTab);
      }
      await store.remove(pendingKey);
      const source = await chrome.tabs.update(pending.sourceTab, { active: true }).catch(() => null);
      if (source) await chrome.windows.update(source.windowId, { focused: true }).catch(() => {});
      await chrome.tabs.remove(pending.tabId).catch(() => {});
      return registrationError ? { error: registrationError } : { ok: true };
    }
    return { authorized, forget, open, receive };
  }

  globalThis.HhrNursingHandoffConnection = { create, endpoint: project, registeredMode: Boolean(registration) };
})();
