// Routes checklist requests between the current Eloísa chart and one authenticated HHR tab.
(root => {
  'use strict';
  const PORTAL = 'https://hhr-hospitalizados.app';
  const FICHA_ORIGIN = 'https://fichamedico.rayensalud.cl';
  const ENABLED_KEY = 'hhr-clinical-checklists-enabled';
  const HHR_TAB_PATTERNS = [
    'https://hhr-hospitalizados.app/*',
    'https://testinghhr.netlify.app/*',
    'https://hhr-entorno-prueba.netlify.app/*',
  ];

  const delay = ms =>
    typeof setTimeout === 'function'
      ? new Promise(resolve => setTimeout(resolve, ms))
      : Promise.resolve();

  const isAllowedHhrUrl = url => {
    if (!url) return false;
    if (typeof root.HhrAppOrigins?.matchesUrl === 'function') {
      return root.HhrAppOrigins.matchesUrl(url);
    }
    try {
      return new URL(url).origin === PORTAL;
    } catch {
      return false;
    }
  };

  function exchange(chrome, tabId, request) {
    return new Promise(resolve => {
      let settled = false;
      let timer = null;
      const done = reply => {
        if (settled) return;
        settled = true;
        if (timer != null) clearTimeout(timer);
        try {
          port.disconnect();
        } catch {
          // Port may already be disconnected.
        }
        resolve(reply);
      };
      const port = chrome.tabs.connect(tabId, { name: 'hhr-clinical-checklists', frameId: 0 });
      if (typeof setTimeout === 'function') {
        timer = setTimeout(
          () => done({ error: 'HHR no respondió. Comprueba tu sesión en HHR y vuelve a intentar.' }),
          30000
        );
      }
      port.onDisconnect.addListener(() => {
        void chrome.runtime?.lastError;
        done({ unavailable: true, disconnected: true });
      });
      port.onMessage.addListener(message => {
        if (message?.ready === true) port.postMessage(request);
        else done(message || { unavailable: true });
      });
    });
  }

  async function tryInjectRelay(chrome, tabId) {
    if (typeof chrome.scripting?.executeScript !== 'function') return false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['hhr-origin-policy.js', 'clinical-checklist-hhr.js'],
      });
      return true;
    } catch {
      return false;
    }
  }

  async function findCandidateTabs(chrome, senderTab) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ url: HHR_TAB_PATTERNS });
    } catch {
      tabs = await chrome.tabs.query({ url: PORTAL + '/*' });
    }
    return tabs
      .filter(item => item.incognito === senderTab.incognito && isAllowedHhrUrl(item.url || item.pendingUrl))
      .sort((a, b) => {
        const prodDiff =
          Number((b.url || '').startsWith(PORTAL + '/')) - Number((a.url || '').startsWith(PORTAL + '/'));
        if (prodDiff) return prodDiff;
        const winDiff = Number(b.windowId === senderTab.windowId) - Number(a.windowId === senderTab.windowId);
        if (winDiff) return winDiff;
        return (b.lastAccessed || 0) - (a.lastAccessed || 0);
      });
  }

  async function exchangeWithTab(chrome, tab, outbound, injectedTabs) {
    let reply = await exchange(chrome, tab.id, outbound);
    if (reply.disconnected && !injectedTabs.has(tab.id)) {
      injectedTabs.add(tab.id);
      if (await tryInjectRelay(chrome, tab.id)) {
        reply = await exchange(chrome, tab.id, outbound);
      }
    }
    return reply;
  }

  async function sendToAnyHhrTab(chrome, tabs, outbound) {
    const injectedTabs = new Set();
    let lastReply = { unavailable: true };
    for (let attempt = 0; attempt < 13; attempt++) {
      for (const tab of tabs) {
        const reply = await exchangeWithTab(chrome, tab, outbound, injectedTabs);
        if (!reply.unavailable) return { reply, tab };
        lastReply = reply;
      }
      if (attempt < 12) await delay(500);
    }
    return { reply: lastReply, tab: tabs[0] };
  }

  function create({ chrome, resolveSession, getContext, encounterFromUrl }) {
    const sameChart = (tab, encId) =>
      Boolean(tab?.url) && new URL(tab.url).origin === FICHA_ORIGIN && encounterFromUrl(tab.url) === encId;

    async function assertActiveChartAndIdentity(message, sender) {
      const { encId, request } = message;
      if (
        sender.frameId !== 0 ||
        !sender.tab?.id ||
        new URL(sender.url).origin !== FICHA_ORIGIN ||
        (await chrome.storage.local.get(ENABLED_KEY))[ENABLED_KEY] !== true
      ) {
        throw new Error('Abre Pautas desde la ficha activa.');
      }
      if (!sameChart(await chrome.tabs.get(sender.tab.id), encId)) {
        throw new Error('El episodio ya no está abierto en la pestaña de Eloísa.');
      }
      if (!['templates', 'apply', 'verify'].includes(request?.action)) {
        throw new Error('Operación de pauta desconocida.');
      }
      const session = await resolveSession({ sender });
      if (session.error || !session.info?.practitionerId) {
        throw new Error('Vuelve a identificarte en Eloísa.');
      }
      const actor = String(session.info.practitionerId);
      const context = await getContext(encId, session.info, undefined, sender);
      if (context.error || !context.patient?.run || !context.patient?.name) {
        throw new Error('Eloísa no pudo confirmar al paciente.');
      }
      return { encId, request, actor, document: context.patient.run, patientName: context.patient.name };
    }

    async function handle(message, sender) {
      const { encId, request, actor, document, patientName } = await assertActiveChartAndIdentity(message, sender);
      if (request.action === 'verify') {
        if (!sameChart(await chrome.tabs.get(sender.tab.id), encId)) throw new Error('Cambió la ficha.');
        return { episode: encId, actor, document };
      }

      let candidateTabs;
      let outbound;
      if (request.action === 'apply') {
        if (message.actor !== actor || message.document !== document || !Number.isInteger(message.hhrTabId)) {
          throw new Error('Cambió el paciente o el profesional. Reabre la pauta.');
        }
        const pinnedTab = await chrome.tabs.get(message.hhrTabId).catch(() => null);
        if (!pinnedTab || !isAllowedHhrUrl(pinnedTab.url || pinnedTab.pendingUrl) || pinnedTab.incognito !== sender.tab.incognito) {
          throw new Error('Se cerró la pestaña de HHR. Reabre HHR y pulsa «Reintentar».');
        }
        candidateTabs = [pinnedTab];
        outbound = {
          action: 'apply',
          episode: encId,
          document,
          uid: request.uid,
          code: request.code,
          templateId: request.templateId,
          version: request.version,
          answers: request.answers,
        };
      } else {
        candidateTabs = await findCandidateTabs(chrome, sender.tab);
        if (!candidateTabs.length) {
          throw new Error('Abre HHR Hospitalizados con tu sesión iniciada y pulsa «Reintentar».');
        }
        outbound = { action: 'templates' };
      }

      if (!sameChart(await chrome.tabs.get(sender.tab.id), encId)) {
        throw new Error('Reabre la pauta desde la ficha activa.');
      }

      const { reply, tab } = await sendToAnyHhrTab(chrome, candidateTabs, outbound);
      if (reply.error || !reply.data) {
        throw new Error(
          reply.error || 'Inicia sesión en tu pestaña de HHR Hospitalizados (o recárgala) y pulsa «Reintentar».'
        );
      }
      return { ...reply.data, document, actor, patientName, hhrTabId: tab.id };
    }

    return {
      handle: async (message, sender) => {
        try {
          return await handle(message, sender);
        } catch (error) {
          return { error: error.message || 'No se pudo conectar la pauta con HHR.' };
        }
      },
    };
  }

  root.HhrClinicalChecklistBroker = { create };
})(globalThis);
