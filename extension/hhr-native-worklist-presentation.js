/** Compact the busy Eloísa worklists without replacing their native rows or controls. */
(() => {
  'use strict';
  const marked = 'data-hhr-compact-worklist';
  const complete = 'data-hhr-complete-worklist';
  const styleId = 'hhr-native-worklist-styles';
  // Match the native result heading that belongs to the table. Tabs, menus and
  // drawers can be hidden or remounted independently of the underlying list.
  const headings = {
    '/dashboard/encounter-list': /^(?:Resultados de b[uú]squeda (?:no asignados|pacientes asignados|pacientes con alta)|Mis pacientes de interconsulta en .+?)\s*\((\d+)\)$/i,
    '/dashboard/encounter-list-nurse': /^(?:Pacientes hospitalizados|Resultados de b[uú]squeda (?:ingresos|con novedad|sin novedad|alta))\s*\((\d+)\)$/i,
  };
  const overlay = 'dialog,[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],.MuiDrawer-root,.MuiPopover-root';
  const tableSelector = '.MuiTableContainer-root > table';
  const markedSelector = `table[${marked}],table[${complete}]`;
  const filters = '.MuiPaper-root:has(#search-encounter-list)';
  const drawers = '.MuiDrawer-paperAnchorLeft, .MuiDrawer-anchorLeft .MuiDrawer-paper';
  const tableScope = '#search-encounter-list,[role="tablist"],[role="tabpanel"],.MuiTableContainer-root,header.MuiAppBar-root';
  const affects = (records, selector, ignored) => records.some(({ target, addedNodes, removedNodes }) => {
    const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
    if (ignored && element?.closest(ignored)) return false;
    if (element?.closest(selector)) return true;
    return [...addedNodes, ...removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE &&
      (!ignored || !node.matches(ignored)) && (node.matches(selector) || node.querySelector(selector)));
  });
  // The native family-information button uses the same Announcement glyph for pending and idle requests.
  const announcementPath = 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-7 9h-2V5h2zm0 4h-2v-2h2z';
  const carePlanLabel = 'Ejecución de cuidados';
  const drawerItems = [
    ['worklist', /^lista de trabajo médico$/i, 'M8 5H5v16h14V5h-3 M9 3h6v4H9z M8 12h8m-8 4h6'],
    ['care', /^gestión de cuidados$/i, 'M12 20s-8-5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 6-8 11-8 11z M9 12h6m-3-3v6'],
    ['plan', /^ejecución (?:de cuidados|(?:del? )?plan de cuidados)$/i, 'M3 6l2 2 3-4m2 3h11M3 14l2 2 3-4m2 3h11'],
    ['reports', /^informes$/i, 'M5 3h10l4 4v14H5z M14 3v5h5M8 16v-3m4 3v-6m4 6v-4'],
    ['beds', /^gestión de camas$/i, 'M3 4v16m18-8v8M3 16h18v-4H9v4m1-8h7a4 4 0 014 4M4 9h4v3H4z'],
  ];
  const drawerIcons = drawerItems.map(([key, , path]) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></svg>';
    return `[data-hhr-menu-icon="${key}"]::before { --hhr-menu-icon:url("data:image/svg+xml,${encodeURIComponent(svg)}"); }`;
  }).join('\n');
  const css = `
    @media screen {
      .MuiBox-root:has(> .MuiPaper-root #search-encounter-list):has(> [role="tabpanel"]) {
        row-gap:6px;
      }
      ${filters}:not([data-hhr-worklist-filterbar]):has(~ [role="tabpanel"]) {
        block-size:auto;
        min-block-size:48px;
        padding-block:4px;
      }
      [role="tabpanel"] :has(+ * > .MuiTableContainer-root > table[${marked}="results"]) { display:none; }
      [role="tabpanel"] :has(+ * > .MuiTableContainer-root > table[${marked}="referrals"]) { padding-block:4px; }
      table[${marked}] > tbody > tr > td button[id="fade-button"][aria-haspopup="true"]:has(svg path[d="${announcementPath}"]) {
        display:none;
      }
      table[${marked}] > tbody > tr:is(:hover,:focus-within) > :is(td,th) { background-color:#e7f4f1 !important; }
      .hhr-location-service,.hhr-location-bed { display:block; }
      .hhr-location-service { font-weight:400; color:#526561; }
      .hhr-location-bed { font-weight:750; color:#183a34; }
      [data-hhr-patient-name-row] > :nth-child(2) { color:#203b36; font-weight:700; }
      table[${marked}] td:nth-child(2) .MuiTypography-root { overflow-wrap:anywhere; }
      td[data-hhr-worklist-doctor] { width:136px; max-width:136px; }
      td[data-hhr-worklist-doctor] :is(.MuiFormControl-root,select) { box-sizing:border-box; width:100%; min-width:0; max-width:136px; }
      td[data-hhr-worklist-doctor] .MuiSelect-select { overflow:hidden; text-overflow:ellipsis; }
      table[${marked}] [data-hhr-discharge-chip] {
        background:#e8f3ee; color:#225a45; border:1px solid #b9d6c8; border-radius:5px;
        min-height:19px; height:auto; width:fit-content; font-size:11px; font-weight:600;
      }
      [data-hhr-discharge-chip] .MuiChip-label { padding-inline:6px; }
      table[${marked}] [data-hhr-new-patient-chip] {
        background:#e8f3ee; color:#225a45; border-radius:4px; height:16px;
        width:fit-content; flex:none; font-size:10px; font-weight:600;
      }
      [data-hhr-new-patient-chip] .MuiChip-label { padding-inline:4px; }
      td[data-hhr-worklist-doctor] .MuiOutlinedInput-root:not(:hover,:focus-within) fieldset { border-color:transparent; }
      td[data-hhr-worklist-doctor] .MuiFormControl-root:not(:focus-within) .MuiInputLabel-shrink { opacity:0; }
      td[data-hhr-worklist-doctor] select:not(:hover,:focus) { border-color:transparent; background-color:transparent; }
      .hhr-patient-name-line { display:flex; align-items:center; gap:3px; }
      td:has([data-hhr-patient-name-row]) { --hhr-patient-icon-width:16px; --hhr-patient-name-gap:6px; }
      [data-hhr-patient-name-row] { display:flex; align-items:center; column-gap:var(--hhr-patient-name-gap); }
      [data-hhr-patient-name-row] > * + * { margin-inline-start:0 !important; }
      .hhr-patient-sex-icon {
        display:grid; place-items:center; flex:0 0 var(--hhr-patient-icon-width);
      }
      td:has([data-hhr-patient-name-row]) > button[data-hhr-copy-run],
      td:has([data-hhr-patient-name-row]) [data-hhr-patient-identifier] {
        margin-inline-start:calc(var(--hhr-patient-icon-width) + var(--hhr-patient-name-gap));
      }
      [data-hhr-patient-identifier] { display:block; }
      button[data-hhr-copy-run] {
        display:block; border:0; padding:1px 0; border-radius:3px; background:transparent; color:#466761;
        font:inherit; font-size:.94em; font-variant-numeric:tabular-nums; cursor:copy;
      }
      button[data-hhr-copy-run]:is(:hover,:focus-visible) { color:#116962; text-decoration:underline; text-underline-offset:2px; }
      button[data-hhr-copy-run]:focus-visible { outline:2px solid #247c73; outline-offset:2px; }
      [data-hhr-patient-novelty] {
        display:inline-grid; place-items:center; flex:none; width:17px; height:17px;
        border-radius:50%; color:#775119; background:#fff0d8;
      }
      a[data-hhr-patient-novelty]:hover { background:#ffe0ab; }
      a[data-hhr-patient-novelty]:focus-visible { outline:2px solid #775119; outline-offset:2px; }
      a[data-hhr-novelty-kind="indication"] { color:#0d6378; background:#e0f3f6; }
      a[data-hhr-novelty-kind="indication"]:hover { background:#c2e7ee; }
      a[data-hhr-novelty-kind="evolution"] { color:#65478b; background:#eee7f8; }
      a[data-hhr-novelty-kind="evolution"]:hover { background:#dfd1f1; }
      button[data-hhr-edit-episode] { opacity:0; display:inline-grid; place-items:center; flex:none;
        inline-size:25px; block-size:25px; border:0; border-radius:4px; padding:2px; background:transparent; color:#166963; cursor:pointer; }
      tr:is(:hover,:focus-within) button[data-hhr-edit-episode], button[data-hhr-edit-episode]:focus-visible { opacity:1; }
      @media (hover:none) { button[data-hhr-edit-episode] { opacity:1; } }
      [data-hhr-menu-icon]::before {
        content:""; flex:none; width:16px; height:16px; background:#397a72;
        -webkit-mask:var(--hhr-menu-icon) center / contain no-repeat;
        mask:var(--hhr-menu-icon) center / contain no-repeat;
      }
      ${drawerIcons}
      .MuiBox-root:has(> .MuiPaper-root #search-encounter-list):has(> .hhr-hospitalized-panel) {
        row-gap:8px;
      }
      #discharge-action-button .MuiMenu-paper { max-inline-size:min(270px, calc(100vw - 32px)); }
      #discharge-action-button .MuiMenu-list { padding:4px; }
      #discharge-action-button .MuiMenuItem-root {
        min-height:34px; padding:6px 9px; border-radius:5px; font-size:.8125rem;
        line-height:1.3; white-space:normal;
      }
      /* Both routes keep the filters and tab panels as siblings, including while loading. */
      ${filters}:not([data-hhr-worklist-filterbar]):has(~ [role="tabpanel"]), ${filters} ~ [role="tabpanel"] {
        box-sizing:border-box;
        inline-size:100%;
        /* Use all the space up to 1280px, then grow the gutters up to 7% per side. */
        max-inline-size:clamp(86%, calc(60% + 512px), 100%);
        margin-inline:auto;
      }
      body:has([data-hhr-worklist-layout]) header.MuiAppBar-root {
        background:#247f75 linear-gradient(105deg,#217f75,#267e74); color:white;
        box-shadow:inset 0 -1px 0 #205e5936;
      }
      [data-hhr-worklist-layout] {
        --hhr-worklist-control-height:28px;
        display:flex !important; flex-flow:row wrap !important;
        align-items:center; gap:7px 8px !important; padding-block-start:4px;
      }
      [data-hhr-worklist-rail] .MuiTabs-indicator { display:none; }
      [data-hhr-worklist-rail], [data-hhr-worklist-rail] .MuiTabs-root { min-height:var(--hhr-worklist-control-height); }
      [data-hhr-worklist-rail] [role="tab"] {
        min-height:var(--hhr-worklist-control-height); min-width:0; margin-inline-end:2px;
        padding:3px 8px; border:1px solid transparent; border-radius:6px;
        color:#455c57; background:transparent; cursor:pointer;
        font-size:.8125rem; text-transform:none; white-space:normal;
      }
      [data-hhr-worklist-rail] [role="tab"]:hover { background:#e8efed; }
      [data-hhr-worklist-rail] [role="tab"][aria-selected="true"] {
        color:#175f57; background:#deefeb; border-color:#c8ddd7; font-weight:650;
      }
      [data-hhr-worklist-layout] > * { flex:0 0 100%; min-width:0; }
      [data-hhr-worklist-layout] > [role="tabpanel"] { order:1; }
      [data-hhr-worklist-layout] > #hhr-clinical-operations-bar {
        position:relative; inset:auto; flex:0 0 auto; margin-inline-start:auto;
        z-index:3;
      }
      [data-hhr-worklist-layout] > [data-hhr-worklist-rail] { flex:0 1 auto; max-width:100%; }
      [data-hhr-worklist-layout] > [data-hhr-worklist-filterbar] {
        flex:0 1 278px; width:auto !important; height:auto !important;
        min-height:var(--hhr-worklist-control-height); padding:0 !important; gap:5px !important; box-sizing:border-box;
        display:flex; align-items:center; background:transparent; box-shadow:none;
        max-inline-size:278px;
      }
      [data-hhr-worklist-filterbar] :is(label[for="search-encounter-list"],#search-encounter-list-label,#select-label-hcp) {
        position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap;
      }
      [data-hhr-worklist-filterbar] .MuiInputBase-root legend { max-width:0 !important; }
      [data-hhr-worklist-filterbar] .MuiInputBase-root {
        height:var(--hhr-worklist-control-height); border-radius:6px; background:#fafcfb;
        font-size:.8125rem;
      }
      [data-hhr-worklist-filterbar] .MuiOutlinedInput-notchedOutline { border-color:#c9d7d3; }
      [data-hhr-worklist-filterbar] .MuiFormControl-root:has(#search-encounter-list) { flex:0 1 138px; min-width:72px; }
      [data-hhr-worklist-filterbar] .MuiFormControl-root:has([role="combobox"]) { flex:0 1 94px; min-width:66px; }
      [data-hhr-worklist-filterbar] .MuiInputBase-root:has(#search-encounter-list) { min-width:0; max-inline-size:138px; }
      [data-hhr-worklist-filterbar] #search-encounter-list {
        box-sizing:border-box; min-width:0; flex:1 1 0; padding-block:3px;
      }
      [data-hhr-worklist-filterbar] #search-encounter-list::placeholder { color:transparent; }
      [data-hhr-worklist-filterbar] .MuiSelect-select[role="combobox"] { padding-block:3px; padding-inline-start:7px; }
      [data-hhr-worklist-filterbar] #long-button {
        box-sizing:border-box; flex:none; min-width:29px; min-height:var(--hhr-worklist-control-height);
        padding:2px 3px; border:1px solid #c9d7d3; border-radius:6px;
        background:#fafcfb; color:#315f58; cursor:pointer;
      }
      [data-hhr-worklist-filterbar] #long-button svg { width:16px; height:16px; }
      [data-hhr-worklist-filterbar] #long-button svg + svg { width:10px; height:10px; }
      [data-hhr-worklist-filterbar] #long-button:hover { background:#e5f1ed; }
      [data-hhr-worklist-rail] [role="tab"]:focus-visible,
      [data-hhr-worklist-filterbar] #long-button:focus-visible { outline:2px solid #247c73; outline-offset:2px; }
      @media(max-width:740px) {
        [data-hhr-worklist-layout] > [data-hhr-worklist-rail] { flex-basis:100%; }
        [data-hhr-worklist-layout] > [data-hhr-worklist-filterbar] { margin-inline-end:0; }
      }
    }
    .hhr-hospitalized-panel { box-sizing:border-box; background:white; border-radius:12px; padding:10px 12px; }
    .hhr-care-source[hidden] { display:none !important; }
    .hhr-worklist-handoff { text-align:center; }
    .hhr-worklist-handoff button {
      display:inline-grid; place-items:center; vertical-align:middle;
      width:30px; height:28px; border:1px solid transparent; border-radius:6px;
      background:transparent; color:#126559; font-size:1.08rem; cursor:pointer;
    }
    .hhr-worklist-handoff button:is(:hover,:focus-visible) { background:#d8efea; }
    .hhr-worklist-handoff button:focus-visible { outline:2px solid #126559; outline-offset:1px; }
    .hhr-worklist-handoff button[data-hhr-handoff-confirmed] {
      background:#e3f5ec; border-color:#b2dfc8; font-size:0;
    }
    .hhr-worklist-handoff button[data-hhr-handoff-confirmed]::after { content:'✓'; font-size:1rem; }
    .hhr-hospitalized-panel .hhr-worklist-activity { font-size:.8333em; color:#50625e; }
    .MuiTableContainer-root:has(> table[${marked}]) { max-height:none !important; }
    @media screen {
      table[${marked}] > thead > tr > th {
        position:sticky; inset-block-start:var(--hhr-worklist-sticky-top, 0px);
        z-index:2; background:#eaf1ee;
      }
      @media (min-width: 900px) {
        .MuiTableContainer-root:has(> table[${marked}]) { overflow:visible; }
      }
      @media (max-width: 899px) {
        .MuiTableContainer-root:has(> table[${marked}]) { max-height:72dvh !important; }
        table[${marked}] > thead > tr > th { inset-block-start:0; }
      }
      @media (hover:hover) and (pointer:fine) {
        table[${marked}] tr:not(:hover,:focus-within) .hhr-worklist-documents button:not(:disabled) { opacity:.22; }
      }
    }
    table[${complete}] > tfoot:has(.MuiPagination-root) { display:none !important; }
    td.hhr-worklist-documents { white-space:nowrap; text-align:center; vertical-align:middle; border-bottom:1px solid #ddd; }
    .hhr-worklist-documents button { display:inline-grid; place-items:center; width:28px; height:28px;
      background:transparent; border:0; border-radius:5px; color:#146962; cursor:pointer; vertical-align:middle; }
    .hhr-worklist-documents button:hover, .hhr-worklist-documents button:focus-visible { background:#e2f1ef; }
    .hhr-worklist-documents button:disabled { opacity:.45; cursor:default; }
    .hhr-worklist-documents svg, [data-hhr-edit-episode] svg { width:16px; height:16px; }
    .hhr-novelty-preview {
      position:fixed; inset:auto; margin:0; box-sizing:border-box; width:min(330px, calc(100vw - 16px));
      max-height:50dvh; overflow:auto; padding:12px; border:1px solid #cbded7; border-radius:9px;
      background:#fff; color:#24443d; box-shadow:0 8px 24px #12362b26; font:13px/1.42 system-ui,sans-serif;
    }
    .hhr-novelty-preview:popover-open { display:grid; gap:5px; }
    .hhr-novelty-meta { color:#4d685f; font-size:12px; }
    .hhr-novelty-preview p { margin:2px 0; overflow-wrap:anywhere; }
    .hhr-novelty-preview a { color:#126559; font-weight:650; width:fit-content; }
    /* A tab that was open during an extension update can retain the old injected button. */
    [data-hhr-patient-code-action="1"] { display:none !important; }
    table[${marked}] > :is(thead,tbody) > tr > :is(th,td) {
      padding-inline:clamp(7px, 1vw, 12px) !important;
    }
    table[${marked}] > thead > tr > th { line-height:1.15 !important; padding-block:4px !important; }
    table[${marked}] > tbody > tr > :is(th,td) { line-height:1.15 !important; padding-block:2px !important; }
    table[${marked}] > tbody > tr > :is(th,td) .MuiTypography-root { line-height:1.15 !important; }
    table[${marked}] > tbody > tr > :is(th,td) .MuiStack-root { row-gap:0 !important; }
    table[${marked}] > tbody > tr > :is(th,td) .MuiStack-root > :not(style) ~ :not(style) {
      margin-block-start:0 !important;
    }
  `;
  const createNoveltyTooltip = () => {
    const selector = '[data-hhr-novelty-help]';
    const tooltip = document.createElement('div');
    tooltip.id = 'hhr-worklist-novelty-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    let anchor;
    const hide = () => {
      anchor?.removeAttribute('aria-describedby');
      anchor = undefined;
      tooltip.remove();
    };
    const position = () => {
      if (!anchor) return;
      if (!anchor.isConnected || !anchor.getClientRects().length) { hide(); return; }
      const box = anchor.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) { hide(); return; }
      const text = anchor.dataset.hhrNoveltyHelp;
      if (tooltip.textContent !== text) tooltip.textContent = text;
      const { width, height } = tooltip.getBoundingClientRect();
      const left = Math.max(8, Math.min(innerWidth - width - 8, box.left + (box.width - width) / 2));
      const top = box.top >= height + 12 ? box.top - height - 6 : box.bottom + 6;
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    };
    const show = event => {
      const target = event.target.closest?.(selector);
      if (!target || target === anchor) return;
      hide();
      anchor = target;
      anchor.setAttribute('aria-describedby', tooltip.id);
      document.body.append(tooltip);
      position();
    };
    const leave = event => {
      if (!anchor || !anchor.contains(event.target) || (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) return;
      hide();
    };
    const dismiss = event => {
      if (event.key === 'Escape') hide();
    };
    const events = [['pointerover', show], ['pointerout', leave], ['focusin', show], ['focusout', leave], ['keydown', dismiss]];
    for (const [type, listener] of events) document.addEventListener(type, listener);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return {
      hide, position,
      dispose() {
        hide();
        for (const [type, listener] of events) document.removeEventListener(type, listener);
        window.removeEventListener('scroll', position, true);
        window.removeEventListener('resize', position);
      },
    };
  };

  function localScrollport(element) {
    for (let parent = element.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
      if (/^(auto|scroll|hidden|overlay)$/.test(getComputedStyle(parent).overflowY)) return parent;
    }
    return null;
  }

  const create = options => {
    let onWorklist = false;
    let currentPath;
    const drawerTools = globalThis.HhrWorklistDrawer?.create(options);
    const renamedLabels = new Map();
    let layout;
    const clearLayout = () => {
      if (!layout) return;
      const { parent, rail, filters } = layout;
      parent.removeAttribute('data-hhr-worklist-layout');
      rail.removeAttribute('data-hhr-worklist-rail');
      filters.removeAttribute('data-hhr-worklist-filterbar');
      layout = undefined;
    };
    const markLayout = pathname => {
      const control = document.getElementById('search-encounter-list');
      const filters = control?.closest('.MuiPaper-root');
      const rail = filters?.previousElementSibling;
      const parent = filters?.parentElement;
      if (!rail || !(rail.matches('[role="tablist"]') || rail.querySelector('[role="tablist"]'))) {
        clearLayout();
        return;
      }
      if (layout?.filters !== filters || layout.rail !== rail) clearLayout();
      layout = { parent, rail, filters };
      parent.dataset.hhrWorklistLayout = pathname.replace(/\/$/, '').endsWith('-nurse') ? 'care' : 'medical';
      rail.dataset.hhrWorklistRail = '';
      filters.dataset.hhrWorklistFilterbar = '';
      if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', 'Buscar por nombre o RUN');
      const station = filters.querySelector('#select-nurse-station-list[role="combobox"]');
      if (station && filters.querySelector('#select-label-hcp')) {
        const label = 'select-label-hcp select-nurse-station-list';
        if (station.getAttribute('aria-labelledby') !== label) station.setAttribute('aria-labelledby', label);
      }
      filters.querySelector('#long-button[aria-label="more"]')?.setAttribute('aria-label', 'Imprimir');
    };
    const noveltyTooltip = createNoveltyTooltip();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.getElementById(styleId)?.remove();
    document.head.append(style);

    const clear = () => {
      for (const table of document.querySelectorAll(markedSelector)) {
        table.removeAttribute(marked);
        table.removeAttribute(complete);
        table.style.removeProperty('--hhr-worklist-sticky-top');
      }
    };
    const refreshDrawer = () => {
      drawerTools?.prune();
      for (const node of renamedLabels.keys()) if (!node.isConnected) renamedLabels.delete(node);
      for (const drawer of document.querySelectorAll(drawers)) {
        let hasWorklist = false;
        for (const item of drawer.querySelectorAll('a,button,[role="button"]')) {
          const label = item.textContent.trim().replace(/\s+/g, ' ');
          const key = !item.querySelector('a,button,[role="button"]') && drawerItems.find(([, pattern]) => pattern.test(label))?.[0];
          if (key === 'care' || key === 'worklist') hasWorklist = true;
          if (key && item.dataset.hhrMenuIcon !== key) item.dataset.hhrMenuIcon = key;
          if (key === 'plan' && label !== carePlanLabel) {
            const text = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
            for (let node = text.nextNode(); node; node = text.nextNode()) {
              if (node.data.trim().replace(/\s+/g, ' ') !== label) continue;
              renamedLabels.set(node, node.data);
              node.data = carePlanLabel;
              break;
            }
          }
          if (!key && item.dataset.hhrMenuIcon) delete item.dataset.hhrMenuIcon;
        }
        if (!hasWorklist) continue;
        const reports = drawer.querySelector('[data-hhr-menu-icon="reports"]');
        const last = reports || [...drawer.querySelectorAll('[data-hhr-menu-icon]:not([data-hhr-bed-link])')].at(-1);
        const item = last?.closest('li');
        const inList = item && drawer.contains(item);
        const anchor = inList ? item : last;
        const current = drawer.querySelector('[data-hhr-bed-link]');
        const currentItem = current?.closest('[data-hhr-bed-item]') || current;
        if (anchor && (!currentItem || currentItem.previousElementSibling !== anchor)) {
          currentItem?.remove();
          const link = document.createElement('a');
          link.dataset.hhrBedLink = '';
          link.dataset.hhrMenuIcon = 'beds';
          link.href = 'https://hospitalizado.rayensalud.cl/#/bed';
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = 'Gestión de Camas';
          if (inList) {
            const row = document.createElement('li');
            row.dataset.hhrBedItem = '';
            row.append(link);
            anchor.after(row);
          } else anchor.after(link);
        }
        drawerTools?.decorate(drawer);
      }
    };
    const refreshTables = pathname => {
      const heading = headings[pathname.replace(/\/$/, '')];
      if (!heading) {
        if (onWorklist) { clear(); clearLayout(); }
        noveltyTooltip.hide();
        onWorklist = false;
        return;
      }
      onWorklist = true;
      markLayout(pathname);
      noveltyTooltip.position();
      if (!style.isConnected) document.head?.append(style);
      const banner = document.querySelector('header.MuiAppBar-root');
      const bannerStyle = banner && getComputedStyle(banner);
      const stickyTop = bannerStyle?.position === 'sticky' ? parseFloat(bannerStyle.top) : NaN;
      const bannerScrollport = Number.isFinite(stickyTop) ? localScrollport(banner) : null;
      const fixedBottom = bannerStyle?.position === 'fixed' ? banner.offsetHeight + (parseFloat(bannerStyle.top) || 0) : 0;
      for (const table of document.querySelectorAll(`${tableSelector},${markedSelector}`)) {
        const container = table.parentElement;
        const title = container.parentElement?.previousElementSibling;
        const result = container.matches('.MuiTableContainer-root') && table.tBodies.length &&
          !table.closest(overlay) && title?.textContent.trim().match(heading);
        if (result) {
          const kind = /^Mis pacientes de interconsulta/i.test(result[0]) ? 'referrals' : 'results';
          if (table.getAttribute(marked) !== kind) table.setAttribute(marked, kind);
          const scrollport = localScrollport(table);
          const stickyBottom = Number.isFinite(stickyTop) && scrollport === bannerScrollport
            ? stickyTop + banner.offsetHeight : 0;
          const offset = Math.max(0, !scrollport && fixedBottom ? fixedBottom : stickyBottom) + 'px';
          if (table.style.getPropertyValue('--hhr-worklist-sticky-top') !== offset) {
            table.style.setProperty('--hhr-worklist-sticky-top', offset);
          }
        } else {
          table.removeAttribute(marked);
          table.style.removeProperty('--hhr-worklist-sticky-top');
        }
        table.toggleAttribute(complete, Boolean(result && Number(result[1]) === table.tBodies[0].rows.length));
      }
    };
    return Object.freeze({
      isWorklist: pathname => Object.hasOwn(headings, pathname.replace(/\/$/, '')),
      refresh(pathname, records) {
        const full = pathname !== currentPath || !records;
        currentPath = pathname;
        if (full || affects(records, drawers + ', .MuiDrawer-anchorLeft')) refreshDrawer();
        if (full || (onWorklist && affects(records, tableScope, overlay))) refreshTables(pathname);
      },
      dispose() {
        clear();
        clearLayout();
        noveltyTooltip.dispose();
        drawerTools?.dispose();
        for (const [node, original] of renamedLabels) {
          if (node.isConnected && node.data === carePlanLabel) node.data = original;
        }
        renamedLabels.clear();
        document.querySelectorAll('[data-hhr-bed-item],[data-hhr-bed-link]').forEach(node => node.remove());
        document.querySelectorAll('[data-hhr-menu-icon]').forEach(node => node.removeAttribute('data-hhr-menu-icon'));
        style.remove();
      },
    });
  };
  globalThis.HhrNativeWorklistPresentation = Object.freeze({ create });
})();
