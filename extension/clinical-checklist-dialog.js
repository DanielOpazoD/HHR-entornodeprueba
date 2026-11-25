(() => {
  'use strict';
  if (globalThis.hhrClinicalChecklistDialogInstalled) return;
  globalThis.hhrClinicalChecklistDialogInstalled = true;
  document.querySelectorAll('[data-hhr-checklist="' + chrome.runtime.id + '"]').forEach(el => el.remove());

  const key = 'hhr-clinical-checklists-enabled';
  const route = () => globalThis.HhrPrescriptionPrint.resolveEncounterId(location.href);
  const evo = globalThis.HhrChecklistEvolution;
  const braden = globalThis.HhrChecklistBraden;
  let enabled = false,
    trigger,
    bradenTrigger,
    dialog,
    session,
    insertedReceipt,
    scheduled = false,
    persistedRevision = 0;

  const make = (tag, text) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    return el;
  };
  const button = (text, click, className = '') => {
    const el = make('button', text);
    el.type = 'button';
    if (className) el.className = className;
    el.addEventListener('click', click);
    return el;
  };
  const current = state => enabled && state === session && route() === state.episode;
  const nextFrame = () =>
    typeof requestAnimationFrame === 'function'
      ? new Promise(resolve => requestAnimationFrame(() => resolve()))
      : Promise.resolve();

  async function call(state, request) {
    const result = await chrome.runtime.sendMessage({
      type: 'RAYEN_CLINICAL_CHECKLIST',
      encId: state.episode,
      request,
      ...(state.catalog
        ? { actor: state.catalog.actor, document: state.catalog.document, hhrTabId: state.catalog.hhrTabId }
        : {}),
    });
    if (!current(state)) throw new Error('Cambió la ficha.');
    if (!result || result.error) throw new Error(result?.error || 'HHR no confirmó la operación.');
    return result;
  }

  function close() {
    if (!dialog) return;
    const old = dialog;
    dialog = null;
    old.close();
    old.remove();
  }

  function status(text) {
    const area = dialog?.querySelector('[role=status]');
    if (area) area.textContent = text;
  }

  async function verifyChart(state) {
    const header = await call(state, { action: 'verify' });
    if (
      !current(state) ||
      header.episode !== state.episode ||
      header.actor !== state.catalog.actor ||
      header.document !== state.catalog.document
    ) {
      throw new Error('Reabre la ficha del mismo paciente con la sesión que aplicó la pauta.');
    }
  }

  async function transcribe(state) {
    const previousDialog = dialog;
    const active = () => current(state) && dialog === previousDialog && previousDialog?.isConnected;
    await verifyChart(state);
    if (!active()) return false;
    previousDialog.close();
    await nextFrame();
    let inserted = false;
    try {
      if (!evo.editor()) {
        if (!(await evo.openEditor(active))) return false;
        await verifyChart(state);
      }
      if (active()) inserted = evo.insert(state.record);
    } finally {
      if (!inserted && active() && !previousDialog.open) previousDialog.showModal();
    }
    if (!inserted) return false;
    insertedReceipt = { episode: state.episode, code: state.record.code };
    session = null;
    close();
    refresh();
    trigger?.focus();
    return true;
  }

  async function copyEvolutionText(text) {
    if (!text) return false;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }

  async function showReceipt(state, options = {}) {
    if (!dialog || !current(state)) return;
    dialog.classList.remove('is-matrix');
    const content = dialog.querySelector('form');
    content.replaceChildren();
    const code = make('p', state.record.code);
    code.className = 'hhr-checklist-code';
    const preview = make('pre', state.record.evolution);
    preview.className = 'hhr-checklist-preview';
    const actions = make('div');
    actions.className = 'hhr-checklist-actions';
    const insert = button(
      'Insertar en evolución',
      async () => {
        insert.disabled = true;
        try {
          if (!(await transcribe(state))) {
            status('Abre el editor de una evolución en Eloísa y pulsa «Insertar en evolución», o usa «Copiar texto».');
          }
        } catch (error) {
          status(error.message);
        } finally {
          insert.disabled = false;
        }
      },
      'is-primary'
    );
    const copy = button('Copiar texto', async () => {
      try {
        if (await copyEvolutionText(state.record.evolution)) {
          status('Texto copiado. Pégalo en la evolución de Eloísa y guarda allí.');
        } else {
          status('Selecciona el texto de arriba para copiarlo en la evolución.');
        }
      } catch {
        status('Selecciona el texto de arriba para copiarlo en la evolución.');
      }
    });
    actions.append(insert, copy);
    content.append(code, preview, actions);

    if (options.copyOnly) {
      try {
        const copied = await copyEvolutionText(state.record.evolution);
        status(
          copied
            ? 'Guardada en HHR y texto copiado. Pégalo en la evolución de Eloísa o pulsa «Insertar en evolución».'
            : 'Guardada en HHR. Selecciona el texto de arriba para copiarlo o pulsa «Insertar en evolución».'
        );
      } catch {
        status('Guardada en HHR. Selecciona el texto de arriba para copiarlo o pulsa «Insertar en evolución».');
      }
      return;
    }

    status('Guardada en HHR. Insertando en la evolución de este episodio…');
    insert.disabled = true;
    try {
      if (!(await transcribe(state)) && dialog?.isConnected) {
        status('Guardada en HHR. Abre la evolución en Eloísa y pulsa «Insertar en evolución», o usa «Copiar texto».');
      }
    } catch (error) {
      status(error.message);
    } finally {
      insert.disabled = false;
    }
  }

  function createFieldInput(state, field, onChange) {
    const input = field.type === 'choice' ? make('select') : field.type === 'text' ? make('textarea') : make('input');
    if (field.type === 'choice') {
      input.add(new Option('Seleccionar…', ''));
      for (const option of field.options) input.add(new Option(option.label, option.label));
    } else if (field.type === 'text') {
      input.rows = 2;
      input.maxLength = 2000;
    } else {
      input.type = field.type === 'positive-integer' ? 'number' : field.type;
      if (input.type === 'number') {
        input.min = '1';
        input.max = '999999';
        input.step = '1';
      }
    }
    input.name = field.id;
    input.value = state.answers[field.id] || '';
    input.addEventListener('input', () => {
      state.answers[field.id] = input.value;
      onChange();
    });
    return input;
  }

  function fieldsFor(state, template, container) {
    container.replaceChildren();
    const validate = () => {
      for (const field of template.fields) {
        const input = container.querySelector('[name="' + CSS.escape(field.id) + '"]');
        if (input) {
          input.required = Boolean(
            field.required || (field.requiredWhen && state.answers[field.requiredWhen.field] === field.requiredWhen.equals)
          );
        }
      }
    };
    for (const field of template.fields) {
      const label = make('label', field.label);
      label.append(createFieldInput(state, field, validate));
      container.append(label);
    }
    validate();
  }

  function showVersionChanged(state, previous, form) {
    status('Cambió la plantilla en HHR. Revisa tu borrador antes de empezar con la versión nueva.');
    const oldTemplate = previous.templates.find(t => t.id === state.templateId);
    const summary = (oldTemplate?.fields || [])
      .filter(field => state.answers[field.id])
      .map(field => field.label + ': ' + state.answers[field.id])
      .join('\n');
    const draft = make('p', summary);
    draft.style.whiteSpace = 'pre-wrap';
    form.replaceChildren(
      draft,
      button('Empezar con la nueva versión', () => {
        session = null;
        close();
        void open();
      })
    );
  }

  async function syncCatalog(state, surface) {
    status('Sincronizando plantillas desde HHR…');
    const catalog = await call(state, { action: 'templates' });
    if (dialog !== surface) return false;
    const previous = state.catalog;
    if (previous && (previous.uid !== catalog.uid || previous.actor !== catalog.actor || previous.document !== catalog.document)) {
      session = null;
      insertedReceipt = null;
      close();
      refresh();
      await open(state.preferredMode);
      return false;
    }
    if (state.templateId && previous) {
      const revision = list => list.templates.find(t => t.id === state.templateId)?.version;
      if (revision(previous) !== revision(catalog)) {
        showVersionChanged(state, previous, dialog.querySelector('form'));
        return false;
      }
    }
    state.catalog = catalog;
    render(state);
    return true;
  }

  function missingRequiredDimension(template, answers) {
    if (!braden?.isBradenTemplate(template)) return null;
    for (const field of template.fields || []) {
      if (field.required && !String(answers[field.id] || '').trim()) return field.label;
    }
    return null;
  }

  function initialTemplateId(state) {
    const list = state.catalog.templates;
    if (state.templateId && list.some(t => t.id === state.templateId)) return state.templateId;
    if (state.preferredMode === 'braden' && braden) {
      const suggested = braden.suggestBradenTemplate(list, state.catalog);
      if (suggested.templateId) return suggested.templateId;
    }
    return list[0].id;
  }

  async function submitApplication(state, group, form, { copyOnly }) {
    const template = state.catalog.templates.find(item => item.id === state.templateId);
    const missing = missingRequiredDimension(template, state.answers);
    if (missing) {
      status('Completa primero: ' + missing + '.');
      return;
    }
    if (!form.reportValidity()) return;
    state.busy = true;
    group.disabled = true;
    status('Guardando en HHR…');
    try {
      const { record } = await call(state, {
        action: 'apply',
        code: state.code,
        uid: state.catalog.uid,
        templateId: template.id,
        version: template.version,
        answers: state.answers,
      });
      if (record?.code !== state.code || record.patient?.episode !== state.episode || record.authorUid !== state.catalog.uid || !record.evolution) {
        throw new Error('No se pudo comprobar el recibo de HHR.');
      }
      state.record = record;
      await showReceipt(state, { copyOnly });
    } catch (error) {
      if (current(state)) status(error.message + '\nCódigo de esta aplicación: ' + state.code);
    } finally {
      state.busy = false;
      group.disabled = false;
    }
  }

  function render(state) {
    if (!dialog || !current(state)) return;
    if (state.record) {
      void showReceipt(state);
      return;
    }
    const form = dialog.querySelector('form');
    const label = make('label', 'Plantilla');
    const select = make('select');
    label.append(select);
    for (const item of state.catalog.templates) select.add(new Option(item.title, item.id));
    if (!select.options.length) {
      status('HHR no tiene plantillas disponibles.');
      return;
    }
    select.value = initialTemplateId(state);

    const templateRow = make('div');
    templateRow.className = 'hhr-checklist-template-row';
    const versionBadge = make('span');
    versionBadge.className = 'hhr-checklist-version';
    const syncBtn = button('Sincronizar plantillas', async () => {
      if (state.busy || !current(state)) return;
      syncBtn.disabled = true;
      const surface = dialog;
      try {
        await syncCatalog(state, surface);
      } catch (error) {
        if (dialog === surface && current(state)) status(error.message);
      } finally {
        syncBtn.disabled = false;
      }
    });
    templateRow.append(versionBadge, syncBtn);

    const fields = make('div');
    fields.className = 'fields';
    const actions = make('div');
    actions.className = 'hhr-checklist-actions';
    const save = make('button', 'Guardar e insertar');
    save.type = 'submit';
    const saveAndCopy = button('Guardar en HHR y copiar texto', async event => {
      if (!event.isTrusted || !navigator.userActivation.isActive || state.busy || !current(state)) return;
      await submitApplication(state, group, form, { copyOnly: true });
    });
    actions.append(save, saveAndCopy);

    const group = make('fieldset');
    group.style.cssText = 'margin:0;padding:0;border:0;display:grid;gap:10px';
    group.append(label, templateRow, fields, actions);
    form.replaceChildren(group);

    const bradenList = braden ? state.catalog.templates.filter(braden.isBradenTemplate) : [];
    const suggestion = braden ? braden.suggestBradenTemplate(state.catalog.templates, state.catalog) : { templateId: null, reason: '' };

    const handleInlineCopy = async text => {
      try {
        if (await copyEvolutionText(text)) {
          status('Texto copiado para pegar en la evolución. Usa «Guardar en HHR y copiar texto» o «Guardar e insertar» para respaldar en HHR.');
        } else {
          status('Selecciona el texto de la vista previa para copiarlo.');
        }
      } catch {
        status('Selecciona el texto de la vista previa para copiarlo.');
      }
    };

    const selectTemplate = () => {
      if (state.templateId !== select.value) {
        state.templateId = select.value;
        state.answers = {};
      }
      const chosen = state.catalog.templates.find(t => t.id === state.templateId);
      const isMatrix = Boolean(braden?.isBradenTemplate(chosen));
      dialog?.classList.toggle('is-matrix', isMatrix);
      versionBadge.textContent = chosen
        ? (chosen.ageRangeLabel ? chosen.ageRangeLabel + ' · ' : '') + 'Plantilla v' + chosen.version + ' · sincronizada con HHR'
        : '';
      if (isMatrix) {
        braden.renderMatrix({
          container: fields,
          template: chosen,
          bradenTemplates: bradenList,
          suggestedId: suggestion.templateId,
          suggestedReason: suggestion.reason,
          answers: state.answers,
          authorName: state.catalog.authorName,
          onSwitchTemplate: nextId => {
            select.value = nextId;
            selectTemplate();
          },
          onAnswerChange: () => status(''),
          onCopyText: handleInlineCopy,
        });
      } else {
        fieldsFor(state, chosen, fields);
      }
    };
    select.addEventListener('change', () => {
      const answered = Object.entries(state.answers).some(
        ([fieldId, val]) => Boolean(val) && fieldId !== 'fecha' && fieldId !== 'hora'
      );
      if (answered && !window.confirm('¿Descartar las respuestas de esta plantilla?')) {
        select.value = state.templateId;
        return;
      }
      selectTemplate();
    });
    selectTemplate();
    const ageLabel = state.catalog.patientAge ? ' · ' + state.catalog.patientAge : '';
    dialog.querySelector('.identity').textContent =
      state.catalog.patientName + ' · ' + state.catalog.document + ageLabel + ' · Registra en HHR: ' + state.catalog.authorName;
    status('');
    form.onsubmit = event => event.preventDefault();
    save.addEventListener('click', async event => {
      event.preventDefault();
      if (!event.isTrusted || !navigator.userActivation.isActive || state.busy || !current(state)) return;
      await submitApplication(state, group, form, { copyOnly: false });
    });
  }

  function showLoadFailure(form, message) {
    status(message);
    const actions = make('div');
    actions.className = 'hhr-checklist-actions';
    const link = make('a', 'Abrir HHR');
    link.href = 'https://hhr-hospitalizados.app/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(
      link,
      button('Reintentar', () => {
        const mode = session?.preferredMode;
        close();
        void open(mode);
      })
    );
    form.replaceChildren(actions);
  }

  async function open(preferredMode = null) {
    const episode = route();
    if (!enabled || !episode || dialog?.open) return;
    const nativeDialogs = evo.dialogs();
    if (nativeDialogs.some(evo.templateDialog)) return;
    const nativeEditor = nativeDialogs.find(evo.evolutionDialog);
    if (!session || session.episode !== episode) {
      session = { episode, code: 'PT-' + crypto.randomUUID().toUpperCase(), answers: {}, preferredMode };
    } else if (!session.record && preferredMode) {
      session.preferredMode = preferredMode;
      if (preferredMode === 'braden' && stateHasNoAnswers(session)) session.templateId = null;
    }
    const state = session;
    dialog = make('dialog');
    dialog.className = 'hhr-checklist-dialog';
    dialog.classList.toggle('is-matrix', preferredMode === 'braden');
    dialog.dataset.hhrChecklist = chrome.runtime.id;
    dialog.setAttribute('aria-labelledby', 'hhr-checklist-heading');
    const header = make('header');
    const heading = make('h2', 'Aplicar pauta');
    heading.id = 'hhr-checklist-heading';
    header.append(heading, button('Cerrar', close));
    const who = make('p');
    who.className = 'identity';
    const feedback = make('p');
    feedback.setAttribute('role', 'status');
    const form = make('form');
    dialog.append(header, who, form, feedback);
    // Keep keyboard focus inside the native editor's modal boundary.
    (nativeEditor || document.body).append(dialog);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') event.stopPropagation();
    });
    dialog.addEventListener('cancel', e => {
      e.preventDefault();
      close();
    });
    dialog.showModal();
    const surface = dialog;
    if (state.record) {
      try {
        await verifyChart(state);
        if (dialog === surface) await showReceipt(state);
      } catch (error) {
        if (dialog === surface) status(error.message);
      }
      return;
    }
    try {
      await syncCatalog(state, surface);
    } catch (error) {
      if (dialog === surface && current(state)) showLoadFailure(form, error.message);
    }
  }

  const stateHasNoAnswers = state =>
    !Object.entries(state.answers || {}).some(([id, value]) => Boolean(value) && id !== 'fecha' && id !== 'hora');

  function removeTriggers() {
    trigger?.remove();
    trigger = null;
    bradenTrigger?.remove();
    bradenTrigger = null;
  }

  function refresh() {
    const episode = route();
    if (!enabled || (session && session.episode !== episode)) {
      session = null;
      close();
    }
    if (!enabled || insertedReceipt?.episode !== episode) insertedReceipt = null;
    if (dialog && !dialog.isConnected) close();
    if (dialog?.open) return;
    const nativeDialogs = evo.dialogs();
    // A portal such as Plantillas can temporarily hide Evolución with aria-hidden.
    if (enabled && episode && nativeDialogs.some(evo.templateDialog)) return;
    const nativeDialog = nativeDialogs.find(evo.evolutionDialog);
    const host = enabled && episode ? evo.resolveTriggerHost(nativeDialog) : null;
    if (!host) {
      if (enabled && episode && trigger?.isConnected && trigger.closest('[inert],[aria-hidden="true"]')) return;
      removeTriggers();
      return;
    }
    if (!trigger) {
      trigger = button('Aplicar pauta', () => void open(null), 'hhr-checklist-trigger');
      trigger.dataset.hhrChecklist = chrome.runtime.id;
    }
    if (trigger.parentElement !== host) host.append(trigger);
    if (!bradenTrigger && braden) {
      bradenTrigger = button('Pauta Braden', () => void open('braden'), 'hhr-checklist-braden-trigger');
      bradenTrigger.dataset.hhrChecklist = chrome.runtime.id;
      bradenTrigger.title = 'Valoración rápida Braden adulto / Braden Q (NT 234)';
    }
    if (bradenTrigger && bradenTrigger.parentElement !== host) host.append(bradenTrigger);
    const activeEditor = insertedReceipt && evo.editor();
    const inserted = Boolean(activeEditor && String(activeEditor.value ?? activeEditor.innerText ?? '').includes(insertedReceipt.code));
    const text = session?.record ? 'Insertar pauta guardada' : inserted ? 'Pauta insertada · guardar en Eloísa' : 'Aplicar pauta';
    if (trigger.textContent !== text) trigger.textContent = text;
    trigger.title = inserted ? 'Aplicar otra pauta' : '';
  }

  const observer = new MutationObserver(() => {
    if (!enabled || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  });

  function display(on) {
    enabled = on === true;
    observer.disconnect();
    if (enabled) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'aria-hidden', 'inert'],
      });
    }
    refresh();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, key)) {
      persistedRevision++;
      display(changes[key].newValue);
    }
  });
  const revision = persistedRevision;
  void chrome.storage.local
    .get(key)
    .then(data => {
      if (revision === persistedRevision) display(data[key]);
    })
    .catch(() => {});
  window.addEventListener('popstate', refresh);
})();
