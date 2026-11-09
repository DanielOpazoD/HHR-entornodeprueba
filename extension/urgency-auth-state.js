/** Only trusted extension contexts can access pending login contexts or native tickets. */
(function (root) {
  'use strict';
  const { fail } = root.HhrUrgencyApi;
  const prefix = 'hhr_urgency_flow_';
  const activeKey = tabId => `hhr_urgency_active_${tabId}`;
  const create = ({ chrome, getAuthorizationKey, now = Date.now }) => {
    const storage = chrome.storage.session;
    const get = async key => (await storage.get(key))[key];
    const remove = id => storage.remove(prefix + id);
    const current = async flow => {
      if (!await get(prefix + flow.id)) fail('EXPIRED');
      if (flow.expiresAt <= now()) { await remove(flow.id); fail('EXPIRED'); }
      let authorizationKey;
      try { authorizationKey = await getAuthorizationKey(flow.sender); }
      catch { await remove(flow.id); fail('SESSION'); }
      if (await get(activeKey(flow.tabId)) !== flow.id || authorizationKey !== flow.authorizationKey) {
        await remove(flow.id); fail('SESSION');
      }
    };
    const save = async flow => {
      await current(flow);
      await storage.set({ [prefix + flow.id]: flow });
      await current(flow);
    };
    const begin = async sender => {
      const tabId = sender?.tab?.id, url = sender?.url || sender?.tab?.url;
      if (!Number.isInteger(tabId) || !root.HhrAppOrigins.matchesUrl(url)) fail('SESSION');
      const authorizationKey = await getAuthorizationKey(sender);
      const previous = await get(activeKey(tabId));
      if (previous) await remove(previous);
      const id = crypto.randomUUID();
      const flow = { id, tabId, sender, authorizationKey, parentOrigin: new URL(url).origin,
        state: 'credentials', expiresAt: now() + 300000 };
      await storage.set({ [activeKey(tabId)]: id, [prefix + id]: flow });
      return { ok: false, auth: { flowId: id, url: chrome.runtime.getURL(`urgency-login.html?flow=${id}`) } };
    };
    const owned = async (id, sender) => {
      if (!/^[0-9a-f-]{36}$/.test(id || '') || sender?.id !== chrome.runtime.id) fail('SESSION');
      const url = new URL(sender.url || 'about:blank');
      const expected = new URL(chrome.runtime.getURL('urgency-login.html'));
      if (url.protocol !== expected.protocol || url.host !== expected.host ||
          url.pathname !== expected.pathname || url.searchParams.get('flow') !== id)
        fail('SESSION');
      const flow = await get(prefix + id);
      if (!flow || sender.tab?.id !== flow.tabId) fail('EXPIRED');
      await current(flow);
      return flow;
    };
    const sessionFor = async sender => {
      const id = await get(activeKey(sender?.tab?.id));
      if (!id) return null;
      const flow = await get(prefix + id);
      if (!flow) return null;
      try { await current(flow); } catch { return null; }
      if (flow.state !== 'authenticated') return null;
      return { ...flow.native, id: flow.id, assertCurrent: () => current(flow) };
    };
    const authenticated = async (flow, native) => {
      await save({ id: flow.id, tabId: flow.tabId, sender: flow.sender,
        authorizationKey: flow.authorizationKey, parentOrigin: flow.parentOrigin,
        state: 'authenticated', native, expiresAt: now() + 3600000 });
    };
    const revoke = async sender => {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return;
      const id = await get(activeKey(tabId));
      if (id) await remove(id);
      await storage.remove(activeKey(tabId));
    };
    return { begin, owned, current, save, sessionFor, authenticated, remove, revoke };
  };
  root.HhrUrgencyAuthState = { create };
})(typeof self !== 'undefined' ? self : globalThis);
