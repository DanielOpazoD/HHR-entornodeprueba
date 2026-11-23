/* The local pilot uses an extension-owned editor. Notes and credentials stay out of Rayen's page. */
(() => {
  'use strict';
  const name = 'Eloísa HHR · Entrega de turno (pruebas)';
  const source = /^https:\/\/fichamedico\.rayensalud\.cl\/dashboard\/encounter-list-nurse\/?(?:[?#].*)?$/;
  const editor = 'nursing-handoff-editor.html';
  const prefix = tabId => 'hhr-nursing-handoff-' + tabId + ':';
  const editorKey = (tabId, id) => prefix(tabId) + 'editor:' + id;
  const draftKey = (context, date, shift) => prefix(context.tabId) +
    ['draft', context.sourceDocument, context.episode, date, shift].join(':');
  const number = value => /^[1-9]\d{0,15}$/.test(value ?? '');
  const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
  const error = (message, code) => ({ error: message, code });
  const identity = info => {
    const ids = [info?.facId, info?.practitionerId, info?.practitionerRoleId];
    return ids.every(number) ? ids.join(':') : null;
  };

  function create({
    chrome, getContext, getInfo, checkAccess, getSessionKey, fetchImpl = fetch,
    localPilot = globalThis.HhrNursingHandoffLocalPilot,
    hosted = globalThis.HhrNursingHandoffConnection,
  }) {
    const store = chrome.storage.session;
    const isPilot = chrome.runtime.getManifest().name === name;
    const registration = !isPilot && hosted?.registeredMode === true;
    const connectionOwner = info => {
      if (!registration) return identity(info);
      const value = typeof info?.professionalRun === 'string'
        ? info.professionalRun.replace(/[.\s-]/g, '').toUpperCase() : '';
      return /^[1-9]\d{6,7}[0-9K]$/.test(value) ? value.slice(0, -1) + '-' + value.slice(-1) : null;
    };
    const connection = !isPilot && hosted?.create(chrome, (tabId, registrationError) => {
      void chrome.tabs.sendMessage(tabId, { type: 'RAYEN_NURSING_HANDOFF_ACCESS_CHANGED', registrationError }, { frameId: 0 })
        .catch(() => {});
    }, { checkRegistered: call });
    const endpoint = connection ? hosted.endpoint : 'http://127.0.0.1:' + (localPilot?.port ?? 5001) +
      '/demo-hhr-handoff/southamerica-east1/nursingHandoffExtension';
    const enabled = Boolean(connection || (isPilot && localPilot?.installationKey));
    const needsHhr = () => registration
      ? { ...error('Registra este equipo para editar las entregas.', 'HHR_LINK_REQUIRED'), registration: true }
      : error('Conecta tu cuenta de HHR para continuar.', 'HHR_LINK_REQUIRED');
    const load = async key => (await store.get(key))[key];
    const draftWrites = new Map();
    const initialNotes = new Map();
    const saveTickets = new Map();
    const reap = entries => {
      const now = Date.now();
      for (const [id, entry] of entries) if (entry.expires <= now) entries.delete(id);
    };
    async function writeDraft(context, { date, shift, version, text }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['day', 'night'].includes(shift) ||
          !/^[a-f0-9]{64}$/.test(version) || (text !== undefined && (typeof text !== 'string' || text.length > 16000))) {
        return error('No se pudo conservar el borrador.');
      }
      const key = draftKey(context, date, shift);
      const { owner, sessionKey, patientId, run } = context;
      const write = Promise.resolve(draftWrites.get(key)).catch(() => {}).then(() =>
        text === undefined ? store.remove(key) :
          store.set({ [key]: { owner, sessionKey, patientId, run, version, text } }));
      draftWrites.set(key, write);
      try {
        await write;
        return { ok: true };
      } finally {
        if (draftWrites.get(key) === write) draftWrites.delete(key);
      }
    }
    const getPatient = (episode, info, sender) => {
      const testCase = localPilot?.testCase;
      if (testCase?.episode === episode && new URL(sender.url).searchParams.get('hhrHandoffTest') === '1') {
        return { info, patientId: testCase.episode, patient: testCase.patient };
      }
      return getContext(episode, info, null, sender);
    };
    async function sourceSession(sender) {
      if (!enabled || sender.frameId !== 0 || !source.test(sender.url) ||
          !source.test(sender.tab?.url)) return error('Abre la lista de Gestión de cuidados.');
      const session = await getInfo(sender);
      if (session.error) return error(session.error);
      if (!session.info?.token || !identity(session.info) || !connectionOwner(session.info)) return error('Inicia sesión en Hospitalizados de Eloísa.');
      return session;
    }

    const remoteAccess = (connectionAccess, info) => connection ? connectionAccess : {
      source: { installationKey: localPilot.installationKey, facilityId: String(info.facId),
        practitionerId: String(info.practitionerId), roleId: String(info.practitionerRoleId) },
    };

    function editorContext({ episode, patient, patientId, info, sessionKey, sender, inline }) {
      return {
        id: crypto.randomUUID(), tabId: sender.tab.id, sourceDocument: sender.documentId, episode,
        owner: identity(info), sessionKey, accountOwner: connectionOwner(info),
        patientId, run: patient.run, name: patient.name, inline,
      };
    }

    async function openRows(episodes, sender, info, access) {
      if (!sender.documentId || !Array.isArray(episodes) || !episodes.length || episodes.length > 50 ||
          episodes.some(episode => !number(episode)) || new Set(episodes).size !== episodes.length) {
        return error('La lista de episodios no es válida.');
      }
      const sessionKey = await getSessionKey(info, sender);
      const rows = Array(episodes.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(6, episodes.length) }, async () => {
        while (next < episodes.length) {
          const index = next++;
          const episode = String(episodes[index]);
          let patient;
          try {
            patient = await getPatient(episode, info, sender);
          } catch {
            patient = error('No se pudo identificar al paciente en Eloísa.');
          }
          rows[index] = patient.error ? { episode, error: patient.error } :
            editorContext({ ...patient, episode, info, sessionKey, sender, inline: true });
        }
      }));
      const contexts = rows.filter(row => row.id);
      const patients = contexts.map(row => ({ episode: row.episode, patientRun: row.run }));
      if (!patients.length) return { rows };
      const batch = await call({ action: 'read-batch', ...remoteAccess(access, info), patients });
      if (connection && batch.code === 'UNAUTHENTICATED') {
        await connection.forget(connectionOwner(info), access.proof);
        return needsHhr();
      }
      if (batch.error) return batch;
      if (!Array.isArray(batch.results) || batch.results.length !== contexts.length) {
        return error('HHR devolvió una lista incompleta de entregas.');
      }
      const verified = await verifySource(contexts[0]);
      if (verified.error) return verified;
      const stored = {};
      const expires = Date.now() + 15_000;
      reap(initialNotes);
      contexts.forEach((context, index) => {
        stored[editorKey(context.tabId, context.id)] = context;
        initialNotes.set(context.id, { tabId: context.tabId, expires, result: batch.results[index] });
      });
      await store.set(stored);
      return { slot: batch.slot, rows: rows.map(({ episode, id, error }) => id ? { episode, id } : { episode, error }) };
    }

    async function authorizeBatchSave(ids, sender, info) {
      if (!sender.documentId || !Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || !ids.every(uuid)) {
        return error('No se pudieron comprobar los borradores.');
      }
      const keys = ids.map(id => editorKey(sender.tab.id, id));
      const contexts = await store.get(keys);
      const sessionKey = await getSessionKey(info, sender);
      if (!keys.every(key => {
        const row = contexts[key];
        return row?.inline && row.editorDocument && row.sourceDocument === sender.documentId &&
          row.sessionKey === sessionKey && row.owner === identity(info);
      })) {
        return error('Cambió la lista o la sesión en Eloísa. Revisa los borradores.');
      }
      reap(saveTickets);
      const ticket = crypto.randomUUID();
      for (let offset = 0; offset < ids.length; offset += 10) {
        const group = ids.slice(offset, offset + 10);
        const block = { size: group.length, rows: [] };
        for (const id of group) saveTickets.set(id, { ticket, block, tabId: sender.tab.id, expires: Date.now() + 300_000 });
      }
      return { ticket };
    }

    async function table({ action, episodes, ids }, sender) {
      if (!['status', 'connect', 'open-rows', 'prepare-save'].includes(action)) return error('Operación no autorizada.');
      const session = await sourceSession(sender);
      if (session.error) return session;
      const access = await checkAccess(session.info);
      if (access.error) return error(access.error);
      const owner = connectionOwner(session.info);
      const key = connection && await connection.authorized(owner);
      if (action === 'open-rows' || action === 'prepare-save') {
        if (connection && !key) return needsHhr();
        return action === 'open-rows' ? openRows(episodes, sender, session.info, key) :
          authorizeBatchSave(ids, sender, session.info);
      }
      if (!connection) return { ok: true };
      if (key && !registration) return { ok: true };
      if (key) {
        const result = await call({ action: 'status', ...key });
        if (result.authorized === true) return { ok: true };
        if (result.code !== 'UNAUTHENTICATED') return result;
        await connection.forget(owner, key.proof);
      }
      return action === 'connect' ? connection.open(owner, sender.tab.id) : needsHhr();
    }

    async function start({ encId, inline }, sender) {
      if (!number(encId)) return error('Abre la lista de Gestión de cuidados.');
      const session = await sourceSession(sender);
      if (session.error) return session;
      if (inline === true && connection && !await connection.authorized(connectionOwner(session.info))) return needsHhr();
      const result = await getPatient(String(encId), session.info, sender);
      if (result.error) return error(result.error);
      const access = await checkAccess(result.info);
      if (access.error) return error(access.error);
      const owner = identity(result.info);
      if (!owner) return error('No se pudo verificar la sesión de Eloísa.');
      const sessionKey = await getSessionKey(result.info, sender);
      const context = editorContext({ ...result, episode: String(encId), sender, sessionKey, inline: inline === true });
      await store.set({ [editorKey(sender.tab.id, context.id)]: context });
      return { ok: true, id: context.id };
    }

    async function call(data) {
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }), signal: AbortSignal.timeout(24_000),
        });
        const body = await response.json();
        if (response.ok && body.result) return body.result;
        const { status, message, details } = body.error ?? {};
        return { ...error(message || 'HHR no respondió. Intenta de nuevo.', status), slot: details };
      } catch {
        return error('HHR no está disponible. Tu edición sigue abierta.', 'UNAVAILABLE');
      }
    }

    // Initial row editors from the same document may overlap. Share only a pending
    // source check; subsequent reads, patient checks and writes verify afresh.
    const openingChecks = new Map();
    function verifyOpening(context) {
      const key = JSON.stringify([context.tabId, context.sourceDocument, context.owner, context.accountOwner, context.sessionKey]);
      if (!openingChecks.has(key)) {
        openingChecks.set(key, verifySource(context).finally(() => openingChecks.delete(key)));
      }
      return openingChecks.get(key);
    }

    async function verifySource(context, checkPatient = false) {
      const tab = await chrome.tabs.get(context.tabId).catch(() => null);
      if (!source.test(tab?.url)) return error('Vuelve a la lista de Gestión de cuidados.', 'SOURCE_SESSION_CHANGED');
      const ficha = { tab, frameId: 0, url: tab.url, id: chrome.runtime.id };
      const session = await getInfo(ficha);
      if (!session.info?.token || identity(session.info) !== context.owner ||
          (registration && connectionOwner(session.info) !== context.accountOwner) ||
          await getSessionKey(session.info, ficha) !== context.sessionKey) {
        return error('Cambió la sesión de Eloísa. Abre la entrega desde la lista.', 'SOURCE_SESSION_CHANGED');
      }

      const access = await checkAccess(session.info);
      if (access.error) return error(access.error, 'SOURCE_SESSION_CHANGED');
      if (checkPatient) {
        const refreshed = await getPatient(context.episode, session.info, ficha);
        if (refreshed.error || refreshed.patientId !== context.patientId || refreshed.patient?.run !== context.run) {
          return error('Eloísa no confirmó el paciente y episodio. Abre otra vez la entrega.', 'SOURCE_SESSION_CHANGED');
        }
      }
      return { info: session.info };
    }

    // Editors deliver note text directly to the worker. Only the ticket crosses the host page.
    function collectSave(block, context, message) {
      return new Promise(resolve => {
        block.rows.push({ context, message, resolve });
        clearTimeout(block.timer);
        const flush = () => {
          const rows = block.rows.splice(0);
          const task = saving.then(() => writeBlock(rows));
          saving = task.catch(() => {});
          task.catch(() => {
            for (const row of rows) row.resolve(error('No se pudo confirmar el bloque. Conserva tus borradores.'));
          });
        };
        // A closed or filtered editor must not keep the other patients waiting.
        if (block.rows.length === block.size) flush();
        else block.timer = setTimeout(flush, 200);
      });
    }

    async function writeBlock(rows) {
      const first = rows[0].context;
      const { date, shift } = rows[0].message;
      const failAll = result => rows.forEach(row => row.resolve(result));
      const source = await verifySource(first);
      if (source.error) return failAll(source);
      const tab = await chrome.tabs.get(first.tabId);
      const sender = { tab, frameId: 0, url: tab.url, id: chrome.runtime.id };
      const verified = await Promise.all(rows.map(async row => {
        const { context, message } = row;
        const fresh = await Promise.resolve().then(() => getPatient(context.episode, source.info, sender)).catch(() => null);
        if (message.date !== date || message.shift !== shift ||
            fresh?.patientId !== context.patientId || !fresh?.patient?.run || fresh.patient.run !== context.run) {
          row.resolve(error('Revisa el paciente y el turno antes de guardar.', 'SOURCE_SESSION_CHANGED'));
          return null;
        }
        return row;
      }));
      const active = verified.filter(Boolean);
      if (!active.length) return;
      const access = connection && await connection.authorized(first.accountOwner ?? first.owner);
      if (connection && !access) return failAll(needsHhr());
      const current = await verifySource(first);
      if (current.error) return failAll(current);
      const patients = active.map(({ context, message }) => ({
        episode: context.episode, patientRun: context.run, text: message.text, version: message.version,
      }));
      const result = await call({ action: 'save-batch', date, shift, patients, ...remoteAccess(access, current.info) });
      if (connection && result.code === 'UNAUTHENTICATED') {
        await connection.forget(first.accountOwner ?? first.owner, access.proof);
        return failAll(needsHhr());
      }
      if (result.error) return failAll(result);
      const after = await verifySource(first).catch(() => error('Cambió la sesión de Eloísa.', 'SOURCE_SESSION_CHANGED'));
      for (const [index, row] of active.entries()) {
        const receipt = result.results?.[index];
        if (receipt?.episode !== row.context.episode || !receipt.confirmed || receipt.date !== date ||
            receipt.shift !== shift || receipt.text !== row.message.text || !/^[a-f0-9]{64}$/.test(receipt.version)) {
          row.resolve(receipt?.episode === row.context.episode && receipt.error ?
            error(receipt.error, receipt.code) : error('HHR aún no confirmó esta entrega.'));
          continue;
        }
        if (!after.error) void chrome.tabs.sendMessage(first.tabId, {
          type: 'RAYEN_NURSING_HANDOFF_CONFIRMED', episode: row.context.episode, date, shift,
        }, { documentId: first.sourceDocument }).catch(() => {});
        row.resolve(after.error ? { ...after, confirmed: true } : receipt);
      }
    }

    async function operate(message, sender) {
      const { id, action } = message;
      if (connection && action === 'hosted-result') return connection.receive(message, sender);
      if (!enabled || !uuid(id) || !source.test(sender.tab?.url) ||
          !sender.documentId) return error('Editor no autorizado.');
      const key = editorKey(sender.tab.id, id);
      const context = await load(key);
      if (context?.id !== id) return error('Vuelve a abrir la entrega desde la lista.');
      if (action === 'close' && sender.frameId === 0 && sender.documentId === context.sourceDocument) {
        initialNotes.delete(id);
        saveTickets.delete(id);
        await store.remove(key);
        return { ok: true };
      }
      if (!(sender.frameId > 0) || sender.url !== chrome.runtime.getURL(editor) + '#' + id ||
          (context.editorDocument ? context.editorDocument !== sender.documentId : action !== 'context')) {
        return error('Editor no autorizado.');
      }
      if (action === 'draft' && context.inline && context.editorDocument === sender.documentId) {
        return writeDraft(context, message);
      }
      if (!['context', 'read', 'save', 'connect', 'disconnect'].includes(action)) return error('Operación no autorizada.');
      if (action === 'save' && message.ticket !== undefined) {
        const grant = saveTickets.get(id);
        if (!grant || grant.expires <= Date.now() || grant.ticket !== message.ticket) {
          return error('Vuelve a pulsar Guardar cambios desde la tabla.');
        }
        saveTickets.delete(id);
        return collectSave(grant.block, context, message);
      }
      const prepared = action === 'read' && !message.since && initialNotes.get(id);
      if (prepared) initialNotes.delete(id);
      const initial = prepared?.expires > Date.now() ? prepared.result : null;
      const verified = context.inline && (action === 'context' || initial)
        ? await verifyOpening(context)
        : await verifySource(context, action === 'save' || (action === 'read' && !initial));
      if (verified.error) return verified;
      if (action === 'context') {
        await store.set({ [key]: { ...context, editorDocument: sender.documentId } });
        return { name: context.name, hosted: Boolean(connection), registration, inline: context.inline === true };
      }

      if (action === 'connect') return connection ?
        connection.open(context.accountOwner ?? context.owner, context.tabId) : error('El piloto local usa el censo de pruebas.');
      const access = connection && await connection.authorized(context.accountOwner ?? context.owner);
      if (action === 'disconnect') {
        if (!access) return { disconnected: true };
        const owner = context.accountOwner ?? context.owner;
        if (!registration) await connection.forget(owner, access.proof);
        const result = await call({ action, ...access });
        if (registration) {
          if (result.disconnected !== true && result.code !== 'UNAUTHENTICATED') return result;
          await connection.forget(owner, access.proof);
        }
        return { disconnected: true, remoteConfirmed: result.disconnected === true };
      }
      if (connection && !access) return needsHhr();
      const result = initial || await call({
        action, episode: context.episode, patientRun: context.run,
        ...remoteAccess(access, verified.info), comparison: context.inline && action === 'read',
        date: message.date, shift: message.shift, since: message.since,
        version: message.version, text: message.text,
      });
      if (connection && result.code === 'UNAUTHENTICATED') {
        await connection.forget(context.accountOwner ?? context.owner, access.proof);
        return needsHhr();
      }
      if (!result.error && action === 'read') {
        if (!initial) {
          const updated = await verifySource(context, true);
          if (updated.error) return updated;
        }
        if (context.inline && !message.since) {
          const key = draftKey(context, result.date, result.shift);
          await draftWrites.get(key)?.catch(() => {});
          const draft = await load(key);
          if (draft?.owner === context.owner && draft.sessionKey === context.sessionKey &&
              draft.patientId === context.patientId && draft.run === context.run) {
            return { ...result, draft: { text: draft.text, version: draft.version } };
          }
        }
      }
      if (result.confirmed) {
        const updated = await verifySource(context).catch(() => error('Cambió la sesión de Eloísa.', 'SOURCE_SESSION_CHANGED'));
        if (updated.error) return { ...updated, confirmed: true };
        await chrome.tabs.sendMessage(context.tabId, {
          type: 'RAYEN_NURSING_HANDOFF_CONFIRMED',
          episode: context.episode, date: result.date, shift: result.shift,
        }, { documentId: context.sourceDocument }).catch(() => {});
      }
      return result;
    }

    if (enabled) chrome.tabs.onRemoved.addListener(async tabId => {
      for (const [id, entry] of initialNotes) if (entry.tabId === tabId) initialNotes.delete(id);
      for (const [id, entry] of saveTickets) if (entry.tabId === tabId) saveTickets.delete(id);
      const keys = Object.keys(await store.get(null)).filter(key => key.startsWith(prefix(tabId)));
      if (keys.length) await store.remove(keys);
    });
    // HHR commits to the same census document even when two rows belong to different patients.
    let saving = Promise.resolve();
    return {
      table,
      start,
      operate(message, sender) {
        if (message.action !== 'save' || message.ticket !== undefined || !(sender.frameId > 0) ||
            sender.url !== chrome.runtime.getURL(editor) + '#' + message.id) {
          return operate(message, sender);
        }
        const next = saving.then(() => operate(message, sender));
        saving = next.catch(() => {});
        return next;
      },
    };
  }

  globalThis.HhrNursingHandoffPilot = { create };
})();
