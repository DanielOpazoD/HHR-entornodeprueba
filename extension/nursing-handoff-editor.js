(() => {
  'use strict';
  const id = location.hash.slice(1);
  const byId = id => document.getElementById(id);
  const edit = byId('edit');
  const note = byId('note');
  const conflict = byId('conflict');
  const comparisonPanel = byId('comparison');
  const comparisonNote = byId('comparison-note');
  const status = byId('status');
  const discard = byId('discard');
  const save = byId('save');
  const connect = byId('connect');
  const disconnect = byId('disconnect');
  const currentShift = byId('current-shift');
  const recovery = byId('recovery');
  const recoveryText = byId('recovery-text');
  const recoveryVersions = byId('recovery-versions');
  const recovered = [];
  const restoreDraft = byId('restore-draft');
  const slotDate = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  });
  let slot;
  let base;
  let pendingVersion;
  let remote;
  let saving = false;
  let ended = false;
  let available = false;
  let ready = false;
  let hosted = false;
  let inline = false;
  let rowVisible = true;
  let refresh;
  let draftVersion;
  let reportedState;
  let tableView;
  let comparison;
  let linkRequired = false;
  let polling = 0;
  const dirty = () => base && note.value !== base.text.replace(/\r\n?/g, '\n');
  const show = (text, tone = '') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };
  const pinSlot = value => {
    if (slot || !/^\d{4}-\d{2}-\d{2}$/.test(value?.date) ||
        !['day', 'night'].includes(value.shift)) return;
    const { date, shift } = value;
    slot = { date, shift };
    const label = slotDate.format(new Date(date + 'T00:00:00Z')).replaceAll('.', '');
    const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
    byId('slot').textContent = capitalized + ' · ' + (shift === 'day' ? 'Día' : 'Noche');
    byId('slot').title = date;
  };
  const send = (action, data = {}) => chrome.runtime.sendMessage({
    type: HhrRayenMessageContract.types.NURSING_HANDOFF_EDITOR, id, action, ...data,
  }).catch(() => ({ error: 'Se perdió la conexión con la extensión.', code: 'UNAVAILABLE' }));
  const saveDraft = () => {
    if (!inline || !base) return;
    void send('draft', { ...slot, version: draftVersion, text: dirty() ? note.value : undefined });
  };

  const comparing = () => inline && slot && tableView?.selected && tableView.selected !== slot.shift;
  const showComparison = () => {
    const active = Boolean(comparing());
    document.body.toggleAttribute('data-comparing', active);
    comparisonPanel.hidden = !active;
    if (active) {
      const present = comparison?.shift === tableView.selected;
      comparisonNote.value = present ? comparison.text : '';
      comparisonNote.placeholder = present ? 'Sin entrega' : 'Entrega aún no disponible';
    }
  };
  const rowMessage = (type, value) => window.parent.postMessage({ type, value }, 'https://fichamedico.rayensalud.cl');
  const updateButtons = () => {
    const changed = Boolean(dirty());
    save.hidden = inline || edit.hidden;
    save.disabled = saving || !available || !ready || Boolean(remote) || !changed || Boolean(comparing());
    disconnect.disabled = saving;
    note.readOnly = saving || ended;
    if (inline) {
      const state = { dirty: changed, canSave: !save.disabled, editable: ready && available && !edit.hidden && !note.readOnly && !comparing(), conflict: Boolean(remote), slot };
      const signature = JSON.stringify(state);
      if (reportedState !== signature) {
        reportedState = signature;
        rowMessage('hhr-handoff-row-state', state);
      }
    }
  };
  const close = () => window.parent.postMessage('hhr-nursing-handoff-close', 'https://fichamedico.rayensalud.cl');
  const requestClose = () => {
    if (saving) return;
    if (!dirty()) {
      close();
      return;
    }
    discard.hidden = false;
    byId('continue').focus();
  };
  byId('close').addEventListener('click', requestClose);
  byId('confirm-close').addEventListener('click', close);
  byId('continue').addEventListener('click', () => {
    discard.hidden = true;
    note.focus();
  });
  document.addEventListener('keydown', event => {
    if (!inline && event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    }
  });
  note.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      if (!save.disabled) void submitNote();
    }
  });
  const accept = (value, text = value.text) => {
    pinSlot(value);
    base = value;
    draftVersion = value.version;
    pendingVersion = value.version;
    remote = undefined;
    conflict.hidden = true;
    note.value = text;
    edit.hidden = false;
    updateButtons();
  };
  const showDraft = () => show(dirty() ? 'Borrador sin guardar' : '', dirty() ? 'draft' : '');
  const selectedRecovery = () => recovered[Number(recoveryVersions.value)];
  const showRecovery = () => {
    const version = selectedRecovery();
    if (!version) return;
    recoveryText.value = version.text;
    restoreDraft.hidden = ended || version.slot !== slot || !version.canRestore;
  };
  const preserveText = (label, text, canRestore) => {
    const index = recovered.findIndex(entry => entry.slot === slot && entry.text === text);
    if (index >= 0) recovered.splice(index, 1);
    recovered.unshift({ label, text, canRestore, slot });
    recoveryVersions.replaceChildren(...recovered.map((entry, position) => new Option(entry.label, position)));
    recoveryVersions.hidden = recovered.length < 2;
    byId('recovery-label').textContent = recovered.length === 1 ? label : 'Textos conservados (' + recovered.length + ')';
    recovery.open = false;
    recovery.hidden = false;
    showRecovery();
  };
  const clearRecovery = () => {
    recovered.length = 0;
    recoveryVersions.replaceChildren();
    recoveryText.value = '';
    recovery.hidden = true;
  };
  const reportLink = required => {
    if (!inline || required === linkRequired) return;
    linkRequired = required;
    window.parent.postMessage({ type: 'hhr-handoff-row-link', value: required }, 'https://fichamedico.rayensalud.cl');
  };
  recoveryVersions.addEventListener('change', showRecovery);
  const raise = result => {
    const needsLink = result.code === 'HHR_LINK_REQUIRED';
    if (result.registration) connect.textContent = 'Registrar equipo';
    reportLink(needsLink);
    if (needsLink) {
      ready = false;
      disconnect.hidden = true;
      connect.hidden = inline;
    }
    if (['UNAUTHENTICATED', 'PERMISSION_DENIED', 'SOURCE_SESSION_CHANGED'].includes(result.code)) {
      available = false;
      edit.hidden = conflict.hidden = true;
      connect.hidden = disconnect.hidden = true;
      byId('patient').textContent = '';
      byId('slot').textContent = '';
      clearRecovery();
      comparison = undefined;
      showComparison();
    }
    if (result.code === 'FAILED_PRECONDITION') {
      available = false;
      ended = Boolean(slot && /^Cambió el turno/i.test(result.error));
      currentShift.hidden = !ended;
      restoreDraft.hidden = true;
      if (ended) {
        show(dirty() ? 'Cambió el turno. Tu borrador pertenece al turno anterior.' : 'Cambió el turno.', 'draft');
        updateButtons();
        return;
      }
    }
    if (result.code === 'NOT_FOUND') {
      pinSlot(result.slot);
      ready = false;
    }
    if (inline && needsLink) showDraft();
    else show(result.error, 'error');
    updateButtons();
  };
  const notifyRemote = value => {
    remote = value;
    byId('remote').value = value.text;
    conflict.hidden = false;
    show('Hay cambios en HHR. Revisa ambas versiones antes de guardar.', 'error');
    updateButtons();
  };

  async function follow(generation, wait = false) {
    if (generation !== polling || !available || (inline && (!rowVisible || document.hidden))) return;
    const result = await send('read', { ...slot, since: wait ? pendingVersion : undefined });
    if (generation !== polling) return;
    if (result.error) {
      raise(result);
      if (available) refresh = setTimeout(() => void follow(generation), inline ? 12000 : 2000);
      return;
    }
    ready = true;
    if (inline) comparison = result.comparison;
    reportLink(false);
    connect.hidden = true;
    disconnect.hidden = !hosted;
    if (!base && inline && result.draft) {
      accept(result, result.draft.text);
      if (dirty()) {
        draftVersion = result.draft.version;
        if (draftVersion !== result.version) notifyRemote(result);
        else show('Borrador recuperado', 'draft');
      } else saveDraft();
      updateButtons();
    } else if (pendingVersion !== result.version) {
      pendingVersion = result.version;
      if (dirty() && note.value !== result.text.replace(/\r\n?/g, '\n')) notifyRemote(result);
      else {
        accept(result);
        show(inline ? '' : 'Nota al día');
      }
    } else {
      edit.hidden = false;
      conflict.hidden = !remote;
      if (status.dataset.tone === 'error' && !remote) showDraft();
      updateButtons();
    }
    showComparison();
    scheduleFollow(generation);
  }

  function scheduleFollow(generation) {
    if (!inline || document.activeElement === note) void follow(generation, true);
    else refresh = setTimeout(() => void follow(generation), 30000 + Math.random() * 10000);
  }

  const resumeRow = () => {
    if (inline && rowVisible && available && !saving) {
      clearTimeout(refresh);
      void follow(++polling);
    }
  };
  window.addEventListener('message', async event => {
    if (!inline || event.source !== window.parent || event.origin !== 'https://fichamedico.rayensalud.cl') return;
    const { type, value } = event.data || {};
    if (type === 'hhr-handoff-row-shift' && ['day', 'night'].includes(value?.selected) &&
        ['day', 'night'].includes(value?.slot?.shift) && /^\d{4}-\d{2}-\d{2}$/.test(value?.slot?.date)) {
      tableView = value;
      if (slot && (value.slot.date !== slot.date || value.slot.shift !== slot.shift)) {
        if (!saving && available) loadCurrentShift();
      }
      showComparison();
      updateButtons();
    }
    if (type === 'hhr-handoff-row-save' && typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)) {
      const outcome = await submitNote(value);
      rowMessage('hhr-handoff-row-saved', { ticket: value, outcome });
    }
    if (type === 'hhr-handoff-row-review') {
      const target = !conflict.hidden ? byId('remote') : !edit.hidden ? note : status;
      if (target === status) status.tabIndex = -1;
      target.focus();
    }
    if (type === 'hhr-handoff-row-visible') {
      const visible = event.data.value === true;
      if (visible !== rowVisible) {
        rowVisible = visible;
        if (visible) resumeRow();
        else clearTimeout(refresh);
      }
    }
  });
  note.addEventListener('focus', resumeRow);
  note.addEventListener('input', () => {
    if (!remote) showDraft();
    updateButtons();
    saveDraft();
  });
  connect.addEventListener('click', async () => {
    connect.disabled = true;
    try {
      const result = await send('connect');
      if (result.error) show(result.error, 'error');
    } finally {
      connect.disabled = false;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && inline) resumeRow();
    else if (document.visibilityState === 'visible' && !connect.hidden && available && !saving) {
      void follow(++polling);
    }
  });
  disconnect.addEventListener('click', async () => {
    if (saving) return;
    const generation = ++polling;
    disconnect.hidden = true;
    ready = false;
    updateButtons();
    show('Desconectando…');
    const result = await send('disconnect');
    raise(result.error ? result : {
      code: 'HHR_LINK_REQUIRED',
      error: dirty() ? 'Desconectado. Tu nota sigue abierta.' :
        result.remoteConfirmed === false ? 'Desconectado en este navegador.' : 'Desconectado de HHR.',
    });
    if (available) setTimeout(() => void follow(generation), 2000);
  });
  byId('keep').addEventListener('click', () => {
    if (!remote || ended || !available) return;
    preserveText('Versión de HHR conservada', remote.text, true);
    accept(remote, note.value);
    saveDraft();
    showDraft();
    note.focus();
  });
  byId('use-remote').addEventListener('click', () => {
    if (!remote || ended || !available) return;
    preserveText('Mi borrador conservado', note.value, true);
    accept(remote);
    saveDraft();
    show('Nota al día');
    note.focus();
  });
  restoreDraft.addEventListener('click', () => {
    const version = selectedRecovery();
    if (ended || !available || saving || remote || !version?.canRestore || version.slot !== slot) return;
    const text = version.text;
    preserveText('Texto antes de recuperar', note.value, true);
    note.value = text;
    saveDraft();
    updateButtons();
    showDraft();
    note.focus();
  });
  function loadCurrentShift() {
    if (!slot || saving) return;
    clearTimeout(refresh);
    if (dirty()) preserveText('Borrador · ' + byId('slot').textContent, note.value, false);
    currentShift.hidden = conflict.hidden = edit.hidden = true;
    byId('slot').textContent = '';
    byId('slot').removeAttribute('title');
    note.value = '';
    base = slot = remote = pendingVersion = draftVersion = comparison = undefined;
    ended = false;
    available = true;
    ready = false;
    showComparison();
    updateButtons();
    show(inline ? '' : 'Cargando turno vigente…', 'pending');
    void follow(++polling);
  }
  currentShift.addEventListener('click', () => { if (ended) loadCurrentShift(); });

  async function submitNote(ticket) {
    if (save.disabled) return 'review';
    clearTimeout(refresh);
    ++polling;
    saving = true;
    updateButtons();
    show('Guardando…', 'pending');
    const { date, shift, version } = base;
    const result = await send('save', { date, shift, version, text: note.value, ticket });
    saving = false;
    if (result.confirmed && result.error) {
      raise(result);
      show('✓ HHR guardó la entrega. Vuelve a abrirla desde la lista.', 'ok');
    } else if (result.confirmed) {
      accept(result);
      if (inline && shift === 'day') comparison = { shift: 'night', text: result.text };
      saveDraft();
      show('✓ Guardado en HHR', 'ok');
    } else raise(result.error ? result : { error: 'HHR todavía no confirmó el guardado.' });
    if (available) {
      if (inline && tableView && slot &&
          (tableView.slot.date !== slot.date || tableView.slot.shift !== slot.shift)) loadCurrentShift();
      else if (result.confirmed) scheduleFollow(++polling);
      else void follow(++polling);
    }
    if (result.confirmed === true) return 'saved';
    return ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED'].includes(result.code)
      ? 'retry' : 'review';
  }
  edit.addEventListener('submit', event => {
    event.preventDefault();
    void submitNote();
  });
  void (async () => {
    const context = await send('context');
    if (context.error) return raise(context);
    inline = context.inline === true;
    if (inline) {
      document.body.classList.add('hhr-handoff-row');
      note.placeholder = 'Escribir entrega…';
      const main = document.querySelector('main');
      new ResizeObserver(() => window.parent.postMessage({
        type: 'hhr-handoff-row-height', value: main.offsetHeight,
      }, 'https://fichamedico.rayensalud.cl')).observe(main);
    }
    hosted = context.hosted === true;
    byId('environment').textContent = hosted ? 'HHR' : 'Pruebas HHR';
    byId('patient').textContent = context.name;
    available = true;
    show(inline ? '' : 'Cargando entrega…', 'pending');
    void follow(++polling);
  })();
})();
