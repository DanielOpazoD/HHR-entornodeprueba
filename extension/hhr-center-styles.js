/**
 * Stylesheet owner for the light-DOM Centro HHR surfaces.
 * Keeps presentation separate from the clinical controller while reusing HhrUI tokens.
 */
(function (root) {
  'use strict';
  if (root.HhrCenterStyles) return;

  const NOTICE_STYLE_ID = 'hhr-clinical-page-notice-styles';
  const CENTER_STYLE_ID = 'hhr-prescription-print-styles';

  const installStyle = (document, id, css) => {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };

  const noticeCss = `
      #hhr-clinical-page-notices { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; display: grid; gap: 8px; width: min(390px,calc(100vw - 36px)); font-family: Arial,sans-serif; }
      #hhr-clinical-page-notices .hhr-page-notice { padding: 11px 13px; border: 1px solid #d8e3e0; border-left: 4px solid #15968b; border-radius: 9px; background: #fff; color: #263633; box-shadow: 0 10px 30px rgba(7,27,49,.22); font-size: 13px; line-height: 1.4; }
      #hhr-clinical-page-notices .hhr-page-notice.is-error { border-left-color: #c74a43; background: #fff8f7; }
      #hhr-clinical-page-notices .hhr-page-notice strong { display: block; margin-bottom: 3px; font-size: 13.5px; }
      #hhr-clinical-page-notices .hhr-page-notice > span { white-space: pre-line; }
      #hhr-clinical-page-notices .hhr-page-notice-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
      #hhr-clinical-page-notices button { min-height: 31px; padding: 5px 11px; border: 1px solid #cbd7d4; border-radius: 7px; background: #fff; color: #3b4b48; cursor: pointer; font: inherit; font-weight: 600; }
      #hhr-clinical-page-notices button.is-primary { border-color: #15968b; background: #15968b; color: #fff; }
  `;

  const centerCss = ui => `
      #hhr-prescription-print-button, #hhr-indications-print-button {
        appearance: none; background: transparent; border: 0; border-radius: 50%; color: #777;
        cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
        width: 38px; height: 38px; margin-left: 6px; padding: 7px; vertical-align: middle;
      }
      #hhr-prescription-print-button:hover, #hhr-indications-print-button:hover { background: rgba(0,0,0,.06); color: #555; }
      #hhr-prescription-print-button:focus-visible, #hhr-indications-print-button:focus-visible {
        outline: 3px solid rgba(20,151,139,.32); outline-offset: 1px;
      }
      #hhr-prescription-print-button svg, #hhr-indications-print-button svg { width: 25px; height: 25px; fill: currentColor; }
      ${ui.tokenRule('#hhr-prescription-print-modal')}
      #hhr-prescription-print-modal { position: fixed; inset: 0; z-index: 2147483646; font-family: var(--hhr-font); }
      #hhr-prescription-print-modal [hidden] { display: none !important; }
      #hhr-prescription-print-modal ::-webkit-scrollbar { width: 10px; height: 10px; }
      #hhr-prescription-print-modal ::-webkit-scrollbar-track { background: transparent; }
      #hhr-prescription-print-modal ::-webkit-scrollbar-thumb {
        background: #c8d4d1; border: 3px solid transparent; background-clip: content-box; border-radius: 999px;
      }
      #hhr-prescription-print-modal ::-webkit-scrollbar-thumb:hover { background-color: #a9bab5; }
      #hhr-prescription-print-modal .hhr-rx-backdrop {
        position: absolute; inset: 0; background: rgba(7,27,49,.44);
        backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
      }
      #hhr-prescription-print-modal .hhr-rx-dialog {
        position: relative; width: min(720px, calc(100vw - 24px)); max-height: calc(100vh - 20px);
        margin: max(10px, 2vh) auto; background: #fff; border-radius: 14px; overflow: hidden;
        box-shadow: 0 24px 70px rgba(7,27,49,.30), 0 2px 8px rgba(7,27,49,.10);
        color: var(--hhr-ink-900); display: flex; flex-direction: column;
      }
      #hhr-prescription-print-modal .hhr-rx-header { padding: 12px 16px 8px; border-bottom: 1px solid #e7ecea; }
      #hhr-prescription-print-modal .hhr-rx-title { margin: 0; font-size: 17px; font-weight: 650; line-height: 1.2; color: var(--hhr-ink-900); letter-spacing: -.01em; }
      #hhr-prescription-print-modal .hhr-rx-subtitle { margin: 3px 0 0; color: var(--hhr-ink-500); font-size: 12px; line-height: 1.35; }
      #hhr-prescription-print-modal .hhr-rx-close {
        position: absolute; top: 8px; right: 9px; width: 34px; height: 34px; border: 0;
        border-radius: 50%; background: transparent; color: #6b7478; cursor: pointer; font-size: 24px;
        transition: background-color .15s ease, color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-rx-close:hover { background: #eef2f1; color: #3c4a48; }
      #hhr-prescription-print-modal .hhr-rx-close:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-rx-tabs { display: flex; gap: 4px; margin-top: 8px; padding: 3px; background: #f0f4f3; border-radius: 9px; }
      #hhr-prescription-print-modal .hhr-rx-tab {
        flex: 1; min-height: 29px; border: 0; border-radius: 7px; background: transparent; color: #5c686c;
        cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 550;
      }
      #hhr-prescription-print-modal .hhr-rx-tab[aria-selected="true"] { background: #fff; color: var(--hhr-teal-ink); font-weight: 650; box-shadow: 0 1px 4px rgba(16,42,67,.14); }
      #hhr-prescription-print-modal .hhr-rx-tab:disabled { cursor: not-allowed; opacity: .42; }
      #hhr-prescription-print-modal .hhr-rx-tab:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-rx-tab-minor { flex: 0 0 auto; padding: 0 11px; color: #7b8785; font-size: 11.5px; font-weight: 500; }
      #hhr-prescription-print-modal .hhr-rx-tab-minor[aria-selected="true"] { color: var(--hhr-teal-ink); font-weight: 650; }
      #hhr-prescription-print-modal .hhr-rx-dialog-compact { width: min(480px, calc(100vw - 24px)); }
      #hhr-prescription-print-modal .hhr-rx-body { padding: 8px 16px 12px; overflow: auto; min-height: 120px; }
      #hhr-prescription-print-modal .hhr-rx-status { color: var(--hhr-ink-500); font-size: 12.5px; padding: 16px 0; text-align: center; }
      #hhr-prescription-print-modal .hhr-rx-print-feedback {
        margin: 0 0 10px; padding: 9px 12px; border: 0; border-left: 3px solid var(--hhr-green-600);
        border-radius: 6px; background: #ecf8f3; color: #1d6a52; font-size: 12.5px; line-height: 1.45; text-align: left;
      }
      #hhr-prescription-print-modal .hhr-rx-error {
        margin: 0 0 10px; padding: 10px 12px; border: 0; border-left: 3px solid var(--hhr-red-600);
        border-radius: 6px; background: #fdf1f0; color: var(--hhr-red-ink); font-size: 12.5px; line-height: 1.45;
      }
      #hhr-prescription-print-modal .hhr-rx-patient-context {
        display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 8px;
        padding: 8px 11px; border: 1px solid #dbe8e5; border-radius: 9px; background: #f6fbfa;
      }
      #hhr-prescription-print-modal .hhr-rx-patient-context strong { color: var(--hhr-ink-900); font-size: 13px; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-rx-patient-context span { color: var(--hhr-ink-500); font-size: 11.5px; line-height: 1.3; }
      #hhr-prescription-print-modal .hhr-rx-sync-note {
        margin: 0 0 7px; padding: 6px 10px; border-left: 3px solid var(--hhr-amber-600); border-radius: 6px;
        background: #fff8e8; color: #6f5716; font-size: 11.5px; line-height: 1.35;
      }
      #hhr-prescription-print-modal .hhr-rx-list { display: grid; gap: 6px; }
      #hhr-prescription-print-modal .hhr-rx-option {
        display: grid; grid-template-columns: 18px 1fr; gap: 8px; align-items: start; cursor: pointer;
        border: 1px solid #e0e7e5; border-radius: 9px; padding: 8px 11px; background: #fff;
        transition: border-color .15s ease, background-color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-rx-option:hover { border-color: #9fd0ca; background: #f7fbfa; }
      #hhr-prescription-print-modal .hhr-rx-option:has(input:checked) { border-color: var(--hhr-teal-500); background: #effaf7; }
      #hhr-prescription-print-modal .hhr-rx-option.is-disabled { cursor: not-allowed; opacity: .62; background: #f7f8f8; }
      #hhr-prescription-print-modal input[type="radio"], #hhr-prescription-print-modal input[type="checkbox"] { width: 16px; height: 16px; margin: 1px 0 0; accent-color: var(--hhr-teal-500); }
      #hhr-prescription-print-modal .hhr-rx-format-title {
        margin: 12px 0 5px; font-size: 10.5px; font-weight: 700; color: #5d6b68;
        text-transform: uppercase; letter-spacing: .05em;
      }
      #hhr-prescription-print-modal .hhr-rx-list > .hhr-rx-format-title { margin: 5px 0 0; }
      #hhr-prescription-print-modal .hhr-rx-formats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      #hhr-prescription-print-modal .hhr-rx-format-option {
        display: grid; grid-template-columns: 18px 1fr; gap: 7px; align-items: start; cursor: pointer;
        border: 1px solid #e0e7e5; border-radius: 9px; padding: 8px 10px; background: #fff;
        transition: border-color .15s ease, background-color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-rx-format-option:hover { border-color: #9fd0ca; }
      #hhr-prescription-print-modal .hhr-rx-format-option:has(input:checked) { border-color: var(--hhr-teal-500); background: #effaf7; }
      #hhr-prescription-print-modal .hhr-rx-date { display: block; font-size: 13px; font-weight: 550; line-height: 1.25; color: var(--hhr-ink-900); }
      #hhr-prescription-print-modal .hhr-rx-meta { display: block; margin-top: 2px; color: var(--hhr-ink-500); font-size: 11.5px; line-height: 1.3; }
      #hhr-prescription-print-modal .hhr-rx-bulk-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
      #hhr-prescription-print-modal .hhr-rx-search {
        flex: 1; min-width: 0; height: 36px; border: 1px solid #cfd7d8; border-radius: 8px; padding: 0 11px;
        color: #30383b; background: #fff; font: inherit; font-size: 13px;
      }
      #hhr-prescription-print-modal .hhr-rx-search:focus { border-color: #15978b; outline: 3px solid rgba(21,151,139,.14); }
      #hhr-prescription-print-modal .hhr-rx-filter {
        flex: 0 0 auto; max-width: 190px; height: 36px; border: 1px solid #cfd7d8; border-radius: 8px;
        padding: 0 8px; color: #3a4649; background: #fff; font: inherit; font-size: 12.5px; cursor: pointer;
      }
      #hhr-prescription-print-modal .hhr-rx-filter:focus { border-color: #15978b; outline: 3px solid rgba(21,151,139,.14); }
      #hhr-prescription-print-modal .hhr-rx-mini-action {
        border: 0; border-radius: 7px; background: transparent; color: var(--hhr-teal-ink); cursor: pointer;
        padding: 7px 8px; font: inherit; font-size: 12.5px; font-weight: 550; white-space: nowrap;
        transition: background-color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-rx-mini-action:hover { background: var(--hhr-teal-050); }
      #hhr-prescription-print-modal .hhr-rx-mini-action:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-rx-selection-summary { display: flex; justify-content: space-between; gap: 12px; margin: 2px 0 8px; color: #5d696d; font-size: 12px; }
      #hhr-prescription-print-modal .hhr-rx-patient-list { display: block; border: 1px solid #dde3e4; border-radius: 10px; background: #fff; overflow: hidden; }
      #hhr-prescription-print-modal .hhr-rx-patient {
        display: grid; grid-template-columns: 20px minmax(0,1fr) auto auto; gap: 10px; align-items: center;
        border-bottom: 1px solid #eef2f1; padding: 7px 12px; background: #fff; cursor: pointer;
      }
      #hhr-prescription-print-modal .hhr-rx-patient:last-child { border-bottom: 0; }
      #hhr-prescription-print-modal .hhr-rx-patient:hover { background: #f7fbfa; }
      #hhr-prescription-print-modal .hhr-rx-patient:has(input:checked) { background: #effaf7; box-shadow: inset 3px 0 0 #15978b; }
      #hhr-prescription-print-modal .hhr-rx-patient.is-disabled { cursor: default; background: #fafbfb; opacity: .62; }
      #hhr-prescription-print-modal .hhr-rx-patient.hhr-rx-patient-summary { grid-template-columns: minmax(0,1fr) auto; cursor: default; }
      #hhr-prescription-print-modal .hhr-rx-patient.hhr-rx-patient-summary:hover { background: #fff; }
      #hhr-prescription-print-modal .hhr-rx-patient-selection { min-width: 0; cursor: pointer; }
      #hhr-prescription-print-modal .hhr-rx-open-patient {
        border: 1px solid #b8d9d4; background: #f4fbf9; padding: 5px 9px; font-size: 11.5px;
      }
      #hhr-prescription-print-modal .hhr-rx-patient-details { display: grid; gap: 1px; min-width: 0; }
      #hhr-prescription-print-modal .hhr-rx-patient-title {
        display: flex; align-items: baseline; gap: 7px; min-width: 0; white-space: nowrap; overflow: hidden;
        font-size: 12.5px; font-weight: 600; color: #30383b;
      }
      #hhr-prescription-print-modal .hhr-rx-name { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
      #hhr-prescription-print-modal .hhr-rx-bed {
        flex: 0 0 auto; border-radius: 6px; padding: 1px 6px; color: #0b7c72; background: #e7f5f2;
        font-size: 10.5px; font-weight: 700; letter-spacing: .02em;
      }
      #hhr-prescription-print-modal .hhr-rx-badge { flex: 0 0 auto; border-radius: 999px; padding: 1px 7px; color: #117f75; background: #dff4f0; font-size: 10px; font-weight: 600; }
      #hhr-prescription-print-modal .hhr-rx-patient-title .hhr-rx-meta { flex: 0 1 auto; margin: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 400; }
      #hhr-prescription-print-modal .hhr-rx-prescribers {
        display: block; min-width: 0; color: #5c6a68; font-size: 11px; line-height: 1.35;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #hhr-prescription-print-modal .hhr-rx-patient-stats { display: grid; justify-items: end; gap: 2px; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-rx-med-count { border-radius: 999px; padding: 2px 8px; color: #117f75; background: #dff4f0; font-size: 10.5px; font-weight: 700; }
      #hhr-prescription-print-modal .hhr-rx-stat-time { color: #7c8886; font-size: 10px; }
      #hhr-prescription-print-modal .hhr-rx-braden-line { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 1px; color: #536064; font-size: 11px; min-width: 0; }
      #hhr-prescription-print-modal .hhr-rx-braden-score { border-radius: 999px; padding: 1px 7px; color: #725400; background: #fff1bd; font-size: 10.5px; font-weight: 700; }
      #hhr-prescription-print-modal .hhr-rx-braden-missing { color: #7b8589; font-style: italic; }
      #hhr-prescription-print-modal .hhr-rx-footer {
        padding: 10px 16px; border-top: 1px solid #e7ecea; display: flex;
        justify-content: flex-end; gap: 9px; background: #fafcfb;
      }
      #hhr-prescription-print-modal .hhr-rx-action {
        border-radius: 8px; min-height: 38px; padding: 7px 16px; font: inherit; font-size: 13px;
        font-weight: 550; cursor: pointer; border: 1px solid #ccd6d3; background: #fff; color: #3e4a48;
        transition: border-color .15s ease, background-color .15s ease, color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-rx-action:hover { border-color: #9fc9c3; color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-rx-action:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-rx-action-primary { background: var(--hhr-teal-500); border-color: var(--hhr-teal-500); color: #fff; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-rx-action-primary:hover { background: #0f857a; border-color: #0f857a; color: #fff; }
      #hhr-prescription-print-modal .hhr-rx-action:disabled { cursor: not-allowed; opacity: .55; }
      #hhr-prescription-print-modal .hhr-center-dialog {
        width: min(1380px, calc(100vw - 28px)); height: min(790px, calc(100vh - 28px));
        max-height: calc(100vh - 28px); margin: 14px auto; border-radius: 13px;
      }
      #hhr-prescription-print-modal .hhr-center-header {
        min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 56px 0 16px;
        border-bottom: 1px solid #e2e8e6; background: #fff;
      }
      #hhr-prescription-print-modal .hhr-center-header img { width: 24px; height: 22px; object-fit: contain; }
      #hhr-prescription-print-modal .hhr-center-header strong { color: var(--hhr-ink-900); font-size: 15.5px; font-weight: 650; letter-spacing: -.01em; }
      #hhr-prescription-print-modal .hhr-center-regimen-print { margin-left: auto; min-height: 30px; font-size: 11px; }
      #hhr-prescription-print-modal .hhr-center-patientbar {
        position: relative; display: flex; align-items: center; gap: 9px; min-height: 40px;
        padding: 5px 16px; border-bottom: 1px solid #e2e8e6; background: #f6faf9;
      }
      #hhr-prescription-print-modal .hhr-patientbar-tag {
        flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; background: #dff0ec;
        color: var(--hhr-teal-ink); font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      }
      #hhr-prescription-print-modal .hhr-patientbar-name { color: var(--hhr-ink-900); font-size: 12.5px; font-weight: 650; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-patientbar-meta { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64716f; font-size: 11px; }
      #hhr-prescription-print-modal .hhr-patientbar-route {
        flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; background: #fff1d6;
        color: var(--hhr-amber-ink); font-size: 10px; font-weight: 700;
      }
      #hhr-prescription-print-modal .hhr-patientbar-change { flex: 0 0 auto; min-height: 28px; font-size: 11px; }
      #hhr-prescription-print-modal .hhr-patientbar-picker {
        position: absolute; top: calc(100% + 4px); right: 12px; z-index: 6; width: min(440px, calc(100% - 24px));
        padding: 9px; border: 1px solid #d8e1de; border-radius: 11px; background: #fff;
        box-shadow: 0 16px 44px rgba(7,27,49,.22);
      }
      #hhr-prescription-print-modal .hhr-patientbar-search { width: 100%; height: 34px; margin-bottom: 7px; }
      #hhr-prescription-print-modal .hhr-patientbar-list { max-height: 300px; overflow: auto; border: 1px solid #e8eeec; border-radius: 8px; }
      #hhr-prescription-print-modal .hhr-patientbar-option {
        display: grid; grid-template-columns: auto minmax(0,1fr); gap: 2px 8px; align-items: center;
        width: 100%; padding: 7px 10px; border: 0; border-bottom: 1px solid #eef2f1; background: #fff;
        color: var(--hhr-ink-900); cursor: pointer; text-align: left; font: inherit;
      }
      #hhr-prescription-print-modal .hhr-patientbar-option:last-child { border-bottom: 0; }
      #hhr-prescription-print-modal .hhr-patientbar-option .hhr-rx-bed { grid-row: 1 / span 2; align-self: center; }
      #hhr-prescription-print-modal .hhr-patientbar-option:hover { background: #f7fbfa; }
      #hhr-prescription-print-modal .hhr-patientbar-option.is-selected { background: #effaf7; box-shadow: inset 3px 0 0 var(--hhr-teal-500); }
      #hhr-prescription-print-modal .hhr-patientbar-option-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-patientbar-option-meta { grid-column: 2; color: #74807e; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-patientbar-empty { padding: 18px 10px; color: #697674; text-align: center; font-size: 12px; }
      #hhr-prescription-print-modal .hhr-flow-tabs { flex: 0 0 auto; min-width: 230px; margin: 0; }
      #hhr-prescription-print-modal .hhr-home-section-title {
        margin: 14px 0 8px; color: #55635f; font-size: 10.5px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .05em;
      }
      #hhr-prescription-print-modal .hhr-home-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 10px; }
      #hhr-prescription-print-modal .hhr-home-card {
        display: grid; gap: 5px; justify-items: start; padding: 13px 14px; border: 1px solid #e0e8e6;
        border-radius: 12px; background: #fff; color: var(--hhr-ink-900); cursor: pointer; text-align: left;
        font: inherit; box-shadow: 0 1px 2px rgba(16,42,67,.04);
        transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
      }
      #hhr-prescription-print-modal .hhr-home-card:hover { border-color: #9fd0ca; box-shadow: 0 6px 18px rgba(16,42,67,.10); transform: translateY(-1px); }
      #hhr-prescription-print-modal .hhr-home-card:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(15,147,140,.28); }
      #hhr-prescription-print-modal .hhr-home-card strong { font-size: 13px; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-home-card-icon {
        display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px;
        background: #e8f4f1; color: var(--hhr-teal-ink);
      }
      #hhr-prescription-print-modal .hhr-home-card-icon svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
      #hhr-prescription-print-modal .hhr-home-card-desc { color: #6b7876; font-size: 11px; line-height: 1.4; }
      #hhr-prescription-print-modal .hhr-home-card.is-action .hhr-home-card-icon { background: #fff1d6; color: var(--hhr-amber-ink); }
      #hhr-prescription-print-modal .hhr-vitals-trend-card svg { display: block; width: 100%; height: auto; margin-top: 6px; }
      #hhr-prescription-print-modal .hhr-fav-list { display: grid; gap: 6px; margin-bottom: 4px; }
      #hhr-prescription-print-modal .hhr-fav-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 6px; align-items: center; }
      #hhr-prescription-print-modal .hhr-fav-open {
        display: grid; gap: 1px; min-width: 0; padding: 8px 11px; border: 1px solid #e0e7e5;
        border-radius: 9px; background: #fff; color: var(--hhr-ink-900); cursor: pointer; text-align: left; font: inherit;
        transition: border-color .15s ease, background-color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-fav-open:hover { border-color: #9fd0ca; background: #f7fbfa; }
      #hhr-prescription-print-modal .hhr-fav-open strong { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-fav-open span { color: #74807e; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-fav-remove {
        width: 30px; height: 30px; border: 1px solid #e0e7e5; border-radius: 8px; background: #fff;
        color: #8a3d38; cursor: pointer; font-size: 16px; line-height: 1;
      }
      #hhr-prescription-print-modal .hhr-fav-remove:hover { border-color: #e0b3ae; background: #fdf3f2; }
      #hhr-prescription-print-modal .hhr-fav-form { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.4fr) auto; gap: 6px; }
      #hhr-prescription-print-modal .hhr-fav-form .hhr-rx-search { height: 34px; }
      #hhr-prescription-print-modal .hhr-fav-form .hhr-rx-action { min-height: 34px; padding: 5px 13px; }
      #hhr-prescription-print-modal .hhr-route-change-state { margin-left: 12px; padding-right: 26px; color: #8a6714; font-size: 11px; font-weight: 600; }
      #hhr-prescription-print-modal .hhr-route-change-state.is-synced { color: #11766d; }
      #hhr-prescription-print-modal .hhr-route-change-state.is-error,
      #hhr-prescription-print-modal .hhr-route-change-state.is-uncertain { color: #9b2c2c; }
      #hhr-prescription-print-modal .hhr-center-shell { display: grid; grid-template-columns: 92px minmax(0,1fr); min-height: 0; flex: 1; }
      #hhr-prescription-print-modal .hhr-center-nav {
        padding: 9px 7px; border-right: 1px solid #e4eae8; background: #f8fafa; display: flex;
        flex-direction: column; gap: 3px;
      }
      #hhr-prescription-print-modal .hhr-center-nav-session {
        margin-top: auto; min-height: 52px; border-top: 1px solid #e4eae8; border-radius: 0;
        color: #7a8886; font-size: 10px;
      }
      #hhr-prescription-print-modal .hhr-center-nav-session svg { width: 17px; height: 17px; }
      #hhr-prescription-print-modal .hhr-center-nav-session[aria-current="page"] { border-left-color: var(--hhr-teal-500); background: #eef4f2; color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-center-nav-button {
        appearance: none; min-height: 58px; border: 0; border-left: 3px solid transparent; border-radius: 0 8px 8px 0;
        background: transparent; color: #51605d; cursor: pointer; display: grid; place-items: center; align-content: center;
        gap: 4px; font: inherit; font-size: 10.5px; font-weight: 550;
        transition: background-color .15s ease, color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-center-nav-button svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      #hhr-prescription-print-modal .hhr-center-nav-button:hover { background: #ecf5f3; color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-center-nav-button:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-center-nav-button[aria-current="page"] { border-left-color: var(--hhr-teal-500); background: #e8f4f1; color: var(--hhr-teal-ink); font-weight: 700; }
      #hhr-prescription-print-modal .hhr-center-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #fff; position: relative; }
      #hhr-prescription-print-modal .hhr-center-toolbar {
        display: flex; align-items: center; gap: 9px; min-height: 56px; padding: 8px clamp(20px,1.8vw,28px); border-bottom: 1px solid #e6ebe9;
      }
      #hhr-prescription-print-modal .hhr-center-heading { margin: 0 auto 0 0; color: var(--hhr-ink-900); font-size: 15.5px; font-weight: 650; white-space: nowrap; letter-spacing: -.01em; }
      #hhr-prescription-print-modal .hhr-center-search, #hhr-prescription-print-modal .hhr-center-select {
        height: 34px; border: 1px solid #d2dcd9; border-radius: 8px; background: #fff; color: #33403e;
        padding: 0 10px; font: inherit; font-size: 12px;
      }
      #hhr-prescription-print-modal .hhr-center-search { width: min(270px, 24vw); }
      #hhr-prescription-print-modal .hhr-center-search:focus, #hhr-prescription-print-modal .hhr-center-select:focus,
      #hhr-prescription-print-modal .hhr-handoff-input:focus, #hhr-prescription-print-modal .hhr-score-control:focus {
        border-color: var(--hhr-teal-500); outline: none; box-shadow: 0 0 0 3px rgba(15,147,140,.14);
      }
      #hhr-prescription-print-modal .hhr-center-content { min-height: 0; flex: 1; overflow: auto; padding: 14px clamp(20px,1.8vw,28px) 22px; }
      #hhr-prescription-print-modal .hhr-center-notice { margin: 10px 0; padding: 8px 11px; border-left: 3px solid var(--hhr-amber-600); border-radius: 6px; background: #fffaf0; color: #665526; font-size: 11.5px; line-height: 1.4; }
      #hhr-prescription-print-modal .hhr-center-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; color: #36413f; }
      #hhr-prescription-print-modal .hhr-center-table th {
        position: sticky; top: 0; z-index: 1; padding: 7px 8px; border-bottom: 1px solid #d4dedb;
        background: #f6f9f8; color: #55635f; text-align: left; font-size: 10.5px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .04em;
      }
      #hhr-prescription-print-modal .hhr-center-table td { padding: 8px; border-bottom: 1px solid #ebefee; vertical-align: top; overflow-wrap: anywhere; }
      #hhr-prescription-print-modal .hhr-center-table tbody tr:hover { background: #f8fbfa; }
      #hhr-prescription-print-modal .hhr-center-patient { display: block; color: var(--hhr-ink-900); font-weight: 650; }
      #hhr-prescription-print-modal .hhr-center-meta { display: block; margin-top: 2px; color: #74807e; font-size: 10.5px; line-height: 1.35; }
      #hhr-prescription-print-modal .hhr-center-empty { padding: 32px 12px; color: var(--hhr-ink-500); text-align: center; font-size: 12.5px; }
      #hhr-prescription-print-modal .hhr-center-embed { display: flex; flex-direction: column; padding-top: 10px; }
      #hhr-prescription-print-modal .hhr-center-embed .hhr-rx-subtitle { margin: 0 0 8px; }
      #hhr-prescription-print-modal .hhr-center-embed .hhr-rx-body { padding: 0; overflow: visible; min-height: 0; }
      #hhr-prescription-print-modal .hhr-center-toolbar .hhr-rx-tabs { margin: 0 0 0 auto; flex: 0 1 340px; min-width: 240px; }
      #hhr-prescription-print-modal .hhr-recipes-toolbar .hhr-center-heading { margin-right: 0; }
      #hhr-prescription-print-modal .hhr-recipes-toolbar .hhr-rx-module-tabs {
        flex: 0 0 auto; min-width: 0; margin: 0; padding: 2px; background: #eaf3f1;
      }
      #hhr-prescription-print-modal .hhr-recipes-toolbar .hhr-rx-module-tabs .hhr-rx-tab { flex: 0 0 auto; min-height: 27px; padding: 0 12px; font-size: 11.5px; }
      #hhr-prescription-print-modal .hhr-recipes-toolbar .hhr-rx-scope-tabs { margin-left: auto; }
      #hhr-prescription-print-modal .hhr-center-main .hhr-rx-footer { flex: 0 0 auto; }
      #hhr-prescription-print-modal .hhr-handoff-input { width: 100%; min-height: 48px; resize: vertical; box-sizing: border-box; padding: 6px 8px; border: 1px solid #d2dcd9; border-radius: 8px; color: #303a38; background: #fff; font: inherit; font-size: 11.5px; line-height: 1.35; }
      #hhr-prescription-print-modal .hhr-handoff-input:disabled { background: #f5f7f6; color: #818a88; }
      #hhr-prescription-print-modal .hhr-handoff-tools { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; }
      #hhr-prescription-print-modal .hhr-char-count { color: #7a8583; font-size: 10px; }
      #hhr-prescription-print-modal .hhr-row-save {
        min-height: 28px; padding: 4px 11px; border: 1px solid var(--hhr-teal-500); border-radius: 7px;
        background: var(--hhr-teal-500); color: #fff; cursor: pointer; font: inherit; font-size: 11px; font-weight: 650;
        transition: background-color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-row-save:hover { background: #0f857a; }
      #hhr-prescription-print-modal .hhr-row-save:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-row-save:disabled { border-color: #ccd4d2; background: #e8edec; color: #85908e; cursor: not-allowed; }
      #hhr-prescription-print-modal .hhr-handoff-save {
        min-height: 24px; padding: 2px 9px; border-radius: 999px; font-size: 10.5px;
      }
      #hhr-prescription-print-modal .hhr-handoff-diagnosis {
        display: -webkit-box; margin-top: 5px; overflow: hidden; color: #596663; font-size: 10.5px;
        font-weight: 550; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
      }
      #hhr-prescription-print-modal .hhr-protection-action { display: block; margin-top: 6px; padding-inline: 7px; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-sync-state { display: inline-flex; align-items: flex-start; gap: 5px; color: #687572; font-size: 11px; line-height: 1.35; }
      #hhr-prescription-print-modal .hhr-sync-state::before { content: ''; width: 7px; height: 7px; margin-top: 3px; border-radius: 50%; background: #a9b3b1; flex: 0 0 auto; }
      #hhr-prescription-print-modal .hhr-sync-state.is-synced { color: #157650; font-weight: 600; }
      #hhr-prescription-print-modal .hhr-sync-state.is-synced::before { background: #28a66c; }
      #hhr-prescription-print-modal .hhr-sync-state.is-pending { color: #8a6714; }
      #hhr-prescription-print-modal .hhr-sync-state.is-pending::before { background: #d8a72e; }
      #hhr-prescription-print-modal .hhr-sync-state.is-error { color: #a13b35; }
      #hhr-prescription-print-modal .hhr-sync-state.is-error::before { background: #c94c43; }
      #hhr-prescription-print-modal .hhr-history { margin-top: 5px; }
      #hhr-prescription-print-modal .hhr-history summary { color: #0f7c73; cursor: pointer; font-size: 11px; }
      #hhr-prescription-print-modal .hhr-history ol { margin: 6px 0 0; padding-left: 18px; color: #5d6967; font-size: 10.5px; }
      @keyframes hhr-panel-slide { from { opacity: 0; transform: translateX(18px); } }
      #hhr-prescription-print-modal .hhr-score-form {
        position: absolute; inset: 0 0 0 auto; z-index: 3; width: min(560px, 92%); display: flex; flex-direction: column;
        border-left: 1px solid #d8e1de; background: #fff; box-shadow: -16px 0 38px rgba(7,27,49,.16);
        animation: hhr-panel-slide .2s cubic-bezier(.2,.8,.3,1);
      }
      @media (prefers-reduced-motion: reduce) { #hhr-prescription-print-modal .hhr-score-form { animation: none; } }
      #hhr-prescription-print-modal .hhr-score-form-header { display: flex; align-items: center; gap: 8px; min-height: 58px; padding: 0 16px; border-bottom: 1px solid #e0e6e5; }
      #hhr-prescription-print-modal .hhr-score-form-header strong { margin-right: auto; font-size: 15px; }
      #hhr-prescription-print-modal .hhr-score-form-close { width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: #66726f; cursor: pointer; font-size: 22px; }
      #hhr-prescription-print-modal .hhr-score-form-body { flex: 1; overflow: auto; padding: 14px 16px; }
      #hhr-prescription-print-modal .hhr-score-field { display: grid; gap: 5px; margin-bottom: 12px; }
      #hhr-prescription-print-modal .hhr-score-field label { color: #34413f; font-size: 12px; font-weight: 600; line-height: 1.35; }
      #hhr-prescription-print-modal .hhr-score-explanation { color: #73807d; font-size: 10.5px; line-height: 1.35; }
      #hhr-prescription-print-modal .hhr-score-control { width: 100%; min-height: 36px; box-sizing: border-box; border: 1px solid #cfd9d7; border-radius: 6px; padding: 7px 9px; background: #fff; color: #303b39; font: inherit; font-size: 11.5px; }
      #hhr-prescription-print-modal .hhr-score-form-footer { display: flex; align-items: center; gap: 10px; min-height: 62px; padding: 9px 16px; border-top: 1px solid #e0e6e5; background: #fafbfb; }
      #hhr-prescription-print-modal .hhr-score-preview { margin-right: auto; color: #49605c; font-size: 12px; font-weight: 600; }
      #hhr-prescription-print-modal .hhr-center-action {
        min-height: 34px; padding: 5px 12px; border: 1px solid #ccd6d3; border-radius: 8px; background: #fff;
        color: #46514f; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
        transition: border-color .15s ease, background-color .15s ease, color .15s ease;
      }
      #hhr-prescription-print-modal .hhr-center-action:hover { border-color: #9fc9c3; color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-center-action:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-center-action-primary { border-color: var(--hhr-teal-500); background: var(--hhr-teal-500); color: #fff; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-center-action-primary:hover { border-color: #0f857a; background: #0f857a; color: #fff; }
      #hhr-prescription-print-modal .hhr-center-action:disabled { opacity: .48; cursor: not-allowed; }
      #hhr-prescription-print-modal .hhr-lab-patient { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 10px 0; padding: 9px 12px; border: 1px solid #dbe8e5; border-radius: 9px; background: #f6fbfa; color: #43504e; font-size: 11.5px; }
      #hhr-prescription-print-modal .hhr-lab-patient strong { color: var(--hhr-ink-900); font-size: 12.5px; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-lab-status { margin-left: auto; color: var(--hhr-teal-ink); font-weight: 700; }
      #hhr-prescription-print-modal .hhr-lab-exam-list { display: block; border: 1px solid #e0e7e5; border-radius: 10px; background: #fff; overflow: hidden; }
      #hhr-prescription-print-modal .hhr-lab-exam-row { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 8px 11px; border-bottom: 1px solid #eef2f1; background: #fff; }
      #hhr-prescription-print-modal .hhr-lab-exam-row:last-child { border-bottom: 0; }
      #hhr-prescription-print-modal .hhr-lab-exam-row:hover { background: #f7fbfa; }
      #hhr-prescription-print-modal .hhr-lab-exam-row:has(input:checked) { background: #effaf7; box-shadow: inset 3px 0 0 var(--hhr-teal-500); }
      #hhr-prescription-print-modal .hhr-lab-exam-row input { width: 16px; height: 16px; accent-color: var(--hhr-teal-500); }
      #hhr-prescription-print-modal .hhr-lab-exam-title { color: var(--hhr-ink-900); font-size: 12px; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-lab-exam-names { margin-top: 2px; color: #667370; font-size: 10.5px; line-height: 1.4; }
      #hhr-prescription-print-modal .hhr-lab-selection { color: #63706e; font-size: 11px; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-lab-results { margin-top: 12px; border-top: 1px solid #e6ebe9; padding-top: 12px; }
      #hhr-prescription-print-modal .hhr-lab-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 10px; }
      #hhr-prescription-print-modal .hhr-lab-stat { padding: 4px 9px; border-radius: 999px; background: #eef5f3; color: #3f5b57; font-size: 10.5px; font-weight: 700; }
      #hhr-prescription-print-modal .hhr-lab-stat.is-alert { background: #fdefec; color: var(--hhr-red-ink); }
      #hhr-prescription-print-modal .hhr-lab-tabs { display: flex; gap: 2px; margin: 0 0 10px; border-bottom: 1px solid #e0e7e5; }
      #hhr-prescription-print-modal .hhr-lab-tab {
        padding: 7px 11px; border: 0; border-bottom: 2px solid transparent; background: transparent;
        color: #586562; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
      }
      #hhr-prescription-print-modal .hhr-lab-tab:hover { color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-lab-tab:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-lab-tab[aria-selected="true"] { border-bottom-color: var(--hhr-teal-500); color: var(--hhr-teal-ink); font-weight: 700; }
      #hhr-prescription-print-modal .hhr-lab-comparison-wrap { overflow: auto; max-height: 410px; border: 1px solid #dde5e3; border-radius: 7px; }
      #hhr-prescription-print-modal .hhr-lab-comparison { table-layout: auto; min-width: 760px; }
      #hhr-prescription-print-modal .hhr-lab-comparison th:first-child, #hhr-prescription-print-modal .hhr-lab-comparison td:first-child { position: sticky; left: 0; z-index: 2; min-width: 170px; background: #fff; }
      #hhr-prescription-print-modal .hhr-lab-comparison th:first-child { z-index: 3; background: #f4f7f6; }
      #hhr-prescription-print-modal .hhr-lab-value { min-width: 112px; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-lab-value.is-alert { background: #fff2f0; color: #a43730; font-weight: 700; }
      #hhr-prescription-print-modal .hhr-lab-ref { display: block; margin-top: 2px; color: #7b8784; font-size: 9px; font-weight: 400; }
      #hhr-prescription-print-modal .hhr-lab-trends { display: grid; grid-template-columns: repeat(auto-fit,minmax(330px,1fr)); gap: 10px; }
      #hhr-prescription-print-modal .hhr-lab-trend-card { padding: 10px; border: 1px solid #dde5e3; border-radius: 8px; background: #fff; }
      #hhr-prescription-print-modal .hhr-lab-trend-card strong { color: #33423f; font-size: 12px; }
      #hhr-prescription-print-modal .hhr-lab-trend-card svg { display: block; width: 100%; height: 130px; margin-top: 6px; overflow: visible; }
      #hhr-prescription-print-modal .hhr-lab-trend-labels { display: flex; justify-content: space-between; gap: 4px; color: #76827f; font-size: 8.5px; }
      #hhr-prescription-print-modal .hhr-lab-report { margin-bottom: 8px; border: 1px solid #dfe6e5; border-radius: 7px; overflow: hidden; }
      #hhr-prescription-print-modal .hhr-lab-report summary { padding: 9px 11px; background: #f7f9f9; color: #34413f; cursor: pointer; font-size: 11.5px; font-weight: 700; }
      #hhr-prescription-print-modal .hhr-lab-report table { margin: 0; }
      #hhr-prescription-print-modal .hhr-syslab-access { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0; padding: 10px 12px; border: 1px solid #ead18d; border-radius: 9px; background: #fffaf0; } #hhr-prescription-print-modal .hhr-syslab-access[hidden] { display: none; }
      #hhr-prescription-print-modal .hhr-syslab-access > div { display: grid; gap: 3px; min-width: 0; } #hhr-prescription-print-modal .hhr-syslab-access strong { color: #594719; font-size: 11.5px; } #hhr-prescription-print-modal .hhr-syslab-access-message { color: #765c15; font-size: 10.5px; line-height: 1.35; } #hhr-prescription-print-modal .hhr-syslab-access-form { display: flex; gap: 7px; flex: 1 1 420px; justify-content: flex-end; } #hhr-prescription-print-modal .hhr-syslab-access-form input { width: min(180px,30%); min-width: 110px; padding: 0 9px; border: 1px solid #d7c58f; border-radius: 7px; background: #fff; color: var(--hhr-ink-900); font: inherit; }
      #hhr-prescription-print-modal .hhr-connection-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; padding-top: 12px; }
      #hhr-prescription-print-modal .hhr-connection-card {
        border: 1px solid #e0e8e6; border-radius: 12px; background: #fff; padding: 14px 15px;
        box-shadow: 0 1px 2px rgba(16,42,67,.04);
      }
      #hhr-prescription-print-modal .hhr-connection-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      #hhr-prescription-print-modal .hhr-connection-icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: #eef4f3; color: #53615f; font-weight: 700; font-size: 11px; }
      #hhr-prescription-print-modal .hhr-connection-card.is-ready .hhr-connection-icon { background: #e4f4ef; color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-connection-card.is-stale .hhr-connection-icon { background: #fff5df; color: var(--hhr-amber-ink); }
      #hhr-prescription-print-modal .hhr-connection-card h3 { margin: 0; color: var(--hhr-ink-900); font-size: 13.5px; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-connection-status { display: flex; align-items: center; gap: 6px; margin-top: 3px; color: #6b7775; font-size: 11px; font-weight: 600; }
      #hhr-prescription-print-modal .hhr-connection-status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #a9b3b1; }
      #hhr-prescription-print-modal .hhr-connection-card.is-ready .hhr-connection-status { color: var(--hhr-green-ink); }
      #hhr-prescription-print-modal .hhr-connection-card.is-ready .hhr-connection-status::before { background: var(--hhr-green-600); }
      #hhr-prescription-print-modal .hhr-connection-card.is-stale .hhr-connection-status { color: var(--hhr-amber-ink); }
      #hhr-prescription-print-modal .hhr-connection-card.is-stale .hhr-connection-status::before { background: var(--hhr-amber-600); }
      #hhr-prescription-print-modal .hhr-connection-user { min-height: 40px; color: #34413f; font-size: 12.5px; font-weight: 650; }
      #hhr-prescription-print-modal .hhr-connection-detail { display: block; margin-top: 3px; color: #76817f; font-size: 11px; font-weight: 400; line-height: 1.4; }
      #hhr-prescription-print-modal .hhr-connection-actions { display: flex; align-items: center; gap: 7px; margin-top: 12px; }
      #hhr-prescription-print-modal .hhr-connection-privacy {
        margin-top: 12px; padding: 10px 12px; border: 0; border-left: 3px solid var(--hhr-teal-600);
        border-radius: 6px; background: #f4faf8; color: #52605e; font-size: 11.5px; line-height: 1.5;
      }
      #hhr-prescription-print-modal .hhr-connection-feedback { min-height: 18px; margin-top: 10px; color: #64716f; font-size: 11.5px; }
      #hhr-prescription-print-modal .hhr-connection-feedback.is-error { color: var(--hhr-red-ink); }
      #hhr-prescription-print-modal .hhr-imaging-tabs { flex: 0 1 430px; min-width: 300px; margin: 0 0 0 auto; }
      #hhr-prescription-print-modal .hhr-imaging-controls {
        position: sticky; top: 0; z-index: 4; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
        margin: 8px 0 4px; padding: 7px 0; border-bottom: 1px solid #e8eeec; background: rgba(255,255,255,.97);
        box-shadow: 0 5px 10px rgba(255,255,255,.92);
      }
      #hhr-prescription-print-modal .hhr-imaging-physician { flex: 1 1 240px; min-width: 200px; }
      #hhr-prescription-print-modal .hhr-imaging-tools { display: flex; align-items: center; gap: 5px; }
      #hhr-prescription-print-modal .hhr-imaging-tool.is-active { border-color: var(--hhr-teal-500); background: #e8f4f1; color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-imaging-hint { margin: 2px 0 10px; color: #74807e; font-size: 11px; line-height: 1.4; }
      #hhr-prescription-print-modal .hhr-imaging-stage { display: flex; justify-content: center; padding: 4px 0 10px; }
      #hhr-prescription-print-modal .hhr-imaging-canvas {
        position: relative; width: min(720px, 100%); border: 1px solid #dde5e3; border-radius: 8px;
        background: #fff; box-shadow: 0 4px 18px rgba(16,42,67,.10); overflow: hidden;
        cursor: crosshair; user-select: none;
      }
      #hhr-prescription-print-modal .hhr-imaging-canvas:focus-visible { outline: 3px solid rgba(15,147,140,.38); outline-offset: 3px; }
      #hhr-prescription-print-modal .hhr-imaging-image { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
      #hhr-prescription-print-modal .hhr-imaging-overlays { position: absolute; inset: 0; }
      #hhr-prescription-print-modal .hhr-imaging-overlay { position: absolute; color: #000; font-size: 12px; line-height: 1; white-space: nowrap; pointer-events: none; }
      #hhr-prescription-print-modal .hhr-imaging-overlay.is-bold { font-weight: 600; }
      #hhr-prescription-print-modal .hhr-imaging-overlay.is-small { font-size: 10px; }
      #hhr-prescription-print-modal .hhr-imaging-mark { position: absolute; transform: translate(-50%, -50%); color: #1d4ed8; font-size: 15px; font-weight: 700; pointer-events: none; }
      #hhr-prescription-print-modal .hhr-imaging-mark.is-text { transform: translate(0, -50%); font-size: 12px; text-transform: uppercase; }
      #hhr-prescription-print-modal .hhr-imaging-keyboard-cursor {
        position: absolute; z-index: 3; width: 18px; height: 18px; transform: translate(-50%, -50%);
        border: 2px solid var(--hhr-teal-600); border-radius: 50%; background: rgba(255,255,255,.72);
        box-shadow: 0 0 0 2px rgba(255,255,255,.8); pointer-events: none;
      }
      #hhr-prescription-print-modal .hhr-imaging-keyboard-cursor::before,
      #hhr-prescription-print-modal .hhr-imaging-keyboard-cursor::after { content: ''; position: absolute; background: var(--hhr-teal-600); }
      #hhr-prescription-print-modal .hhr-imaging-keyboard-cursor::before { left: 7px; top: -5px; width: 2px; height: 24px; }
      #hhr-prescription-print-modal .hhr-imaging-keyboard-cursor::after { left: -5px; top: 7px; width: 24px; height: 2px; }
      #hhr-prescription-print-modal .hhr-imaging-text-editor {
        position: absolute; transform: translate(0, -50%); z-index: 2; width: 170px; padding: 2px 6px;
        border: 1px solid var(--hhr-teal-500); border-radius: 4px; background: #fff; color: #1d3a4f;
        font: 600 11px/1.3 var(--hhr-font); text-transform: uppercase; outline: none;
        box-shadow: 0 3px 10px rgba(16,42,67,.18);
      }
      #hhr-prescription-print-modal .hhr-vitals-section-title {
        display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
        margin: 14px 0 7px; color: #55635f; font-size: 10.5px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .05em;
      }
      #hhr-prescription-print-modal .hhr-vitals-section-title span:last-child { color: #7c8886; font-weight: 600; text-transform: none; letter-spacing: 0; }
      #hhr-prescription-print-modal .hhr-vitals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
      #hhr-prescription-print-modal .hhr-vitals-tile {
        display: grid; gap: 2px; padding: 9px 10px 8px; border: 1px solid #e0e8e6; border-radius: 10px;
        background: #fbfdfc; text-align: center;
      }
      #hhr-prescription-print-modal .hhr-vitals-label { color: #677573; font-size: 10px; font-weight: 700; letter-spacing: .04em; }
      #hhr-prescription-print-modal .hhr-vitals-value { color: var(--hhr-ink-900); font-size: 19px; font-weight: 700; line-height: 1.1; }
      #hhr-prescription-print-modal .hhr-vitals-unit { color: #8a9694; font-size: 9.5px; }
      #hhr-prescription-print-modal .hhr-vitals-tile.is-warn { border-color: #ecd39a; background: #fffaf0; }
      #hhr-prescription-print-modal .hhr-vitals-tile.is-warn .hhr-vitals-value { color: var(--hhr-amber-ink); }
      #hhr-prescription-print-modal .hhr-vitals-tile.is-alert { border-color: #e7b3ae; background: #fdf3f2; }
      #hhr-prescription-print-modal .hhr-vitals-tile.is-alert .hhr-vitals-value { color: var(--hhr-red-ink); }
      #hhr-prescription-print-modal .hhr-vitals-tile.is-ungraded { border-style: dashed; background: #f7f9f8; }
      #hhr-prescription-print-modal .hhr-vitals-tile.is-ungraded .hhr-vitals-value { color: #5f6d6a; }
      #hhr-prescription-print-modal .hhr-vitals-census { display: grid; gap: 6px; padding-top: 10px; }
      #hhr-prescription-print-modal .hhr-vitals-patient {
        display: grid; grid-template-columns: 64px minmax(220px,1.35fr) minmax(390px,3fr);
        gap: 9px; align-items: center; width: 100%; padding: 7px 9px; border: 1px solid #e0e8e6;
        border-radius: 10px; background: #fff; color: var(--hhr-ink-900); cursor: pointer;
        text-align: left; font: inherit;
      }
      #hhr-prescription-print-modal .hhr-vitals-patient:hover { border-color: #8fc8c1; background: #f6fbfa; }
      #hhr-prescription-print-modal .hhr-vitals-patient:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }
      #hhr-prescription-print-modal .hhr-vitals-patient.is-unavailable { cursor: default; opacity: .68; }
      #hhr-prescription-print-modal .hhr-vitals-bed {
        display: inline-flex; justify-content: center; min-width: 0; padding: 4px 6px; border-radius: 7px;
        background: #e8f4f1; color: var(--hhr-teal-ink); font-size: 11px; font-weight: 750;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #hhr-prescription-print-modal .hhr-vitals-patient-id { display: grid; gap: 2px; min-width: 0; }
      #hhr-prescription-print-modal .hhr-vitals-patient-id strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
      #hhr-prescription-print-modal .hhr-vitals-patient-id span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #74807e; font-size: 10.5px; }
      #hhr-prescription-print-modal .hhr-vitals-patient-id .hhr-vitals-patient-time {
        margin-top: 2px; color: #3f6661; font-size: 10px; font-weight: 650;
      }
      #hhr-prescription-print-modal .hhr-vitals-values { display: grid; grid-template-columns: repeat(6,minmax(52px,1fr)); gap: 4px; min-width: 0; }
      #hhr-prescription-print-modal .hhr-vitals-summary-value { display: grid; gap: 0; min-width: 0; padding: 3px 5px; border-radius: 6px; background: #f5f8f7; }
      #hhr-prescription-print-modal .hhr-vitals-summary-value span { color: #788481; font-size: 8px; font-weight: 700; text-transform: uppercase; }
      #hhr-prescription-print-modal .hhr-vitals-summary-value strong { overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-vitals-summary-value.is-alert strong { color: var(--hhr-red-ink); }
      #hhr-prescription-print-modal .hhr-vitals-summary-value.is-warn strong { color: var(--hhr-amber-ink); }
      #hhr-prescription-print-modal .hhr-vitals-obs { margin: 8px 0 0; padding: 8px 11px; border: 1px solid #e0e8e6; border-radius: 8px; background: #fbfdfc; color: #4c5a58; font-size: 11.5px; line-height: 1.4; }
      #hhr-prescription-print-modal .hhr-vitals-trends { margin-top: 10px; }
      #hhr-prescription-print-modal .hhr-vitals-table-wrap { border: 1px solid #e0e8e6; border-radius: 10px; overflow: auto; max-height: 380px; }
      #hhr-prescription-print-modal .hhr-vitals-table td { white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-vitals-table td.is-warn { color: var(--hhr-amber-ink); font-weight: 700; }
      #hhr-prescription-print-modal .hhr-vitals-table td.is-alert { color: var(--hhr-red-ink); font-weight: 700; background: #fdf3f2; }
      #hhr-prescription-print-modal .hhr-vitals-day td { padding: 5px 8px; background: #f2f6f5; color: #55635f; font-size: 10.5px; font-weight: 700; letter-spacing: .03em; }
      #hhr-prescription-print-modal .hhr-labreq-content { padding: 18px clamp(32px,3vw,44px) 32px; }
      #hhr-prescription-print-modal .hhr-labreq-count { color: #64716f; font-size: 11.5px; white-space: nowrap; }
      #hhr-prescription-print-modal .hhr-labreq-meta {
        display: grid; gap: 7px; margin: 0 0 14px; padding: 10px 12px; border: 1px solid #e3eae8;
        border-radius: 10px; background: #f8fbfa;
      }
      #hhr-prescription-print-modal .hhr-labreq-meta-group { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
      #hhr-prescription-print-modal .hhr-labreq-meta-label { min-width: 84px; color: #55635f; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
      #hhr-prescription-print-modal .hhr-labreq-chip {
        display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 1px solid #d7e0de;
        border-radius: 999px; background: #fff; color: #46534f; cursor: pointer; font-size: 11px; font-weight: 600;
      }
      #hhr-prescription-print-modal .hhr-labreq-chip:has(input:checked) { border-color: var(--hhr-teal-500); background: #e8f4f1; color: var(--hhr-teal-ink); }
      #hhr-prescription-print-modal .hhr-labreq-chip input { width: 13px; height: 13px; margin: 0; accent-color: var(--hhr-teal-500); }
      #hhr-prescription-print-modal .hhr-labreq-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      #hhr-prescription-print-modal .hhr-labreq-column { display: grid; gap: 12px; align-content: start; }
      #hhr-prescription-print-modal .hhr-labreq-section { border: 1px solid #dfe7e5; border-radius: 9px; background: #fff; overflow: hidden; }
      #hhr-prescription-print-modal .hhr-labreq-section header {
        padding: 5px 9px; border-bottom: 1px solid #e6ecea; background: #f6f9f8; color: #45524f;
        font-size: 10.5px; font-weight: 700; text-align: center;
      }
      #hhr-prescription-print-modal .hhr-labreq-section header small { display: block; color: #7c8886; font-size: 8.5px; font-weight: 600; }
      #hhr-prescription-print-modal .hhr-labreq-exam { display: flex; align-items: center; gap: 7px; padding: 3px 9px; cursor: pointer; color: #3d4a47; font-size: 10.5px; }
      #hhr-prescription-print-modal .hhr-labreq-exam:hover { background: #f7fbfa; }
      #hhr-prescription-print-modal .hhr-labreq-exam input { width: 14px; height: 14px; margin: 0; flex: 0 0 auto; }
      #hhr-prescription-print-modal .hhr-labreq-footer { display: flex; gap: 8px; margin-top: 12px; }
      #hhr-prescription-print-modal .hhr-labreq-footer input { flex: 1; }
      @media (max-width: 900px) { #hhr-prescription-print-modal .hhr-labreq-grid { grid-template-columns: 1fr; } }
      @media (max-width: 760px) {
        #hhr-prescription-print-modal .hhr-center-dialog { width: calc(100vw - 16px); height: calc(100vh - 16px); max-height: calc(100vh - 16px); margin: 8px auto; }
        #hhr-prescription-print-modal .hhr-center-shell { grid-template-columns: 1fr; grid-template-rows: auto minmax(0,1fr); }
        #hhr-prescription-print-modal .hhr-center-nav { display: grid; grid-template-columns: repeat(9,1fr); padding: 4px; border-right: 0; border-bottom: 1px solid #e0e6e5; }
        #hhr-prescription-print-modal .hhr-center-nav-session { margin-top: 0; border-top: 0; }
        #hhr-prescription-print-modal .hhr-center-nav-button { min-height: 48px; border-left: 0; border-bottom: 2px solid transparent; border-radius: 5px; font-size: 9.5px; }
        #hhr-prescription-print-modal .hhr-center-nav-button[aria-current="page"] { border-left-color: transparent; border-bottom-color: #15978b; }
        #hhr-prescription-print-modal .hhr-center-toolbar { flex-wrap: wrap; min-height: auto; padding: 8px 12px; }
        #hhr-prescription-print-modal .hhr-center-heading { flex-basis: 100%; }
        #hhr-prescription-print-modal .hhr-center-search { width: 100%; flex: 1 1 160px; }
        #hhr-prescription-print-modal .hhr-center-content { padding: 10px 12px 14px; }
        #hhr-prescription-print-modal .hhr-labreq-content { padding: 12px 16px 18px; }
        #hhr-prescription-print-modal .hhr-vitals-patient { grid-template-columns: 54px minmax(130px,1fr) auto; }
        #hhr-prescription-print-modal .hhr-vitals-values { grid-column: 1 / -1; grid-template-columns: repeat(3,minmax(0,1fr)); }
        #hhr-prescription-print-modal .hhr-vitals-summary-time { grid-column: 1 / -1; justify-self: end; }
        #hhr-prescription-print-modal .hhr-connection-grid { grid-template-columns: 1fr; }
        #hhr-prescription-print-modal .hhr-syslab-access { align-items: stretch; flex-direction: column; } #hhr-prescription-print-modal .hhr-syslab-access-form { flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-start; } #hhr-prescription-print-modal .hhr-syslab-access-form input { flex: 1 1 140px; width: auto; }
        #hhr-prescription-print-modal .hhr-center-table { min-width: 0; display: block; }
        #hhr-prescription-print-modal .hhr-center-table colgroup, #hhr-prescription-print-modal .hhr-center-table thead { display: none; }
        #hhr-prescription-print-modal .hhr-center-table tbody { display: grid; gap: 9px; padding-top: 9px; }
        #hhr-prescription-print-modal .hhr-center-table tbody tr {
          display: block; border: 1px solid #dce4e2; border-radius: 8px; background: #fff; overflow: hidden;
        }
        #hhr-prescription-print-modal .hhr-center-table tbody tr:hover { background: #fff; }
        #hhr-prescription-print-modal .hhr-center-table td {
          display: grid; grid-template-columns: 82px minmax(0,1fr); gap: 8px; padding: 7px 9px;
          border-bottom: 1px solid #edf0ef; overflow-wrap: anywhere;
        }
        #hhr-prescription-print-modal .hhr-center-table td::before {
          content: attr(data-label); color: #687471; font-size: 9.5px; font-weight: 700;
          letter-spacing: .035em; line-height: 1.35; text-transform: uppercase;
        }
        #hhr-prescription-print-modal .hhr-center-table td > .hhr-center-meta,
        #hhr-prescription-print-modal .hhr-handoff-table td[data-label="Nueva entrega"] > .hhr-handoff-tools { grid-column: 2; }
        #hhr-prescription-print-modal .hhr-center-table td:last-child { border-bottom: 0; }
        #hhr-prescription-print-modal .hhr-handoff-input { min-height: 72px; }
        #hhr-prescription-print-modal .hhr-score-form { width: 100%; }
      }
      @media (max-width: 560px) {
        #hhr-prescription-print-modal .hhr-rx-dialog { margin: 16px auto; max-height: calc(100vh - 32px); }
        #hhr-prescription-print-modal .hhr-rx-footer { flex-direction: column-reverse; }
        #hhr-prescription-print-modal .hhr-rx-action { width: 100%; }
        #hhr-prescription-print-modal .hhr-rx-formats { grid-template-columns: 1fr; }
        #hhr-prescription-print-modal .hhr-rx-bulk-toolbar { align-items: stretch; flex-wrap: wrap; }
        #hhr-prescription-print-modal .hhr-rx-search { flex-basis: 100%; }
        #hhr-prescription-print-modal .hhr-rx-header, #hhr-prescription-print-modal .hhr-rx-body, #hhr-prescription-print-modal .hhr-rx-footer { padding-left: 16px; padding-right: 16px; }
      }
      @media (forced-colors: active) {
        #hhr-prescription-print-modal .hhr-rx-dialog { border: 1px solid CanvasText; }
        #hhr-prescription-print-modal button:focus-visible, #hhr-prescription-print-modal input:focus-visible,
        #hhr-prescription-print-modal select:focus-visible, #hhr-prescription-print-modal textarea:focus-visible {
          outline: 2px solid Highlight; outline-offset: 2px;
        }
      }
  `;

  const ensureNoticeStyles = document => installStyle(document, NOTICE_STYLE_ID, noticeCss);
  const ensureCenterStyles = (document, ui) => {
    if (document.getElementById(CENTER_STYLE_ID)) return;
    if (!ui || typeof ui.tokenRule !== 'function') {
      throw new Error('No se pudieron cargar los estilos del Centro HHR.');
    }
    installStyle(document, CENTER_STYLE_ID, centerCss(ui));
  };

  root.HhrCenterStyles = Object.freeze({ ensureNoticeStyles, ensureCenterStyles });
})(typeof globalThis !== 'undefined' ? globalThis : self);
