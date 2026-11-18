/* Open the native Gestión de Camas editor in a tab reserved for one nursing worklist click. */
(() => {
  'use strict';
  const origin = 'https://hospitalizado.rayensalud.cl';
  const nurse = /^https:\/\/fichamedico\.rayensalud\.cl\/dashboard\/encounter-list-nurse\/?(?:[?#].*)?$/;
  const key = id => 'hhr-worklist-editor-' + id;
  const numeric = value => /^[1-9]\d*$/.test(String(value || ''));
  const running = new Set();

  // Executed only in the targeted GC document. Its legacy React 15 components own the
  // beds grouped by status, the admission orders and the menu generated for each row.
  async function openNativeEditor(request) {
    if (location.origin !== 'https://hospitalizado.rayensalud.cl' || !/^#\/bed\/?(?:\?|$)/.test(location.hash)) return { wait: true };
    const hostOf = element => {
      const key = element && Object.keys(element).find(name => name.startsWith('__reactInternalInstance$'));
      return key && element[key];
    };
    // Production React 15 does not record an owner on the host of the functional BedTabs.
    // Its mounted component chain is reachable from the parent host's rendered children.
    const tabs = hostOf(document.querySelector('.sdxWrapper__content-tabs.pt-tabs'));
    let groups;
    for (const child of Object.values(tabs?._hostParent?._renderedChildren || {})) {
      let node = child;
      let candidate;
      while (node && node !== tabs) {
        candidate = node._currentElement?.props?.bedsByType || candidate;
        node = node._renderedComponent;
      }
      if (node === tabs) { groups = candidate; break; }
    }
    const view = [...document.querySelectorAll('.sdxTemplate__wrapper')].map(el => hostOf(el)?._currentElement?._owner?._instance)
      .find(instance => typeof instance?.typeViewResult === 'function' && typeof instance.props?.onAction === 'function');
    const current = view?.props.authenticate?.current;
    if (!current || !groups || !Array.isArray(view.props.hospitalRequest?.results)) return { wait: true };
    if (String(current.role?.facilityId) !== request.facility || String(current.profile?.id) !== request.professional) {
      return { error: 'La sesión de Gestión de Camas corresponde a otro profesional o establecimiento.' };
    }
    if (!current.role.permissions?.includes('Modificar_Paciente')) return { error: 'Tu perfil de Gestión de Camas no permite modificar pacientes.' };
    const matches = [];
    for (const type of [3, 4, 5]) {
      for (const bed of groups[type] || []) {
        const encounter = bed.bedEncounterMapping?.encounterMapping?.encounter;
        if (String(encounter?.id ?? bed.encounterId) !== request.episode) continue;
        if (bed.encounterId && String(bed.encounterId) !== request.episode) return { error: 'El episodio cambió en Gestión de Camas.' };
        matches.push({ bed, type });
      }
    }
    if (!matches.length) return { wait: true };
    if (matches.length !== 1) return { error: 'Gestión de Camas no identifica un único episodio para esta fila.' };
    const { bed, type } = matches[0];
    const orders = view.props.hospitalRequest.results.filter(order => order?.hospitalAdmissionOrderMapping && order.id === bed.hospitalAdmissionOrderId);
    if (!orders.length) return { wait: true };
    const order = orders[0];
    const encounterPatient = bed.bedEncounterMapping?.encounterMapping?.encounter?.patientId;
    if (orders.length !== 1 || String(order.patient?.id) !== request.patient ||
        [order.patientId, encounterPatient].some(id => id != null && String(id) !== request.patient)) {
      return { error: 'El paciente de Gestión de Camas no coincide con el de la fila. Actualiza la lista.' };
    }
    if (document.querySelector('dialog[open],.pt-dialog:not([hidden]),[role="dialog"][aria-modal="true"]')) return { error: 'Cierra el cuadro abierto en Gestión de Camas y vuelve a pulsar el lápiz.' };
    const cells = view.typeViewResult(type, bed);
    const allowed = cells.some(cell => cell.bed === bed && cell.action?.flat().some(option => option.value === 'requestModified' && !option.disabled));
    if (!allowed) return { error: 'La opción «Modificar paciente» no está disponible para este episodio.' };
    view.props.onAction({ option: 'requestModified', bed });
    for (let attempt = 0; attempt < 20; attempt++) {
      const headers = document.querySelectorAll('.pt-dialog-header, dialog[open], [role="dialog"] [role="heading"]');
      if ([...headers].some(el => el.getClientRects().length && el.textContent.includes('Modificación del paciente'))) return { opened: true };
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { error: 'Gestión de Camas no confirmó la apertura de «Modificación del paciente».' };
  }

  async function authorizeChart(fetchClaims, info) {
    const result = await fetchClaims(info);
    if (result.error) return result;
    return result.claims.some(item => item.claim === 'Acceso_Ficha_Clinica')
      ? { ok: true } : { error: 'Eloísa no autorizó el acceso a la ficha clínica.' };
  }

  // A hash can survive an expired session. Consult mounted React owners in this
  // document and return only whether its current professional and facility match.
  function inspectSession(professional, facility) {
    if (location.origin !== 'https://hospitalizado.rayensalud.cl' || location.hash.startsWith('#/authenticate')) return 'login';
    for (const element of document.querySelectorAll('.sdxTemplate__wrapper,.sdxWrapper__content-tabs, [data-reactroot]')) {
      const internal = Object.keys(element).find(key => key.startsWith('__reactInternalInstance$'));
      for (let host = element[internal]; host; host = host._hostParent) {
        for (let owner = host._currentElement?._owner; owner; owner = owner._currentElement?._owner) {
          const current = owner._instance?.props?.authenticate?.current;
          if (!current?.profile?.id || !current.role?.facilityId) continue;
          return String(current.profile.id) === professional && String(current.role.facilityId) === facility ? 'match' : 'other';
        }
      }
    }
    return 'unknown';
  }

  function create({ chrome, getContext, getInfo, checkAccess }) {
    const store = chrome.storage.session;
    let selecting = Promise.resolve();
    async function start({ encId }, sender) {
      if (sender?.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !nurse.test(sender.url) || !nurse.test(sender.tab.url) || !numeric(encId)) {
        return { error: 'Selecciona una fila de Gestión de cuidados.' };
      }
      const session = await getInfo(sender);
      if (session.error) return session;
      const access = await checkAccess(session.info);
      if (access.error) return access;
      const context = await getContext(encId, session.info);
      if (context.error) return context;
      const { patientId, info } = context;
      if (![info.facId, info.practitionerId, patientId].every(numeric)) return { error: 'No se pudo verificar la identidad del episodio o de la sesión.' };
      const request = { episode: String(encId), patient: String(patientId), professional: String(info.practitionerId), facility: String(info.facId) };
      const operation = selecting.then(() => openDestination(request, sender.tab.windowId));
      selecting = operation.catch(() => {});
      return operation;
    }
    async function openDestination(request, windowId) {
      const candidates = await chrome.tabs.query({ url: origin + '/*' });
      const states = await Promise.all(candidates.map(async tab => {
        if (tab.discarded) return null;
        try {
          const [probe] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN',
            func: inspectSession, args: [request.professional, request.facility] });
          const score = { match: 4, unknown: 2, login: 1 }[probe?.result];
          return score ? { tab, score } : null;
        } catch { return null; }
      }));
      const ranked = states.filter(Boolean).sort((a, b) => b.score - a.score ||
        Number(b.tab.url.startsWith(origin + '/#/bed')) - Number(a.tab.url.startsWith(origin + '/#/bed')) ||
        Number(b.tab.windowId === windowId) - Number(a.tab.windowId === windowId));
      const existing = ranked[0]?.tab;
      const dest = existing || await chrome.tabs.create({ url: 'about:blank', windowId });
      const storageKey = key(dest.id);
      const prior = (await store.get(storageKey))[storageKey];
      if (prior?.expires > Date.now() || running.has(dest.id)) return { error: 'Hay una apertura de paciente en curso en Gestión de Camas.' };
      try {
        await store.set({ [storageKey]: { ...request, expires: Date.now() + 5 * 60_000 } });
        await chrome.tabs.update(dest.id, existing ? { active: true } : { active: true, url: origin + '/#/bed' });
        if (dest.windowId !== windowId) await chrome.windows.update(dest.windowId, { focused: true });
        if (existing) {
          // The tab may predate installation. Install the idempotent listener without reloading Camas.
          await chrome.tabs.sendMessage(dest.id, { type: 'HHR_WAKE_BED_EDITOR' }).catch(() =>
            chrome.scripting.executeScript({ target: { tabId: dest.id }, files: ['content-worklist-editor-destination.js'] }));
        }
        return { ok: true };
      } catch (error) {
        await store.remove(storageKey);
        throw error;
      }
    }
    async function resume(_, sender) {
      if (sender?.frameId !== 0 || !sender.documentId || !Number.isInteger(sender.tab?.id) || !sender.url?.startsWith(origin + '/')) return {};
      const tabId = sender.tab.id;
      const storageKey = key(tabId);
      const pending = (await store.get(storageKey))[storageKey];
      if (!pending) return {};
      if (Date.now() >= pending.expires) {
        await store.remove(storageKey);
        return { error: 'Vuelve a pulsar el lápiz desde Gestión de cuidados.' };
      }
      const page = new URL(sender.tab.url);
      if (page.origin !== origin) return {};
      if (page.hash.startsWith('#/authenticate/login')) {
        if (pending.searchStarted) { delete pending.searchStarted; await store.set({ [storageKey]: pending }); }
        return { login: true };
      }
      if (!/^#\/bed\/?(?:\?|$)/.test(page.hash)) {
        const [modal] = await chrome.scripting.executeScript({ target: { tabId, documentIds: [sender.documentId] },
          func: () => Boolean(document.querySelector('dialog[open],.pt-dialog:not([hidden]),[role="dialog"][aria-modal="true"]')) });
        if (!modal?.result) return { navigate: true };
        await store.remove(storageKey);
        return { error: 'Cierra el cuadro abierto en Gestión de Camas y vuelve a pulsar el lápiz.' };
      }
      if (running.has(tabId)) return { wait: true };
      running.add(tabId);
      try {
        if (!pending.searchStarted) {
          pending.searchStarted = Date.now();
          await store.set({ [storageKey]: pending });
        }
        const [execution] = await chrome.scripting.executeScript({ target: { tabId, documentIds: [sender.documentId] },
          world: 'MAIN', func: openNativeEditor, args: [pending] });
        const result = execution?.result;
        if (!result) throw new Error('No se pudo abrir el editor nativo.');
        if (result.wait && Date.now() - pending.searchStarted > 20000) {
          await store.remove(storageKey);
          return { error: 'Gestión de Camas no encontró el episodio entre sus hospitalizaciones editables. Actualiza la lista antes de volver a intentarlo.' };
        }
        if (!result.wait) await store.remove(storageKey);
        return result;
      } finally { running.delete(tabId); }
    }
    chrome.tabs.onRemoved.addListener(id => { void store.remove(key(id)); });
    return { start, resume };
  }
  self.HhrWorklistPatientEditor = { create, authorizeChart, openNativeEditor };
})();
