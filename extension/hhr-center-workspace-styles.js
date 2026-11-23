/** Presentation shared by docking, examination selection and document previews. */
(() => {
  'use strict';
  const css = `
    html[data-hhr-center-docked] { padding-right: var(--hhr-center-reserved); box-sizing: border-box; }
    html[data-hhr-center-docked] .MuiAppBar-root { width: calc(100% - var(--hhr-center-reserved)); }
    #hhr-prescription-print-modal[data-panel-mode] { pointer-events: none; }
    #hhr-prescription-print-modal[data-panel-mode] .hhr-center-dialog,
    #hhr-prescription-print-modal[data-panel-mode] .hhr-rx-backdrop { pointer-events: auto; }
    #hhr-prescription-print-modal .hhr-center-dialog { container: hhr-center / inline-size; }
    #hhr-prescription-print-modal[data-panel-mode="docked"] .hhr-rx-backdrop { display: none; }
    #hhr-prescription-print-modal[data-panel-mode="docked"] .hhr-center-dialog {
      position: absolute; inset: 0 0 0 auto; margin: 0; width: var(--hhr-center-width); height: 100%;
      max-height: 100%; border-radius: 0; border-left: 1px solid var(--hhr-line-200); box-shadow: -8px 0 28px #102a4314;
    }
    #hhr-prescription-print-modal[data-expanded="true"] .hhr-center-dialog {
      width: min(1360px,calc(100vw - 24px)); height: calc(100dvh - 24px); max-height: calc(100dvh - 24px); margin: 12px auto;
    }
    #hhr-prescription-print-modal .hhr-center-header { height: auto; min-height: 56px; padding: 10px 12px; gap: 8px; }
    #hhr-prescription-print-modal .hhr-center-header strong { font-size: 14px; white-space: nowrap; }
    #hhr-prescription-print-modal .hhr-center-header img { width: 22px; }
    #hhr-prescription-print-modal .hhr-center-app-link { min-height: 30px; padding: 0 8px; font-size: 11px; }
    #hhr-prescription-print-modal .hhr-center-window-actions { display: flex; align-items: center; gap: 2px; }
    #hhr-prescription-print-modal .hhr-center-window-actions button {
      position: static; flex: none; width: 30px; height: 30px; border: 0; border-radius: 6px;
      background: transparent; color: var(--hhr-ink-700); font: 19px/1 system-ui; cursor: pointer;
    }
    #hhr-prescription-print-modal .hhr-center-window-actions button:hover,
    #hhr-prescription-print-modal .hhr-center-window-actions button[aria-pressed="true"] { background: var(--hhr-teal-050); color: var(--hhr-teal-ink); }
    #hhr-prescription-print-modal .hhr-center-window-actions button:focus-visible { outline: 2px solid var(--hhr-teal-ink); outline-offset: 1px; }
    #hhr-prescription-print-modal .hhr-center-resize { display: none; }
    #hhr-prescription-print-modal[data-panel-mode="docked"] .hhr-center-resize {
      display: block; position: absolute; z-index: 8; left: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; touch-action: none;
    }
    #hhr-prescription-print-modal .hhr-center-resize:hover,
    #hhr-prescription-print-modal .hhr-center-resize:focus-visible { background: #15978b40; outline: none; }
    #hhr-prescription-print-modal .hhr-center-restore { display: none; }
    #hhr-prescription-print-modal[data-minimized="true"] .hhr-center-dialog,
    #hhr-prescription-print-modal[data-minimized="true"] .hhr-rx-backdrop { display: none; }
    #hhr-prescription-print-modal[data-minimized="true"] .hhr-center-restore {
      display: block; position: fixed; right: 18px; bottom: 18px; max-width: min(380px,calc(100vw - 36px));
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis; pointer-events: auto; cursor: pointer;
      padding: 12px 16px; border: 1px solid #c8d9d5; border-radius: 12px; background: white;
      color: var(--hhr-teal-ink); box-shadow: var(--hhr-shadow-float); font: 600 13px var(--hhr-font);
    }
    #hhr-prescription-print-modal .hhr-center-content { scrollbar-gutter: stable; }
    #hhr-prescription-print-modal .hhr-rx-subtitle,
    #hhr-prescription-print-modal .hhr-rx-meta { color: #526762; }
    #hhr-prescription-print-modal .hhr-center-action { font-size: 12px; min-height: 34px; }
    #hhr-prescription-print-modal .hhr-labreq-selection { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 6px; margin-bottom: 4px; }
    #hhr-prescription-print-modal .hhr-labreq-search { flex: 1 1 180px; min-width: 0; box-sizing: border-box; min-height: 32px; }
    #hhr-prescription-print-modal .hhr-labreq-selection-tools { display: flex; flex: 1 1 340px; align-items: center; flex-wrap: wrap; gap: 4px; }
    #hhr-prescription-print-modal .hhr-labreq-selection-tools select { flex: 1; min-width: 130px; max-width: 100%; }
    #hhr-prescription-print-modal .hhr-labreq-selected { display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto; }
    #hhr-prescription-print-modal .hhr-labreq-selection > :is(.hhr-labreq-selected,.hhr-labreq-search-summary,.hhr-labreq-group-editor) { flex-basis: 100%; }
    #hhr-prescription-print-modal .hhr-labreq-selection > div:empty { display: none; }
    #hhr-prescription-print-modal .hhr-labreq-selected button {
      display: flex; align-items: center; gap: 8px; padding: 6px 9px; border: 1px solid #b9d9d1;
      border-radius: 18px; background: #edf7f4; color: #0b6e66; font: 12px var(--hhr-font); cursor: pointer;
    }
    #hhr-prescription-print-modal .hhr-labreq-search-summary { color: #526762; font-size: 12px; }
    #hhr-prescription-print-modal .hhr-labreq-group-editor { display: flex; gap: 8px; flex-wrap: wrap; }
    #hhr-prescription-print-modal .hhr-labreq-group-editor input { flex: 1; min-width: 100px; }
    #hhr-prescription-print-modal .hhr-labreq-card { border-color: #e4ebe8; border-radius: 8px; }
    #hhr-prescription-print-modal .hhr-labreq-card-title { background: #f7faf9; }
    #hhr-prescription-print-modal .hhr-labreq-exam { padding: 3px 8px; font-size: 12px; }
    #hhr-prescription-print-modal .hhr-document-preview {
      position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column;
      background: #f3f6f5; color: var(--hhr-ink-900);
    }
    #hhr-prescription-print-modal .hhr-preview-header { padding: 12px 16px; background: white; border-bottom: 1px solid #dde5e2; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    #hhr-prescription-print-modal .hhr-preview-header strong { margin-right: auto; font-size: 14px; }
    #hhr-prescription-print-modal .hhr-preview-formats { display: flex; gap: 8px; padding: 8px 16px; background: white; }
    #hhr-prescription-print-modal .hhr-preview-page-controls { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 8px; }
    #hhr-prescription-print-modal .hhr-preview-pages { min-height: 0; flex: 1; overflow: auto; padding: 16px; text-align: center; }
    #hhr-prescription-print-modal .hhr-preview-pages canvas { max-width: 100%; height: auto; display: block; margin: 0 auto; box-shadow: 0 2px 12px #102a431c; }
    #hhr-prescription-print-modal .hhr-preview-html { width: 100%; min-height: 0; flex: 1; border: 0; background: white; }
    #hhr-prescription-print-modal .hhr-preview-status { padding: 8px 16px; font-size: 12px; color: #526762; background: white; }
    #hhr-prescription-print-modal[data-density="compact"] .hhr-center-toolbar { min-height: 48px; padding-top: 8px; padding-bottom: 8px; gap: 8px; }
    #hhr-prescription-print-modal[data-density="compact"] .hhr-center-content { padding-top: 10px; }
    #hhr-prescription-print-modal[data-density="compact"] .hhr-rx-option,
    #hhr-prescription-print-modal[data-density="compact"] .hhr-rx-patient { padding-top: 7px; padding-bottom: 7px; }
    #hhr-prescription-print-modal[data-density="compact"] .hhr-labreq-exam { padding-top: 2px; padding-bottom: 2px; }
    #hhr-prescription-print-modal .hhr-preview-formats button[aria-pressed="true"] { border-color: var(--hhr-teal-500); background: var(--hhr-teal-050); color: var(--hhr-teal-ink); }
    #hhr-prescription-print-modal .hhr-connection-capabilities { margin-bottom: 16px; padding: 0 0 12px; border-bottom: 1px solid var(--hhr-line-200); }
    #hhr-prescription-print-modal .hhr-connection-capabilities strong { font-size: 14px; color: var(--hhr-ink-900); }
    #hhr-prescription-print-modal .hhr-connection-capabilities p { margin: 7px 0 0; font-size: 12px; line-height: 1.6; color: #526762; }
    #hhr-prescription-print-modal .hhr-connection-card { box-shadow: none; border-color: #e4ebe8; }
    #hhr-prescription-print-modal:is([data-active-module="lab"],[data-active-module="imaging"]) .hhr-center-toolbar {
      min-height: 40px; padding: 5px 14px; gap: 4px 10px;
    }
    #hhr-prescription-print-modal:is([data-active-module="lab"],[data-active-module="imaging"]) .hhr-center-content {
      padding: 6px 14px 12px;
    }
    #hhr-prescription-print-modal:is([data-active-module="lab"],[data-active-module="imaging"]) :is(.hhr-center-action,.hhr-center-select,.hhr-center-search) {
      min-height: 28px; height: auto; padding-block: 3px;
    }
    @container hhr-center (max-width: 760px) {
      #hhr-prescription-print-modal .hhr-center-shell { grid-template-columns: 1fr; grid-template-rows: auto minmax(0,1fr); }
      #hhr-prescription-print-modal .hhr-center-nav { display: flex; flex-direction: row; padding: 3px; border-right: 0; border-bottom: 1px solid #e0e6e5; }
      #hhr-prescription-print-modal .hhr-center-nav-button { flex: 1; min-height: 44px; border-left: 0; border-bottom: 2px solid transparent; padding: 5px; }
      #hhr-prescription-print-modal .hhr-center-nav-button[aria-current="page"] { border-bottom-color: #15978b; }
      #hhr-prescription-print-modal .hhr-center-nav-session { margin-top: 0; border-top: 0; }
      #hhr-prescription-print-modal .hhr-center-toolbar { min-height: auto; flex-wrap: wrap; padding: 10px 12px; gap: 10px; }
      #hhr-prescription-print-modal .hhr-center-heading { flex-basis: 100%; }
      #hhr-prescription-print-modal .hhr-center-toolbar .hhr-rx-tabs { flex: 1 1 auto; min-width: 0; margin-left: 0; }
      #hhr-prescription-print-modal .hhr-center-toolbar-actions { width: 100%; justify-content: space-between; }
      #hhr-prescription-print-modal .hhr-center-content { padding: 12px; }
      #hhr-prescription-print-modal .hhr-center-patientbar { display: grid; grid-template-columns: auto minmax(0,1fr) auto; padding: 9px 12px; gap: 6px 8px; }
      #hhr-prescription-print-modal .hhr-patientbar-tag { grid-column: 1; grid-row: 1; justify-self: start; }
      #hhr-prescription-print-modal .hhr-patientbar-name { grid-column: 2; grid-row: 1; }
      #hhr-prescription-print-modal .hhr-patientbar-meta { grid-column: 2; grid-row: 2; }
      #hhr-prescription-print-modal .hhr-patientbar-change { grid-column: 3; grid-row: 1 / span 2; margin-left: 0; }
      #hhr-prescription-print-modal .hhr-patientbar-route { grid-column: 1 / -1; }
      #hhr-prescription-print-modal .hhr-rx-format-bar { padding: 8px 12px; gap: 8px; }
      #hhr-prescription-print-modal .hhr-labreq-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
      #hhr-prescription-print-modal:is([data-active-module="lab"],[data-active-module="imaging"]) .hhr-center-heading { flex-basis: auto; }
      #hhr-prescription-print-modal .hhr-connection-grid { grid-template-columns: 1fr; }
    }
    @container hhr-center (max-width: 450px) {
      #hhr-prescription-print-modal .hhr-center-header img { display: none; }
      #hhr-prescription-print-modal .hhr-center-header { gap: 5px; }
      #hhr-prescription-print-modal .hhr-center-app-link { padding: 0 5px; font-size: 10px; }
      #hhr-prescription-print-modal .hhr-center-window-actions button { width: 27px; }
    }
    @container hhr-center (max-width: 470px) {
      #hhr-prescription-print-modal .hhr-labreq-grid { grid-template-columns: 1fr; }
    }
  `;
  const ensure = () => {
    const id = 'hhr-center-workspace-styles';
    let style = document.getElementById(id);
    if (!style) { style = document.createElement('style'); style.id = id; document.head.append(style); }
    if (style.textContent !== css) style.textContent = css;
  };
  globalThis.HhrCenterWorkspaceStyles = Object.freeze({ css, ensure });
})();
