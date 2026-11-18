/** Docking, resizing and presentation controls for the shared Centro HHR shell. */
(() => {
  'use strict';
  const attach = root => {
    root.__hhrPanel?.dispose();
    const preferences = globalThis.HhrCenterPreferences;
    if (!preferences) return;
    globalThis.HhrCenterWorkspaceStyles?.ensure();
    const dialog = root.querySelector('.hhr-center-dialog');
    const header = root.querySelector('.hhr-center-header');
    const documentRoot = document.documentElement;
    const instance = String(Date.now()) + Math.random();
    let minimized = false;
    let expanded = false;
    let disposed = false;
    let dragging = false;
    let width = preferences.get().width;
    const maximumWidth = () => Math.max(400, Math.min(900, innerWidth - 400));
    const clamp = value => Math.max(400, Math.min(maximumWidth(), value));
    const actions = document.createElement('div');
    actions.className = 'hhr-center-window-actions';
    actions.innerHTML = `
      <button type="button" data-panel="density" aria-label="Alternar densidad compacta" title="Densidad compacta">≡</button>
      <button type="button" data-panel="dock" aria-label="Alternar panel lateral" title="Acoplar o desacoplar">◧</button>
      <button type="button" data-panel="expand" aria-label="Ampliar panel" title="Ampliar">⤢</button>
      <button type="button" data-panel="minimize" aria-label="Minimizar Centro HHR" title="Minimizar">−</button>`;
    actions.append(root.querySelector('.hhr-rx-close'));
    header.append(actions);
    const handle = document.createElement('div');
    handle.className = 'hhr-center-resize';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', 'Ancho del panel lateral');
    handle.setAttribute('aria-orientation', 'vertical');
    dialog.append(handle);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'hhr-center-restore';
    restore.setAttribute('aria-label', 'Restaurar Centro HHR');
    root.append(restore);
    const releaseSpace = () => {
      if (documentRoot.dataset.hhrCenterDocked !== instance) return;
      delete documentRoot.dataset.hhrCenterDocked;
      documentRoot.style.removeProperty('--hhr-center-reserved');
    };
    const apply = () => {
      if (disposed) return;
      const current = preferences.get();
      const docked = current.mode === 'docked' && innerWidth >= 1000 && !expanded;
      const appliedWidth = clamp(width);
      root.dataset.panelMode = docked ? 'docked' : 'floating';
      root.dataset.density = current.density;
      root.dataset.minimized = String(minimized);
      root.dataset.expanded = String(expanded);
      root.style.setProperty('--hhr-center-width', appliedWidth + 'px');
      dialog.setAttribute('aria-modal', String(!docked && !minimized));
      handle.setAttribute('aria-valuemin', '400');
      handle.setAttribute('aria-valuemax', String(maximumWidth()));
      handle.setAttribute('aria-valuenow', String(appliedWidth));
      actions.querySelector('[data-panel="dock"]').setAttribute('aria-pressed', String(current.mode === 'docked'));
      actions.querySelector('[data-panel="density"]').setAttribute('aria-pressed', String(current.density === 'compact'));
      actions.querySelector('[data-panel="expand"]').setAttribute('aria-pressed', String(expanded));
      actions.querySelector('[data-panel="expand"]').setAttribute('aria-label', expanded ? 'Restaurar tamaño del panel' : 'Ampliar panel');
      if (docked && !minimized) {
        documentRoot.dataset.hhrCenterDocked = instance;
        documentRoot.style.setProperty('--hhr-center-reserved', appliedWidth + 'px');
      } else releaseSpace();
      const name = root.querySelector('.hhr-patientbar-name')?.textContent.trim();
      restore.textContent = 'Centro HHR' + (name && name !== '—' ? ' · ' + name : '');
    };
    actions.addEventListener('click', event => {
      const action = event.target.closest('[data-panel]')?.dataset.panel;
      if (action === 'dock') {
        expanded = false;
        preferences.save({ mode: preferences.get().mode === 'docked' ? 'floating' : 'docked' });
      } else if (action === 'density') {
        preferences.save({ density: preferences.get().density === 'compact' ? 'normal' : 'compact' });
      } else if (action === 'expand') { expanded = !expanded; apply(); }
      else if (action === 'minimize') { minimized = true; apply(); restore.focus(); }
    });
    restore.addEventListener('click', () => {
      minimized = false;
      apply();
      actions.querySelector('[data-panel="minimize"]').focus();
    });
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!dragging) return;
      width = clamp(innerWidth - event.clientX);
      apply();
    });
    const finishDrag = () => {
      if (!dragging) return;
      dragging = false;
      preferences.save({ width });
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      width = clamp(event.key === 'Home' ? 400 : event.key === 'End' ? maximumWidth() :
        width + (event.key === 'ArrowLeft' ? 20 : -20));
      preferences.save({ width });
    });
    const unsubscribe = preferences.subscribe(current => { width = current.width; apply(); });
    const identityObserver = new MutationObserver(apply);
    identityObserver.observe(root.querySelector('.hhr-center-patientbar'), { childList: true, subtree: true, characterData: true });
    const removalObserver = new MutationObserver(() => { if (!root.isConnected) dispose(); });
    removalObserver.observe(document.body, { childList: true });
    const dispose = () => {
      disposed = true;
      releaseSpace();
      unsubscribe();
      identityObserver.disconnect();
      removalObserver.disconnect();
      window.removeEventListener('resize', apply);
    };
    root.__hhrPanel = { dispose, restore: () => { minimized = false; apply(); } };
    window.addEventListener('resize', apply);
    preferences.load();
    apply();
  };
  globalThis.HhrCenterPanelRuntime = Object.freeze({ attach });
})();
