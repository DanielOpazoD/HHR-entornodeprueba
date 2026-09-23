/** Reclaim Ficha controls after an extension update without discarding clinical edits. */
(function (root) {
  'use strict';
  const MODAL_ID = 'hhr-prescription-print-modal';
  const create = chromeApi => {
    const id = `${Date.now()}-${Math.random()}`;
    let version = '';
    try { version = chromeApi.runtime.getManifest().version; } catch (_error) {}
    const modal = () => root.document?.getElementById(MODAL_ID);
    const removeOrphans = () => {
      ['hhr-prescription-print-button', 'hhr-indications-print-button',
        'hhr-clinical-operations-bar', 'hhr-clinical-page-notices']
        .forEach(name => root.document?.getElementById(name)?.remove());
      root.__hhrPrescriptionPrintInjected = false;
    };
    const preparePrevious = () => {
      const previous = root.__hhrPrescriptionPrintRuntime;
      if (!previous) {
        const existing = modal();
        if (existing?.dataset.activeModule === 'connection') existing.remove();
        else if (existing) return false;
        removeOrphans();
        return true;
      }
      try { if (previous.dispose() !== false) return true; } catch (_error) {}
      const existing = modal();
      if (existing && existing.dataset.activeModule !== 'connection') return false;
      existing?.remove();
      try { if (previous.dispose() !== false) return true; } catch (_error) {}
      removeOrphans();
      return true;
    };
    const waitForModalClosure = initialize => {
      root.__hhrPrescriptionPrintWaiter?.disconnect();
      if (!modal()) return;
      const observer = new MutationObserver(() => {
        if (modal()) return;
        observer.disconnect();
        root.__hhrPrescriptionPrintWaiter = null;
        initialize();
      });
      observer.observe(root.document.documentElement, { childList: true, subtree: true });
      root.__hhrPrescriptionPrintWaiter = observer;
    };
    const takeBar = barId => {
      let bar = root.document.getElementById(barId);
      if (bar && bar.dataset.hhrUiInstance !== id) {
        const existing = modal();
        if (existing?.dataset.activeModule === 'connection') existing.remove();
        bar.remove();
        bar = null;
      }
      return bar;
    };
    return Object.freeze({
      version, preparePrevious, waitForModalClosure, takeBar,
      claim: () => { root.document.documentElement.dataset.hhrUiActiveInstance = id; },
      owns: () => root.document.documentElement.dataset.hhrUiActiveInstance === id,
      markBar: bar => {
        bar.dataset.hhrUiInstance = id;
        bar.dataset.hhrUiBuildVersion = version;
      },
    });
  };
  root.HhrPrescriptionUiLifecycle = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
