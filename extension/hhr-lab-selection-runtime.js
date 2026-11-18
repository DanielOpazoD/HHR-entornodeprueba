/** Search, explicit selection and user-defined groups for laboratory request forms. */
(() => {
  'use strict';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const aliases = {
    'hemograma': 'cbc hemograma completo', 'creatinina': 'crea creat',
    'proteina c reactiva': 'pcr proteina c reactiva',
    'hemoglobina glicosilada': 'hba1c hb a1c', 'electrolitos plasmaticos': 'elp sodio potasio cloro',
    'protrombina inr': 'tp inr', 'tiroxina libre t4l': 't4 libre ft4',
    'h tiroestimulante tsh': 'tsh tirotropina', 'sedimento urinario': 'sedimento de orina',
  };
  const attach = (main, onChange) => {
    const preferences = globalThis.HhrCenterPreferences;
    const grid = main.querySelector('.hhr-labreq-grid');
    if (!grid || !preferences) return;
    const host = document.createElement('section');
    host.className = 'hhr-labreq-selection';
    host.setAttribute('aria-label', 'Buscar y organizar exámenes');
    host.innerHTML = `
      <input class="hhr-center-search hhr-labreq-search" type="search" placeholder="Buscar examen o abreviatura: hemograma, PCR, ELP…" aria-label="Buscar exámenes para solicitar">
      <div class="hhr-labreq-selection-tools">
        <select class="hhr-center-select" aria-label="Grupos de exámenes guardados"><option value="">Tus grupos de exámenes</option></select>
        <button class="hhr-center-action" type="button" data-group="apply" disabled>Añadir grupo</button>
        <button class="hhr-center-action" type="button" data-group="save" aria-label="Guardar selección">Guardar grupo</button>
        <button class="hhr-center-action" type="button" data-group="remove" aria-label="Eliminar grupo" title="Eliminar grupo" disabled>×</button>
      </div>
      <div class="hhr-labreq-group-editor" hidden>
        <input class="hhr-center-search" maxlength="48" aria-label="Nombre del grupo" placeholder="Nombre de tu grupo">
        <button class="hhr-center-action" type="button" data-group="confirm">Guardar</button>
        <button class="hhr-center-action" type="button" data-group="cancel">Cancelar</button>
      </div>
      <div class="hhr-labreq-selected" aria-label="Exámenes seleccionados"></div>
      <div class="hhr-labreq-search-summary" role="status" aria-live="polite"></div>`;
    grid.before(host);
    const search = host.querySelector('input[type="search"]');
    const select = host.querySelector('select');
    const chips = host.querySelector('.hhr-labreq-selected');
    const status = host.querySelector('[role="status"]');
    const editor = host.querySelector('.hhr-labreq-group-editor');
    const name = editor.querySelector('input');
    const rows = Array.from(grid.querySelectorAll('.hhr-labreq-exam')).map(row => ({
      row, input: row.querySelector('input'), label: row.textContent.trim(),
      text: normalize(row.textContent) + ' ' + (aliases[normalize(row.textContent)] || ''),
    }));
    const known = new Map(rows.map(row => [row.input.dataset.key, row]));
    const selected = () => rows.filter(item => item.input.checked);
    let groupSignature = '';
    const renderGroups = () => {
      if (!host.isConnected) return;
      const previous = select.value;
      const groups = preferences.get().labGroups;
      const signature = JSON.stringify(groups.map(group => group.name));
      if (signature !== groupSignature) {
        groupSignature = signature;
        select.replaceChildren(new Option('Tus grupos de exámenes', ''));
        groups.forEach(group => select.append(new Option(group.name, preferences.groupId(group.name))));
        if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
      }
      host.querySelector('[data-group="apply"]').disabled = !select.value;
      host.querySelector('[data-group="remove"]').disabled = !select.value;
    };
    const render = () => {
      const query = normalize(search.value).split(' ').filter(Boolean);
      let visible = 0;
      rows.forEach(item => {
        item.row.hidden = !query.every(word => item.text.includes(word));
        if (!item.row.hidden) visible += 1;
      });
      Array.from(grid.children).forEach(card => {
        card.hidden = !Array.from(card.querySelectorAll('.hhr-labreq-exam')).some(row => !row.hidden);
      });
      chips.replaceChildren(...selected().map(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label + ' ×';
        button.setAttribute('aria-label', 'Quitar ' + item.label);
        button.addEventListener('click', () => { item.input.checked = false; render(); onChange([item.input.dataset.key]); });
        return button;
      }));
      host.querySelector('[data-group="save"]').disabled = !selected().length;
      status.textContent = query.length ? (visible ? visible + (visible === 1 ? ' examen coincide' : ' exámenes coinciden') : 'No hay coincidencias. Prueba otro nombre o abreviatura.') :
        selected().length ? selected().length + (selected().length === 1 ? ' seleccionado' : ' seleccionados') : 'Busca un examen o selecciónalo en la lista.';
    };
    search.addEventListener('input', render);
    grid.addEventListener('change', render);
    select.addEventListener('change', renderGroups);
    select.addEventListener('focus', () => { preferences.reloadGroups().then(renderGroups); });
    host.addEventListener('click', async event => {
      const action = event.target.closest('[data-group]')?.dataset.group;
      if (['apply', 'confirm', 'remove'].includes(action)) await preferences.reloadGroups();
      if (!host.isConnected) return;
      const groups = preferences.get().labGroups;
      if (action === 'apply') {
        const group = groups.find(item => preferences.groupId(item.name) === select.value);
        if (!select.value || !group) return;
        group.keys.forEach(key => { const item = known.get(key); if (item) item.input.checked = true; });
        render(); onChange(group.keys);
      } else if (action === 'save') {
        editor.hidden = false; name.value = ''; name.focus();
      } else if (action === 'cancel') editor.hidden = true;
      else if (action === 'confirm') {
        const title = name.value.trim();
        if (!title || !selected().length) { status.textContent = 'Escribe un nombre y selecciona al menos un examen.'; return; }
        const index = groups.findIndex(group => preferences.groupId(group.name) === preferences.groupId(title));
        if (index < 0 && groups.length >= 20) { status.textContent = 'Puedes guardar hasta 20 grupos.'; return; }
        const group = { name: title, keys: selected().map(item => item.input.dataset.key) };
        const saved = await preferences.saveGroup(group);
        if (!host.isConnected) return;
        if (saved) editor.hidden = true;
        renderGroups();
        status.textContent = saved ? 'Grupo guardado en este navegador.' : 'No se pudo guardar el grupo. Conserva la selección y reintenta.';
      } else if (action === 'remove' && select.value) {
        const group = groups.find(item => preferences.groupId(item.name) === select.value);
        if (!group) return;
        const saved = await preferences.removeGroup(group.name);
        if (host.isConnected) { if (saved) select.value = ''; renderGroups(); status.textContent = saved ? 'Grupo eliminado.' : 'No se pudo actualizar el grupo guardado en Chrome.'; }
      }
    });
    editor.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); editor.hidden = true; }
      if (event.key === 'Enter') { event.preventDefault(); host.querySelector('[data-group="confirm"]').click(); }
    });
    render(); renderGroups();
    preferences.load().then(renderGroups);
  };
  globalThis.HhrLabSelectionRuntime = Object.freeze({ attach, normalize });
})();
