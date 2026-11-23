/* Continue only a request assigned by the worker to this Gestión de Camas tab. */
(() => {
  'use strict';
  const previous = globalThis.hhrWorklistEditorDestination;
  previous?.();
  let timer, notice, active = true, revision = 0;
  function show(text) {
    if (!text) { notice?.remove(); notice = null; return; }
    if (!notice) {
      notice = document.createElement('div');
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;bottom:18px;left:16px;z-index:99999;background:#164f4c;color:white;padding:9px 14px;border-radius:5px;font:14px system-ui;max-width:32em';
      (document.body || document.documentElement).append(notice);
    }
    notice.textContent = text;
  }
  async function resume() {
    clearTimeout(timer);
    const current = ++revision;
    let result;
    try { result = await chrome.runtime.sendMessage({ type: 'RAYEN_WORKLIST_EDITOR_READY' }); }
    catch { if (active && current === revision) show(''); return; }
    if (!active || current !== revision) return;
    if (result?.navigate) {
      if (location.hash !== '#/bed') location.hash = '/bed';
      else timer = setTimeout(resume, 800);
      return;
    }
    if (result?.wait) {
      show('Buscando el episodio en Gestión de Camas…');
      timer = setTimeout(resume, 800);
    } else if (result?.login) {
      show('Inicia sesión en Gestión de Camas para abrir el editor del paciente seleccionado.');
    } else {
      show(result?.error || '');
      if (result?.error) timer = setTimeout(() => show(''), 10000);
    }
  }
  window.addEventListener('hashchange', resume);
  globalThis.hhrWorklistEditorDestination = () => {
    active = false;
    clearTimeout(timer);
    show('');
    window.removeEventListener('hashchange', resume);
  };
  void resume();
})();
