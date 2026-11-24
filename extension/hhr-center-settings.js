/** Presentation controls and access to Favorites inside Centro HHR. */
(() => {
  'use strict';
  const syncHandoffCheckbox = () => {
    const input = document.querySelector('#hhr-prescription-print-modal [data-setting="handoff"]');
    if (input) input.checked = globalThis.HhrNursingHandoffPreference.get();
  };
  new MutationObserver(syncHandoffCheckbox).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-hhr-handoff-enabled'],
  });
  const render = ({ root, operationsBar }) => {
    const preferences = globalThis.HhrCenterPreferences;
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `<div class="hhr-center-toolbar hhr-settings-toolbar">
        <h2 class="hhr-center-heading">Ajustes</h2>
        <a class="hhr-center-action" href="https://github.com/DanielOpazoD/extensioneloisahhr/releases/latest/download/eloisa-hhr.zip" target="_blank" rel="noopener noreferrer">Descargar ZIP</a>
      </div>
      <div class="hhr-center-content"><div class="hhr-settings-list">
        <div class="hhr-setting-row"><label for="hhr-setting-mode">Presentación</label><select id="hhr-setting-mode" class="hhr-center-select" data-setting="mode">
          <option value="floating">Cuadro centrado</option><option value="docked">Panel lateral</option>
        </select></div>
        <div class="hhr-setting-row"><label for="hhr-setting-density">Densidad</label><select id="hhr-setting-density" class="hhr-center-select" data-setting="density">
          <option value="normal">Normal</option><option value="compact">Compacta</option>
        </select></div>
        <label class="hhr-setting-row"><span>Contraer barra a HHR</span><input type="checkbox" data-setting="collapsed"></label>
        <label class="hhr-setting-row"><span>Entrega de turno en Gestión de cuidados</span><input type="checkbox" data-setting="handoff" disabled></label>
        <small role="status" data-handoff-status></small>
        <label class="hhr-setting-row"><span>Pautas clínicas en Evolución</span><input type="checkbox" data-checklist-enabled disabled></label>
        <small role="status" data-checklist-status></small>
      </div></div>`;
    main.querySelector('.hhr-settings-list').append(globalThis.HhrFavoriteLinks.create());
    const checklist = main.querySelector('[data-checklist-enabled]');
    const checklistStatus = main.querySelector('[data-checklist-status]');
    const checklistKey = 'hhr-clinical-checklists-enabled';
    chrome.storage.local.get(checklistKey).then(stored => {
      checklist.checked = stored[checklistKey] === true;
      checklist.disabled = false;
    }).catch(() => { checklistStatus.textContent = 'No se pudo leer el ajuste de pautas.'; });
    checklist.addEventListener('change', async () => {
      checklist.disabled = true;
      try { await chrome.storage.local.set({ [checklistKey]: checklist.checked }); checklistStatus.textContent = ''; }
      catch { checklist.checked = !checklist.checked; checklistStatus.textContent = 'No se pudo guardar el ajuste de pautas.'; }
      finally { checklist.disabled = false; }
    });
    const handoff = globalThis.HhrNursingHandoffPreference;
    const checkbox = main.querySelector('[data-setting="handoff"]');
    const status = main.querySelector('[data-handoff-status]');
    const refreshHandoff = () => { checkbox.checked = handoff.get(); };
    handoff.load().then(() => { refreshHandoff(); checkbox.disabled = false; })
      .catch(() => { status.textContent = 'No se pudo leer el ajuste.'; checkbox.disabled = false; });
    const update = () => {
      if (!main.querySelector('[data-setting]') || !main.isConnected) return;
      const state = preferences.get();
      ['mode', 'density'].forEach(key => { main.querySelector('[data-setting="' + key + '"]').value = state[key]; });
      main.querySelector('[data-setting="collapsed"]').checked = operationsBar?.classList.contains('is-collapsed') || false;
    };
    main.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('change', () => {
      if (input.dataset.setting === 'collapsed') operationsBar?.__hhrUi?.setCollapsed(input.checked);
      else if (input === checkbox) {
        checkbox.disabled = true;
        status.textContent = '';
        handoff.set(checkbox.checked).catch(() => {
          refreshHandoff();
          status.textContent = 'No se pudo guardar el ajuste.';
        }).finally(() => { checkbox.disabled = false; });
      } else preferences.save({ [input.dataset.setting]: input.value });
    }));
    update(); preferences.load().then(update);
  };
  globalThis.HhrCenterSettings = Object.freeze({ render });
})();
