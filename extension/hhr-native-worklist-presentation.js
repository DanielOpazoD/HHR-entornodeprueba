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
  // The native family-information button uses the same Announcement glyph for pending and idle requests.
  const announcementPath = 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-7 9h-2V5h2zm0 4h-2v-2h2z';
  const css = `
    @media screen {
      .MuiBox-root:has(> .MuiPaper-root #search-encounter-list):has(> [role="tabpanel"]) {
        row-gap:6px;
      }
      ${filters}:has(~ [role="tabpanel"]) {
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
      .hhr-location-bed { font-weight:700; }
      table[${marked}] td:nth-child(2) .MuiTypography-root { overflow-wrap:anywhere; }
      td[data-hhr-worklist-doctor] .MuiOutlinedInput-root:not(:hover,:focus-within) fieldset { border-color:transparent; }
      td[data-hhr-worklist-doctor] .MuiFormControl-root:not(:focus-within) .MuiInputLabel-shrink { opacity:0; }
      td[data-hhr-worklist-doctor] select:not(:hover,:focus) { border-color:transparent; background-color:transparent; }
      .hhr-patient-name-line { display:flex; align-items:center; gap:3px; }
      button[data-hhr-edit-episode] { opacity:0; display:inline-grid; place-items:center; flex:none;
        inline-size:25px; block-size:25px; border:0; border-radius:4px; padding:2px; background:transparent; color:#166963; cursor:pointer; }
      tr:is(:hover,:focus-within) button[data-hhr-edit-episode], button[data-hhr-edit-episode]:focus-visible { opacity:1; }
      @media (hover:none) { button[data-hhr-edit-episode] { opacity:1; } }
      a[data-hhr-bed-link] { display:flex; align-items:center; gap:8px; padding:8px 14px; color:inherit; font:inherit; text-decoration:none; }
      a[data-hhr-bed-link]:is(:hover,:focus-visible) { background:#e7f4f1; }
      /* Both routes keep the filters and tab panels as siblings, including while loading. */
      ${filters}:has(~ [role="tabpanel"]), ${filters} ~ [role="tabpanel"] {
        box-sizing:border-box;
        inline-size:100%;
        /* Use all the space up to 1280px, then grow the gutters up to 7% per side. */
        max-inline-size:clamp(86%, calc(60% + 512px), 100%);
        margin-inline:auto;
      }
    }
    .hhr-hospitalized-panel { box-sizing:border-box; background:white; border-radius:12px; padding:10px 12px; }
    .hhr-hospitalized-panel .hhr-activity-label { display:block; color:#50625e; }
    .MuiTableContainer-root:has(> table[${marked}]) { max-height:none !important; }
    table[${complete}] > tfoot:has(.MuiPagination-root) { display:none !important; }
    td.hhr-worklist-documents { white-space:nowrap; text-align:center; vertical-align:middle; border-bottom:1px solid #ddd; }
    .hhr-worklist-documents button { display:inline-grid; place-items:center; width:28px; height:28px;
      background:transparent; border:0; border-radius:5px; color:#146962; cursor:pointer; vertical-align:middle; }
    .hhr-worklist-documents button:hover, .hhr-worklist-documents button:focus-visible { background:#e2f1ef; }
    .hhr-worklist-documents button:disabled { opacity:.45; cursor:default; }
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
  const create = () => {
    let onWorklist = false;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.getElementById(styleId)?.remove();
    document.head.append(style);

    const clear = () => {
      for (const table of document.querySelectorAll(markedSelector)) {
        table.removeAttribute(marked);
        table.removeAttribute(complete);
      }
    };
    const refresh = pathname => {
      for (const drawer of document.querySelectorAll('.MuiDrawer-paperAnchorLeft, .MuiDrawer-anchorLeft .MuiDrawer-paper')) {
        if (drawer.querySelector('[data-hhr-bed-link]')) continue;
        const nav = [...drawer.querySelectorAll('a,button,[role="button"]')].find(item =>
          /^(Gestión de cuidados|Lista de trabajo médico)$/i.test(item.textContent.trim()));
        if (!nav) continue;
        const link = document.createElement('a');
        link.dataset.hhrBedLink = '';
        link.href = 'https://hospitalizado.rayensalud.cl/#/bed';
        link.target = '_blank';
        link.rel = 'noopener';
        link.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 4v16m18-8v8M3 16h18v-4H9v4m1-8h7a4 4 0 014 4M4 9h4v3H4z"/></svg>Gestión de Camas';
        const item = nav.closest('li') || nav;
        if (item.parentElement.matches('ul,ol')) {
          const wrapper = document.createElement('li');
          wrapper.dataset.hhrBedItem = '';
          wrapper.append(link);
          item.parentElement.append(wrapper);
        } else item.parentElement.append(link);
      }
      const heading = headings[pathname.replace(/\/$/, '')];
      if (!heading) {
        if (onWorklist) clear();
        onWorklist = false;
        return;
      }
      onWorklist = true;
      if (!style.isConnected) document.head?.append(style);
      for (const table of document.querySelectorAll(`${tableSelector},${markedSelector}`)) {
        const container = table.parentElement;
        const title = container.parentElement?.previousElementSibling;
        const result = container.matches('.MuiTableContainer-root') && table.tBodies.length &&
          !table.closest(overlay) && title?.textContent.trim().match(heading);
        if (result) {
          const kind = /^Mis pacientes de interconsulta/i.test(result[0]) ? 'referrals' : 'results';
          if (table.getAttribute(marked) !== kind) table.setAttribute(marked, kind);
        } else {
          table.removeAttribute(marked);
        }
        table.toggleAttribute(complete, Boolean(result && Number(result[1]) === table.tBodies[0].rows.length));
      }
    };
    return Object.freeze({
      refresh,
      dispose() {
        clear();
        document.querySelectorAll('[data-hhr-bed-item],[data-hhr-bed-link]').forEach(node => node.remove());
        style.remove();
      },
    });
  };
  globalThis.HhrNativeWorklistPresentation = Object.freeze({ create });
})();
