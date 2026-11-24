(() => {
  'use strict';
  if (globalThis.hhrClinicalChecklistDialogInstalled) return;
  globalThis.hhrClinicalChecklistDialogInstalled = true;
  document.querySelectorAll('[data-hhr-checklist="' + chrome.runtime.id + '"]').forEach(el => el.remove());
  const key = 'hhr-clinical-checklists-enabled';
  const route = () => globalThis.HhrPrescriptionPrint.resolveEncounterId(location.href);
  const evo = globalThis.HhrChecklistEvolution;
  let enabled = false, trigger, dialog, session, insertedReceipt, scheduled = false, persistedRevision = 0;
  const make = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };
  const button = (text, click) => { const el = make('button', text); el.type = 'button'; el.addEventListener('click', click); return el; };
  const current = state => enabled && state === session && route() === state.episode;
  async function call(state, request) {
    const result = await chrome.runtime.sendMessage({ type: 'RAYEN_CLINICAL_CHECKLIST', encId: state.episode, request,
      ...(state.catalog ? { actor: state.catalog.actor, document: state.catalog.document, hhrTabId: state.catalog.hhrTabId } : {}) });
    if (!current(state)) throw new Error('Cambió la ficha.');
    if (!result || result.error) throw new Error(result?.error || 'HHR no confirmó la operación.');
    return result;
  }
  function close() { if (dialog) { const old = dialog; dialog = null; old.close(); old.remove(); } }
  function status(text) { const area = dialog?.querySelector('[role=status]'); if (area) area.textContent = text; }
  async function verifyChart(state) {
    const header = await call(state, { action: 'verify' });
    if (!current(state) || header.episode !== state.episode || header.actor !== state.catalog.actor || header.document !== state.catalog.document)
      throw new Error('Reabre la ficha del mismo paciente con la sesión que aplicó la pauta.');
  }
  async function transcribe(state) {
    const previousDialog = dialog;
    const active = () => current(state) && dialog === previousDialog && previousDialog?.isConnected;
    await verifyChart(state);
    if (!active()) return false;
    previousDialog.close();
    let inserted = false;
    try {
      if (!evo.editor()) {
        if (!await evo.openEditor(active)) return false;
        await verifyChart(state);
      }
      if (active()) inserted = evo.insert(state.record);
    } finally {
      if (!inserted && active() && !previousDialog.open) previousDialog.showModal();
    }
    if (!inserted) return false;
    insertedReceipt = { episode: state.episode, code: state.record.code };
    session = null; close(); refresh();
    trigger?.focus();
    return true;
  }
  async function showReceipt(state) {
    if (!dialog || !current(state)) return;
    const content = dialog.querySelector('form');
    content.replaceChildren();
    const code = make('p', state.record.code);
    const insert = button('Insertar en evolución', async () => {
      insert.disabled = true;
      try { if (!await transcribe(state)) status('Abre el editor de una evolución y pulsa «Insertar pauta guardada».'); }
      catch (error) { status(error.message); }
      finally { insert.disabled = false; }
    });
    content.append(code, insert);
    status('Guardada en HHR. Abre la evolución de este episodio para insertar el texto.');
    insert.disabled = true;
    try { await transcribe(state); } catch (error) { status(error.message); }
    finally { insert.disabled = false; }
  }
  function fieldsFor(state, template, container) {
    container.replaceChildren();
    for (const field of template.fields) {
      const label = make('label', field.label);
      const input = field.type === 'choice' ? make('select') : field.type === 'text' ? make('textarea') : make('input');
      if (field.type === 'choice') {
        input.add(new Option('Seleccionar…', ''));
        for (const option of field.options) input.add(new Option(option.label, option.label));
      } else if (field.type === 'text') { input.rows = 1; input.maxLength = 2000; }
      else { input.type = field.type === 'positive-integer' ? 'number' : field.type; if (input.type === 'number') { input.min = '1'; input.max = '999999'; input.step = '1'; } }
      input.name = field.id; input.value = state.answers[field.id] || '';
      input.addEventListener('input', () => { state.answers[field.id] = input.value; validate(); });
      label.append(input); container.append(label);
    }
    function validate() {
      for (const field of template.fields) {
        const input = container.querySelector('[name="' + CSS.escape(field.id) + '"]');
        input.required = Boolean(field.required || (field.requiredWhen && state.answers[field.requiredWhen.field] === field.requiredWhen.equals));
      }
    }
    validate();
  }
  function render(state) {
    if (!dialog || !current(state)) return;
    if (state.record) { void showReceipt(state); return; }
    const form = dialog.querySelector('form');
    const label = make('label', 'Plantilla');
    const select = make('select'); label.append(select);
    for (const item of state.catalog.templates) select.add(new Option(item.title, item.id));
    if (!select.options.length) { status('HHR no tiene plantillas disponibles.'); return; }
    select.value = state.templateId || select.options[0].value;
    const fields = make('div'); fields.className = 'fields';
    const save = make('button', 'Guardar e insertar'); save.type = 'submit';
    const group = make('fieldset'); group.style.cssText = 'margin:0;padding:0;border:0;display:grid;gap:8px';
    group.append(label, fields, save); form.replaceChildren(group);
    function selectTemplate() {
      if (state.templateId !== select.value) { state.templateId = select.value; state.answers = {}; }
      fieldsFor(state, state.catalog.templates.find(t => t.id === state.templateId), fields);
    }
    select.addEventListener('change', () => {
      if (Object.values(state.answers).some(Boolean) && !window.confirm('¿Descartar las respuestas de esta plantilla?')) { select.value = state.templateId; return; }
      selectTemplate();
    });
    selectTemplate();
    dialog.querySelector('.identity').textContent = state.catalog.patientName + ' · ' + state.catalog.document + ' · Registra en HHR: ' + state.catalog.authorName;
    status('');
    form.onsubmit = event => event.preventDefault();
    save.addEventListener('click', async event => {
      event.preventDefault();
      if (!event.isTrusted || !navigator.userActivation.isActive || state.busy || !current(state) || !form.reportValidity()) return;
      state.busy = true; group.disabled = true; status('Guardando en HHR…');
      try {
        const template = state.catalog.templates.find(item => item.id === state.templateId);
        const { record } = await call(state, { action: 'apply', code: state.code, uid: state.catalog.uid, templateId: template.id, version: template.version, answers: state.answers });
        if (record?.code !== state.code || record.patient?.episode !== state.episode || record.authorUid !== state.catalog.uid || !record.evolution)
          throw new Error('No se pudo comprobar el recibo de HHR.');
        state.record = record; await showReceipt(state);
      } catch (error) { if (current(state)) status(error.message + '\nCódigo de esta aplicación: ' + state.code); }
      finally { state.busy = false; group.disabled = false; }
    });
  }
  async function open() {
    const episode = route();
    if (!enabled || !episode || dialog?.open) return;
    if (!session || session.episode !== episode) session = { episode, code: 'PT-' + crypto.randomUUID().toUpperCase(), answers: {} };
    const state = session;
    dialog = make('dialog'); dialog.className = 'hhr-checklist-dialog'; dialog.dataset.hhrChecklist = chrome.runtime.id;
    dialog.setAttribute('aria-labelledby', 'hhr-checklist-heading');
    const header = make('header'); const heading = make('h2', 'Aplicar pauta'); heading.id = 'hhr-checklist-heading';
    const dismiss = button('Cerrar', close); header.append(heading, dismiss);
    const who = make('p'); who.className = 'identity';
    const feedback = make('p'); feedback.setAttribute('role', 'status');
    const form = make('form');
    dialog.append(header, who, form, feedback); document.body.append(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.showModal();
    const surface = dialog;
    if (state.record) {
      try {
        await verifyChart(state);
        if (dialog === surface) await showReceipt(state);
      } catch (error) { if (dialog === surface) status(error.message); }
      return;
    }
    status('Cargando plantillas…');
    try {
      const catalog = await call(state, { action: 'templates' });
      if (dialog !== surface) return;
      const previous = state.catalog;
      if (previous && (previous.uid !== catalog.uid || previous.actor !== catalog.actor || previous.document !== catalog.document)) {
        session = null; insertedReceipt = null; close(); refresh(); await open(); return;
      }
      if (state.templateId && previous) {
        const revision = list => list.templates.find(t => t.id === state.templateId)?.version;
        if (revision(previous) !== revision(catalog)) {
          status('Cambió la plantilla. Puedes revisar las respuestas del borrador antes de empezar de nuevo.');
          const draft = make('p', previous.templates.find(t => t.id === state.templateId).fields
            .filter(field => state.answers[field.id]).map(field => field.label + ': ' + state.answers[field.id]).join('\n'));
          draft.style.whiteSpace = 'pre-wrap';
          form.replaceChildren(draft, button('Empezar con la nueva versión', () => { session = null; close(); void open(); }));
          return;
        }
      }
      state.catalog = catalog; render(state);
    }
    catch (error) {
      if (dialog !== surface || !current(state)) return;
      status(error.message);
      const link = make('a', 'Abrir HHR'); link.href = 'https://hhr-hospitalizados.app/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
      form.replaceChildren(link, button('Reintentar', () => { close(); void open(); }));
    }
  }
  function refresh() {
    const episode = route();
    if (!enabled || (session && session.episode !== episode)) { session = null; close(); }
    if (!enabled || insertedReceipt?.episode !== episode) insertedReceipt = null;
    const nativeDialog = [...document.querySelectorAll('dialog[open],[role=dialog]')].filter(el => !el.closest('[data-hhr-checklist],[hidden],[inert],[aria-hidden="true"]') && el.getClientRects().length).find(evo.evolutionDialog);
    const host = enabled && route() && (nativeDialog || document.getElementById('observationEntrySection'));
    if (!host) { trigger?.remove(); trigger = null; return; }
    if (!trigger) { trigger = button('Aplicar pauta', open); trigger.className = 'hhr-checklist-trigger'; trigger.dataset.hhrChecklist = chrome.runtime.id; }
    if (trigger.parentElement !== host) host.append(trigger);
    const editor = insertedReceipt && evo.editor();
    const inserted = editor && (editor.value ?? editor.innerText ?? '').includes(insertedReceipt.code);
    const text = session?.record ? 'Insertar pauta guardada' : inserted ? 'Pauta insertada · guardar en Eloísa' : 'Aplicar pauta';
    if (trigger.textContent !== text) trigger.textContent = text;
    trigger.title = inserted ? 'Aplicar otra pauta' : '';
  }
  const observer = new MutationObserver(() => {
    if (!enabled || scheduled) return;
    scheduled = true; requestAnimationFrame(() => { scheduled = false; refresh(); });
  });
  function display(on) {
    enabled = on === true;
    observer.disconnect();
    if (enabled) observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden', 'inert'] });
    refresh();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, key)) { persistedRevision++; display(changes[key].newValue); }
  });
  const revision = persistedRevision;
  void chrome.storage.local.get(key).then(data => { if (revision === persistedRevision) display(data[key]); }).catch(() => {});
  window.addEventListener('popstate', refresh);
})();
