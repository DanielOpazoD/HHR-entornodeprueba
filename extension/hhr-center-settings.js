/** Presentation controls and access to Favorites inside Centro HHR. */
(() => {
  'use strict';
  const render = ({ root, operationsBar }) => {
    const preferences = globalThis.HhrCenterPreferences;
    const main = root.querySelector('.hhr-center-main');
    main.innerHTML = `<div class="hhr-center-toolbar"><h2 class="hhr-center-heading">Ajustes</h2></div>
      <div class="hhr-center-content"><section class="hhr-connection-card">
        <div class="hhr-labreq-meta-group"><label>Presentación <select class="hhr-center-select" aria-label="Presentación" data-setting="mode"><option value="floating">Cuadro centrado</option><option value="docked">Panel lateral</option></select></label></div>
        <div class="hhr-labreq-meta-group"><label>Densidad <select class="hhr-center-select" aria-label="Densidad" data-setting="density"><option value="normal">Normal</option><option value="compact">Compacta</option></select></label></div>
        <div class="hhr-labreq-meta-group"><label><input type="checkbox" data-setting="collapsed"> Contraer barra a HHR</label></div>
        <a class="hhr-center-action" href="https://github.com/DanielOpazoD/extensioneloisahhr/releases/latest/download/eloisa-hhr.zip" target="_blank" rel="noopener noreferrer">Descargar extensión desde GitHub (.zip)</a>
      </section></div>`;
    main.querySelector('.hhr-connection-card').append(globalThis.HhrFavoriteLinks.create());
    const update = () => {
      if (!main.querySelector('[data-setting]') || !main.isConnected) return;
      const state = preferences.get();
      ['mode', 'density'].forEach(key => { main.querySelector('[data-setting="' + key + '"]').value = state[key]; });
      main.querySelector('[data-setting="collapsed"]').checked = operationsBar?.classList.contains('is-collapsed') || false;
    };
    main.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('change', () => {
      if (input.dataset.setting === 'collapsed') operationsBar?.__hhrUi?.setCollapsed(input.checked);
      else preferences.save({ [input.dataset.setting]: input.value });
    }));
    update(); preferences.load().then(update);
  };
  globalThis.HhrCenterSettings = Object.freeze({ render });
})();
