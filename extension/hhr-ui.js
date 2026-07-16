/**
 * hhr-ui.js (ISOLATED world, loaded before every HHR UI content script)
 *
 * Mini design system of the extension. Single source of truth for the visual
 * language shared with the operational map (navy/teal palette), the stroke icon
 * set, the operations-bar stylesheet (Shadow DOM), rich tooltips and roving
 * keyboard focus. UI scripts consume it through globalThis.HhrUI.
 */
(() => {
  'use strict';
  if (globalThis.HhrUI) return;

  // --- Design tokens (kept in sync with docs/mapa-operativo palette) ---
  const tokens = {
    navy950: '#071b31',
    navy900: '#102a43',
    teal700: '#007c83',
    teal600: '#0f938c',
    teal500: '#15978b',
    tealInk: '#0b6e66',
    teal050: '#eefaf8',
    ink900: '#22333a',
    ink700: '#3f5350',
    ink500: '#68797a',
    line200: '#d7e1df',
    surface: '#ffffff',
    green600: '#1ea86d',
    greenInk: '#0d7d67',
    amber600: '#d8a72e',
    amberInk: '#8a6714',
    red600: '#c94c43',
    redInk: '#a43838',
  };

  const tokenVars = `
      --hhr-navy-950: ${tokens.navy950};
      --hhr-navy-900: ${tokens.navy900};
      --hhr-teal-700: ${tokens.teal700};
      --hhr-teal-600: ${tokens.teal600};
      --hhr-teal-500: ${tokens.teal500};
      --hhr-teal-ink: ${tokens.tealInk};
      --hhr-teal-050: ${tokens.teal050};
      --hhr-ink-900: ${tokens.ink900};
      --hhr-ink-700: ${tokens.ink700};
      --hhr-ink-500: ${tokens.ink500};
      --hhr-line-200: ${tokens.line200};
      --hhr-surface: ${tokens.surface};
      --hhr-green-600: ${tokens.green600};
      --hhr-green-ink: ${tokens.greenInk};
      --hhr-amber-600: ${tokens.amber600};
      --hhr-amber-ink: ${tokens.amberInk};
      --hhr-red-600: ${tokens.red600};
      --hhr-red-ink: ${tokens.redInk};
      --hhr-font: Inter, Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      --hhr-radius: 12px;
      --hhr-radius-sm: 9px;
      --hhr-shadow-float: 0 1px 2px rgba(16,42,67,.06), 0 10px 30px rgba(16,42,67,.14);
      --hhr-focus-ring: 0 0 0 3px rgba(15,147,140,.28);
  `;

  /** CSS-variable block reusable on light-DOM roots (e.g. the Centro HHR modal). */
  const tokenRule = selector => `${selector} {${tokenVars}}`;

  // --- Stroke icon set (24×24, consistent 1.9 stroke, lucide-inspired) ---
  const strokeIcon = paths =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  const icons = {
    recipes: strokeIcon(
      '<path d="M10.6 20.4 3.6 13.4a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7Z"/><path d="m8.6 8.6 6.8 6.8"/>'
    ),
    regimen: strokeIcon(
      '<path d="M4 2.5v6.5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2.5"/><path d="M7 2.5v19"/><path d="M20 15V2.5a5 5 0 0 0-4 4.9V13a2 2 0 0 0 2 2h2Z"/><path d="M20 15v6.5"/>'
    ),
    indications: strokeIcon(
      '<path d="M14.5 2.5H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8L14.5 2.5Z"/><path d="M14 2.5V8h6"/><path d="M15.5 13h-7"/><path d="M15.5 17h-7"/>'
    ),
    handoff: strokeIcon(
      '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 13-4 4 4 4"/><path d="M4 17h16"/>'
    ),
    scores: strokeIcon(
      '<path d="M3 3.5v15a2.5 2.5 0 0 0 2.5 2.5H21"/><path d="M8 16.5v-4.5"/><path d="M13 16.5V8"/><path d="M18 16.5v-3"/>'
    ),
    lab: strokeIcon(
      '<path d="M9.5 2.5v6.6L4 18.9a1.9 1.9 0 0 0 1.7 2.8h12.6a1.9 1.9 0 0 0 1.7-2.8L14.5 9.1V2.5"/><path d="M8 2.5h8"/><path d="M6.6 15.5h10.8"/>'
    ),
    imaging: strokeIcon(
      '<circle cx="12" cy="12" r="3.2"/><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/>'
    ),
    vitals: strokeIcon('<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>'),
    star: strokeIcon(
      '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3Z"/>'
    ),
  };

  // --- Operations-bar stylesheet (lives inside its Shadow DOM) ---
  const barCss = `
    :host {${tokenVars}
      position: fixed; top: var(--hhr-ops-top, 70px); right: 18px; z-index: 2147483000;
      display: flex; align-items: center; gap: 5px; height: 44px; padding: 5px 7px 5px 11px;
      border: 1px solid rgba(16,42,67,.11); border-radius: var(--hhr-radius);
      background: linear-gradient(180deg, rgba(255,255,255,.97), rgba(247,251,250,.93));
      box-shadow: var(--hhr-shadow-float);
      backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2);
      color: var(--hhr-ink-700); font-family: var(--hhr-font); line-height: 1.2;
      contain: layout style;
      animation: hhr-bar-enter .3s cubic-bezier(.2,.8,.3,1);
    }
    @keyframes hhr-bar-enter { from { opacity: 0; transform: translateY(-7px); } }
    *, *::before, *::after { box-sizing: border-box; }
    button { appearance: none; border: 0; background: transparent; margin: 0; color: inherit; font: inherit; }
    button:focus { outline: none; }
    button:focus-visible { outline: none; box-shadow: var(--hhr-focus-ring); }

    .brand {
      display: flex; align-items: center; gap: 7px; padding: 3px 8px 3px 4px; cursor: pointer;
      border-radius: var(--hhr-radius-sm); transition: background-color .16s ease;
    }
    .brand:hover { background: var(--hhr-teal-050); }
    .brand-logo { width: 24px; height: 21px; object-fit: contain; flex: 0 0 auto; }
    .brand-name { color: var(--hhr-ink-900); font-size: 11.5px; font-weight: 700; letter-spacing: .01em; white-space: nowrap; }

    .divider { width: 1px; height: 22px; flex: 0 0 auto; background: linear-gradient(180deg, transparent, var(--hhr-line-200) 30%, var(--hhr-line-200) 70%, transparent); }

    .modules { display: flex; align-items: center; gap: 1px; }
    .module {
      display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 9px;
      border-radius: var(--hhr-radius-sm); color: var(--hhr-ink-700); cursor: pointer;
      font-size: 11.5px; font-weight: 600; white-space: nowrap;
      transition: background-color .16s ease, color .16s ease, transform .16s ease;
    }
    .module:hover { background: var(--hhr-teal-050); color: var(--hhr-teal-ink); }
    .module:active { transform: translateY(.5px); }
    .module:disabled, .module.is-disabled { opacity: .38; cursor: not-allowed; }
    .module:disabled:hover, .module.is-disabled:hover { background: transparent; color: var(--hhr-ink-700); transform: none; }
    .module.is-disabled:active { transform: none; }
    .module-icon { padding: 0 7px; }
    .module-icon svg { width: 15px; height: 15px; }
    .module svg { width: 16px; height: 16px; flex: 0 0 auto; }

    .session {
      display: flex; align-items: center; gap: 8px; height: 34px; padding: 2px 10px 2px 4px;
      border-radius: var(--hhr-radius-sm); cursor: pointer; text-align: left;
      transition: background-color .16s ease;
    }
    .session:hover { background: var(--hhr-teal-050); }
    .avatar-wrap { position: relative; flex: 0 0 auto; display: grid; }
    .avatar {
      width: 27px; height: 27px; border-radius: 50%; display: grid; place-items: center;
      background: linear-gradient(160deg, #e6f2f0, #d8ebe8); color: var(--hhr-ink-500);
      font-size: 9.5px; font-weight: 700; letter-spacing: .03em;
    }
    .dot {
      position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%;
      border: 2px solid #fff; background: #a9b3b1; transition: background-color .2s ease;
    }
    .session-copy { display: grid; gap: 1px; min-width: 0; }
    .session-name {
      max-width: 108px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--hhr-ink-900); font-size: 11px; font-weight: 650;
    }
    .session-state { font-size: 9.5px; font-weight: 600; letter-spacing: .015em; color: var(--hhr-ink-500); }
    .session.is-ready .avatar { background: linear-gradient(160deg, #dff3ee, #c9ebe4); color: var(--hhr-teal-ink); }
    .session.is-ready .dot { background: var(--hhr-green-600); }
    .session.is-ready .session-state { color: var(--hhr-green-ink); }
    .session.is-degraded .dot { background: var(--hhr-amber-600); }
    .session.is-degraded .session-state { color: var(--hhr-amber-ink); }
    .session.is-offline .dot { background: var(--hhr-red-600); }
    .session.is-offline .session-state { color: var(--hhr-red-ink); }

    .tip {
      position: absolute; top: calc(100% + 9px); left: 0; z-index: 5; max-width: 264px;
      padding: 8px 11px 9px; border-radius: var(--hhr-radius-sm);
      background: var(--hhr-navy-900); color: #eaf3f7; font-size: 11px; line-height: 1.45;
      box-shadow: 0 12px 30px rgba(7,27,49,.35);
      opacity: 0; transform: translateY(-3px); pointer-events: none;
      transition: opacity .14s ease, transform .14s ease;
    }
    .tip.is-above { top: auto; bottom: calc(100% + 9px); transform: translateY(3px); }
    .tip.is-visible { opacity: 1; transform: none; }
    .tip strong { display: block; color: #fff; font-size: 11.5px; font-weight: 650; }
    .tip span { display: block; margin-top: 2px; color: #b8cdd9; font-size: 10.5px; }
    .tip span:empty { display: none; }

    @media (max-width: 1280px) {
      .brand-name, .module span, .session-copy { display: none; }
      .module { padding: 0 8px; }
      .session { padding-right: 5px; }
    }
    @media (max-width: 820px) { :host { right: 10px; } }
    @media (max-width: 560px) {
      :host {
        top: auto; right: auto; left: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        max-width: calc(100vw - 32px); height: 42px; overflow-x: auto;
      }
      .tip { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      :host { animation: none; }
      .module, .session, .dot, .tip { transition: none; }
    }
    @media (forced-colors: active) {
      :host { border: 1px solid CanvasText; background: Canvas; }
      button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; box-shadow: none; }
    }
  `;

  /**
   * Rich tooltips for elements with [data-tip] / [data-tip-note] inside the bar's
   * shadow root. Expects a single `.tip` element (with <strong> + <span>) in the root.
   */
  const enableBarTooltips = (root, host) => {
    const tip = root.querySelector('.tip');
    if (!tip) return;
    const title = tip.querySelector('strong');
    const note = tip.querySelector('span');
    let showTimer = 0;
    let current = null;
    const hide = () => {
      window.clearTimeout(showTimer);
      current = null;
      tip.classList.remove('is-visible');
    };
    const show = target => {
      const text = target.dataset.tip;
      if (!text) return;
      title.textContent = text;
      note.textContent = target.dataset.tipNote || '';
      tip.style.left = '0px';
      tip.classList.add('is-visible');
      const hostRect = host.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const width = tip.offsetWidth;
      const desired = rect.left + rect.width / 2 - width / 2;
      const clamped = Math.min(Math.max(8, desired), window.innerWidth - width - 8);
      tip.style.left = Math.round(clamped - hostRect.left) + 'px';
      tip.classList.toggle(
        'is-above',
        hostRect.bottom + 9 + tip.offsetHeight > window.innerHeight - 4
      );
    };
    const schedule = (target, delay) => {
      window.clearTimeout(showTimer);
      current = target;
      showTimer = window.setTimeout(() => {
        if (current === target && target.isConnected) show(target);
      }, delay);
    };
    root.addEventListener('pointerover', event => {
      const target = event.target && event.target.closest && event.target.closest('[data-tip]');
      if (!target) return;
      if (target !== current) schedule(target, 240);
    });
    root.addEventListener('pointerout', event => {
      const target = event.target && event.target.closest && event.target.closest('[data-tip]');
      if (target && !target.contains(event.relatedTarget)) hide();
    });
    root.addEventListener('focusin', event => {
      const target = event.target && event.target.closest && event.target.closest('[data-tip]');
      if (target) schedule(target, 60);
      else hide();
    });
    root.addEventListener('focusout', hide);
    root.addEventListener('click', hide, true);
    window.addEventListener('scroll', hide, true);
  };

  /** Left/Right arrow navigation between the bar's enabled buttons (roving focus). */
  const enableRovingFocus = root => {
    root.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const items = Array.from(root.querySelectorAll('button:not(:disabled)'));
      const index = items.indexOf(root.activeElement);
      if (index === -1 || items.length < 2) return;
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : items.length - 1;
      items[(index + step) % items.length].focus();
    });
  };

  globalThis.HhrUI = { tokens, tokenRule, icons, barCss, enableBarTooltips, enableRovingFocus };
})();
