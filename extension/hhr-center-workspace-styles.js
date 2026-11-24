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
    #hhr-prescription-print-modal .hhr-center-header { grid-area: 1 / 1 / 2 / -1; display: grid; grid-template-columns: subgrid; height: auto; min-height: 44px; padding: 0; gap: 0; pointer-events: none; }
    #hhr-prescription-print-modal .hhr-center-header img { grid-column: 1; width: 20px; height: 20px; justify-self: end; }
    #hhr-prescription-print-modal .hhr-center-window-actions { grid-column: 4; display: flex; align-items: center; gap: 2px; padding-inline: 6px 10px; pointer-events: auto; z-index: 5; }
    #hhr-prescription-print-modal .hhr-center-window-actions button {
      position: static; flex: none; width: 30px; height: 30px; border: 0; border-radius: 6px;
      background: transparent; color: var(--hhr-ink-700); font: 19px/1 system-ui; cursor: pointer;
    }
    #hhr-prescription-print-modal .hhr-center-window-actions button:hover,
    #hhr-prescription-print-modal .hhr-center-window-actions button[aria-pressed="true"] { background: var(--hhr-teal-050); color: var(--hhr-teal-ink); }
    #hhr-prescription-print-modal .hhr-center-window-actions button:focus-visible { outline: 2px solid var(--hhr-teal-ink); outline-offset: 1px; }
    #hhr-prescription-print-modal .hhr-view-select { position: relative; }
    #hhr-prescription-print-modal .hhr-center-window-actions [data-panel="view"] { width: auto; padding: 0 6px; font: 600 12px var(--hhr-font); }
    #hhr-prescription-print-modal .hhr-view-options {
      position: absolute; top: calc(100% + 4px); right: 0; min-width: 158px; padding: 4px;
      border: 1px solid var(--hhr-line-200); border-radius: 8px; background: white; box-shadow: var(--hhr-shadow-float);
    }
    #hhr-prescription-print-modal .hhr-view-options button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding-inline: 8px; text-align: start; font: 500 12px var(--hhr-font); }
    #hhr-prescription-print-modal .hhr-view-options button[aria-pressed="true"]::after { content: "✓"; }
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
    #hhr-prescription-print-modal .hhr-labreq-search { flex: 1 1 155px; min-width: 0; box-sizing: border-box; min-height: 32px; }
    #hhr-prescription-print-modal .hhr-labreq-selection-tools { display: flex; min-width: 0; max-width: 100%; align-items: center; flex-wrap: wrap; gap: 4px; }
    #hhr-prescription-print-modal .hhr-labreq-selection-tools select { width: auto; min-width: min(105px, 100%); max-width: min(24ch, 100%); }
    #hhr-prescription-print-modal .hhr-labreq-selection-tools button:disabled,
    #hhr-prescription-print-modal .hhr-labreq-selection:has(.hhr-labreq-group-editor:not([hidden])) [data-group="save"] { display: none; }
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
    #hhr-prescription-print-modal .hhr-center-toolbar.hhr-settings-toolbar { min-height: 44px; gap: 8px; padding-block: 6px; }
    #hhr-prescription-print-modal .hhr-settings-toolbar .hhr-center-heading { flex: 1 1 auto; }
    #hhr-prescription-print-modal .hhr-settings-toolbar a { display: inline-flex; align-items: center; min-height: 28px; text-decoration: none; }
    #hhr-prescription-print-modal .hhr-settings-list { max-width: 34rem; font-size: 13px; color: var(--hhr-ink-900); }
    #hhr-prescription-print-modal .hhr-setting-row {
      display: grid; grid-template-columns: minmax(0,1fr) auto; column-gap: 12px; align-items: center;
      min-height: 40px; padding-block: 4px; box-sizing: border-box; border-bottom: 1px solid var(--hhr-line-200); line-height: 1.35;
    }
    #hhr-prescription-print-modal .hhr-setting-row select { width: min(10rem,42cqw); }
    #hhr-prescription-print-modal .hhr-setting-row input { width: 16px; height: 16px; margin: 0; accent-color: var(--hhr-teal-500); }
    #hhr-prescription-print-modal .hhr-settings-list [data-handoff-status]:not(:empty) { display: block; padding-block: 4px; }
    #hhr-prescription-print-modal .hhr-settings-list .hhr-favorite-links { margin-top: 12px; }
    #hhr-prescription-print-modal:is([data-active-module="lab"],[data-active-module="imaging"]) .hhr-center-toolbar {
      min-height: 40px; padding: 5px 14px; gap: 4px 10px;
    }
    #hhr-prescription-print-modal:is([data-active-module="lab"],[data-active-module="imaging"]) .hhr-center-content {
      padding: 6px 14px 12px;
    }
    #hhr-prescription-print-modal:is([data-active-module="lab"],[data-active-module="imaging"]) :is(.hhr-center-action,.hhr-center-select,.hhr-center-search) {
      min-height: 28px; height: auto; padding-block: 3px;
    }
    #hhr-prescription-print-modal .hhr-center-toolbar.hhr-request-toolbar {
      display:grid; align-items:center;
      grid-template:"heading tabs print" auto / auto minmax(0,1fr) auto;
    }
    #hhr-prescription-print-modal .hhr-request-toolbar .hhr-center-heading { grid-area:heading; }
    #hhr-prescription-print-modal .hhr-request-toolbar .hhr-flow-tabs {
      grid-area:tabs; min-width:0; width:fit-content; max-width:100%; margin:0;
    }
    #hhr-prescription-print-modal .hhr-request-toolbar .hhr-request-actions {
      grid-area:print; justify-self:end; width:auto; justify-content:flex-end; flex-wrap:nowrap; gap:0;
    }
    #hhr-prescription-print-modal .hhr-request-details {
      display:grid; justify-items:end; text-align:end; max-width:min(26cqw,280px); color:#4c605b; font-size:11.5px; line-height:1.25;
    }
    #hhr-prescription-print-modal .hhr-request-source {
      color:var(--hhr-teal-ink); font-weight:600; overflow-wrap:anywhere;
    }
    #hhr-prescription-print-modal .hhr-request-details:has(> :not([hidden])) { margin-inline-end:8px; }
    #hhr-prescription-print-modal .hhr-request-actions button { white-space:nowrap; }
    @container hhr-center (max-width: 760px) {
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
      #hhr-prescription-print-modal .hhr-patientbar-route { grid-column: 1 / -1; }
      #hhr-prescription-print-modal .hhr-rx-format-bar { padding: 8px 12px; gap: 8px; }
      #hhr-prescription-print-modal .hhr-labreq-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
      #hhr-prescription-print-modal:is([data-active-module="lab"],[data-active-module="imaging"]) .hhr-center-heading { flex-basis: auto; }
      #hhr-prescription-print-modal .hhr-connection-grid { grid-template-columns: 1fr; }
    }
    /* The shell and main retain their event/DOM scopes. Their children share the layout grid
       so every module's own toolbar sits between the logo and the window controls. */
    #hhr-prescription-print-modal .hhr-center-layout {
      flex: 1; min-height: 0; display: grid; grid-template-columns: 34px 58px minmax(0,1fr) auto;
      grid-template-rows: [toolbar] auto [patient] auto [navigation] auto [format] auto [content] minmax(0,1fr) [footer] auto;
    }
    #hhr-prescription-print-modal .hhr-center-layout :is(.hhr-center-shell,.hhr-center-main) { display: contents; }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-center-nav { grid-area: navigation / 1 / -1 / 3; min-height: 0; }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-center-patientbar { grid-area: patient / 1 / navigation / -1; }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-center-main > * { grid-area: content / 3 / footer / -1; min-width: 0; }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-center-main > .hhr-center-toolbar {
      grid-area: toolbar / 2 / patient / 4; align-self: center; min-height: 44px; margin: 0; padding: 5px 8px;
      border: 0; column-gap: 8px; row-gap: 4px;
    }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-center-toolbar .hhr-center-heading { flex-basis: auto; }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-center-main > .hhr-rx-format-bar { grid-row: format / content; }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-center-main > .hhr-rx-footer { grid-row: footer / -1; }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-center-main > .hhr-document-preview { grid-row: format / -1; position: relative; }
    #hhr-prescription-print-modal .hhr-center-layout .hhr-route-change-state { grid-area: 1 / 2 / 2 / 4; }
    #hhr-prescription-print-modal[data-route-stale="true"] .hhr-center-layout .hhr-center-toolbar { visibility: hidden; }
    @container hhr-center (max-width: 760px) {
      #hhr-prescription-print-modal .hhr-center-layout { grid-template-columns: 34px auto minmax(0,1fr) auto; }
      #hhr-prescription-print-modal .hhr-center-layout .hhr-center-nav { grid-area: navigation / 1 / format / -1; }
      #hhr-prescription-print-modal .hhr-center-layout .hhr-center-main > :not(.hhr-center-toolbar) { grid-column: 1 / -1; }
    }
    @container hhr-center (min-width: 551px) and (max-width: 760px) {
      #hhr-prescription-print-modal .hhr-center-nav-button { display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 34px; }
      #hhr-prescription-print-modal .hhr-center-nav-button svg { width: 16px; height: 16px; }
    }
    @container hhr-center (min-width: 551px) and (max-width: 680px) {
      #hhr-prescription-print-modal[data-active-module="lab"] .hhr-request-toolbar {
        grid-template: "heading tabs" auto "print print" auto / auto minmax(0,1fr);
      }
      #hhr-prescription-print-modal[data-active-module="imaging"] .hhr-request-details {
        max-width: clamp(76px, calc(100cqw - 475px), 155px);
      }
    }
    @container hhr-center (max-width: 550px) {
      #hhr-prescription-print-modal .hhr-center-layout .hhr-center-header { align-items: start; }
      #hhr-prescription-print-modal .hhr-center-header img { margin-top: 12px; }
      #hhr-prescription-print-modal .hhr-center-window-actions { padding-top: 7px; }
      #hhr-prescription-print-modal .hhr-center-layout .hhr-center-main > .hhr-center-toolbar {
        grid-column: 1 / -1; align-self: start; display: flex; flex-wrap: wrap; padding: 0 10px 5px;
      }
      #hhr-prescription-print-modal .hhr-center-layout .hhr-center-toolbar .hhr-center-heading {
        flex: 0 0 calc(100% - 154px); display: flex; align-items: center; margin: 0 124px 0 30px;
        min-height: 38px; white-space: normal;
      }
      #hhr-prescription-print-modal .hhr-center-layout .hhr-center-toolbar .hhr-flow-tabs { flex: 0 1 auto; }
      #hhr-prescription-print-modal .hhr-center-layout .hhr-center-toolbar .hhr-request-actions { margin-left: auto; }
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
