// Routes checklist requests between the current Eloísa chart and one authenticated HHR tab.
((root) => {
  const portal = 'https://hhr-hospitalizados.app';
  const origin = 'https://fichamedico.rayensalud.cl';
  const key = 'hhr-clinical-checklists-enabled';
  function exchange(chrome, tabId, request) {
    return new Promise(resolve => {
      const port = chrome.tabs.connect(tabId, { name: 'hhr-clinical-checklists', frameId: 0 });
      const finish = reply => { clearTimeout(timer); port.disconnect(); resolve(reply); };
      const timer = setTimeout(() => finish({ error: 'HHR no respondió. Comprueba la sesión y vuelve a intentar.' }), 30000);
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; clearTimeout(timer); resolve({ unavailable: true }); });
      port.onMessage.addListener(message => {
        if (message.ready === true) port.postMessage(request);
        else finish(message);
      });
    });
  }
  function create({ chrome, resolveSession, getContext, encounterFromUrl }) {
    async function handle(message, sender) {
      const { encId, request } = message;
      if (sender.frameId !== 0 || !sender.tab?.id || new URL(sender.url).origin !== origin ||
          (await chrome.storage.local.get(key))[key] !== true) throw new Error('Abre Pautas desde la ficha activa.');
      const sameChart = tab => tab.url && new URL(tab.url).origin === origin && encounterFromUrl(tab.url) === encId;
      if (!sameChart(await chrome.tabs.get(sender.tab.id))) throw new Error('El episodio ya no está abierto en la pestaña de Eloísa.');
      if (!['templates', 'apply', 'verify'].includes(request?.action)) throw new Error('Operación de pauta desconocida.');
      const session = await resolveSession({ sender });
      if (session.error || !session.info?.practitionerId) throw new Error('Vuelve a identificarte en Eloísa.');
      const actor = String(session.info.practitionerId);
      const context = await getContext(encId, session.info, undefined, sender);
      if (context.error || !context.patient?.run || !context.patient?.name) throw new Error('Eloísa no pudo confirmar al paciente.');
      const document = context.patient.run;
      if (request.action === 'verify') {
        if (!sameChart(await chrome.tabs.get(sender.tab.id))) throw new Error('Cambió la ficha.');
        return { episode: encId, actor, document };
      }
      let tab;
      let outbound;
      if (request.action === 'apply') {
        if (message.actor !== actor || message.document !== document || !Number.isInteger(message.hhrTabId)) throw new Error('Cambió el paciente o el profesional. Reabre la pauta.');
        tab = await chrome.tabs.get(message.hhrTabId);
        outbound = { action: 'apply', episode: encId, document, uid: request.uid, code: request.code,
          templateId: request.templateId, version: request.version, answers: request.answers };
      } else {
        const tabs = (await chrome.tabs.query({ url: portal + '/*' })).filter(item => item.incognito === sender.tab.incognito);
        tab = tabs.sort((a, b) => Number(b.windowId === sender.tab.windowId) - Number(a.windowId === sender.tab.windowId) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (!tab) tab = await chrome.tabs.create({ url: portal + '/', active: false, windowId: sender.tab.windowId });
        outbound = { action: 'templates' };
      }
      const source = await chrome.tabs.get(sender.tab.id);
      if (!sameChart(source) || new URL(tab.url || tab.pendingUrl).origin !== portal || tab.incognito !== sender.tab.incognito)
        throw new Error('Reabre la pauta desde la ficha activa.');
      // A port belongs to a single document and disconnects when its tab navigates.
      let reply = await exchange(chrome, tab.id, outbound);
      for (let attempt = 0; reply.unavailable && attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        reply = await exchange(chrome, tab.id, outbound);
      }
      if (reply.error || !reply.data) throw new Error(reply.error || 'Abre HHR con tu cuenta y vuelve a intentar.');
      return { ...reply.data, document, actor, patientName: context.patient.name, hhrTabId: tab.id };
    }
    return { handle: async (message, sender) => {
      try { return await handle(message, sender); }
      catch (error) { return { error: error.message || 'No se pudo conectar la pauta con HHR.' }; }
    } };
  }
  root.HhrClinicalChecklistBroker = { create };
})(globalThis);
