/** Native navigation and read-only evolution layout. Uses Eloísa's existing sections. */
(() => {
  'use strict';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const SECTIONS = {
    alertas: 'alertEntrySection', diagnostico: 'diagnosisEntrySection',
    'solicitud de examen': 'diagnosisTestEntrySection',
    'indicaciones (indicacion libre)': 'freeIndicationEntrySection',
    'indicaciones (medicamento)': 'medicationEntrySection',
    'indicaciones (regimen)': 'nutritionOrderEntrySection',
    evolucion: 'observationEntrySection', 'examen fisico': 'physicalExaminationEntry',
    procedimientos: 'procedureEntrySection', 'ordenes de atencion': 'procedureOrderEntrySection',
    'solicitud interconsulta': 'referralRequestEntrySection', 'indicaciones (reposo)': 'restEntrySection',
    'solicitudes de intervencion quirurgica': 'operationTheaterRequestEntrySection',
    'signos vitales': 'vitalSignsEntry',
  };
  const css = `
    [data-hhr-ficha-primary] { padding:6px 12px !important; min-height:48px !important; box-sizing:border-box; background:#fff; border-bottom:1px solid #dce5e2; }
    [data-hhr-ficha-primary] [role="tab"] { min-height:36px !important; min-width:0 !important; padding:7px 12px !important; border:0; border-radius:7px; font-size:13px; color:#526762; }
    [data-hhr-ficha-primary] [role="tab"][aria-selected="true"] { color:#086b63; background:#e5f3ef; font-weight:600; }
    [data-hhr-ficha-primary] [role="tab"]:focus-visible,[data-hhr-ficha-link]:focus-visible { outline:2px solid #0b6e66; outline-offset:-2px; }
    [data-hhr-ficha-section-slot] { min-height:var(--hhr-section-height,48px); }
    [data-hhr-ficha-sections] { position:fixed !important; top:var(--hhr-section-top) !important; left:var(--hhr-section-left) !important; width:var(--hhr-section-width) !important; max-width:100vw; box-sizing:border-box; margin:0 !important; padding:7px 0 !important; display:flex; flex-wrap:nowrap !important; gap:6px; overflow-x:auto; background:#f6f8f7; border-bottom:1px solid #dce5e2; z-index:25; scrollbar-width:thin; }
    [data-hhr-ficha-sections] > .MuiGrid-item { flex-shrink:0; }
    [data-hhr-ficha-link] { display:inline-block; padding:5px 10px; border:1px solid transparent; border-radius:16px; cursor:pointer; font-size:12px !important; line-height:20px !important; text-decoration:none !important; color:#526762 !important; white-space:nowrap; }
    [data-hhr-ficha-link]:hover { color:#086b63 !important; background:#e5f3ef; }
    [data-hhr-ficha-link][aria-current="location"] { color:#086b63 !important; border-color:#b6d9cd; background:#e5f3ef; font-weight:600; }
    [data-hhr-evolution-block] { width:100% !important; max-width:100% !important; min-width:0; box-sizing:border-box; }
    [data-hhr-evolution-block] > .MuiBox-root { max-width:100%; overflow-wrap:anywhere; }
    [data-hhr-evolution-row] { flex-wrap:wrap !important; }
    [data-hhr-evolution-text] { flex:1 1 100% !important; width:100% !important; max-width:100% !important; min-width:0; overflow-wrap:anywhere; }
    @media(max-width:600px) { [data-hhr-ficha-primary] { padding:6px 4px !important; } [data-hhr-ficha-primary] [role="tab"] { padding:7px 9px !important; font-size:12px; } }
  `;
  const create = () => {
    const marked = new Map();
    const links = new Map();
    let primary = null, row = null, slot = null, style = null;
    let lastTarget = null, frame = 0, disposed = false;
    const mark = (element, attribute) => {
      if (!element) return;
      element.setAttribute(attribute, '');
      if (!marked.has(element)) marked.set(element, new Set());
      marked.get(element).add(attribute);
    };
    const unmark = element => {
      marked.get(element)?.forEach(attribute => element.removeAttribute(attribute));
      marked.delete(element);
    };
    const removeLink = (element, item) => {
      element.removeEventListener('click', item.click);
      element.removeEventListener('keydown', item.keydown);
      ['role', 'tabindex', 'aria-current'].forEach(attribute => {
        const value = item.attributes[attribute];
        if (value === null) element.removeAttribute(attribute); else element.setAttribute(attribute, value);
      });
      unmark(element); links.delete(element);
    };
    const reset = () => {
      resizeObserver?.disconnect();
      links.forEach((item, element) => removeLink(element, item));
      [...marked.keys()].forEach(unmark);
      if (row) ['top', 'left', 'width'].forEach(key => row.style.removeProperty('--hhr-section-' + key));
      slot?.style.removeProperty('--hhr-section-height');
      primary = null; row = null; slot = null; lastTarget = null;
    };
    const update = () => {
      frame = 0;
      if (!row?.isConnected || !primary?.isConnected) return;
      const bounds = slot.getBoundingClientRect();
      const header = primary.closest('.MuiAppBar-root') || primary;
      const top = Math.max(0, header.getBoundingClientRect().bottom);
      row.style.setProperty('--hhr-section-top', top + 'px');
      row.style.setProperty('--hhr-section-left', Math.max(0, bounds.left) + 'px');
      row.style.setProperty('--hhr-section-width', Math.max(0, Math.min(bounds.width, innerWidth - Math.max(0, bounds.left))) + 'px');
      slot.style.setProperty('--hhr-section-height', row.getBoundingClientRect().height + 8 + 'px');
      const boundary = row.getBoundingClientRect().bottom + 14;
      const targets = [...links.entries()].flatMap(([element, item]) => {
        const target = document.getElementById(item.id);
        return target?.getClientRects().length ? [{ element, target, rect: target.getBoundingClientRect() }] : [];
      });
      const active = targets.find(item => item.target === lastTarget && item.rect.top <= boundary + 2 && item.rect.bottom > boundary) ||
        targets.filter(item => item.rect.top <= boundary && item.rect.bottom > boundary).sort((a, b) => b.rect.top - a.rect.top)[0] ||
        targets.filter(item => item.rect.bottom > boundary).sort((a, b) => a.rect.top - b.rect.top)[0];
      links.forEach((_item, element) => {
        if (element === active?.element) element.setAttribute('aria-current', 'location');
        else element.removeAttribute('aria-current');
      });
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(update); };
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const jump = id => {
      const target = document.getElementById(id);
      if (!target?.getClientRects().length || !row?.isConnected) return;
      lastTarget = target;
      let scroller = window;
      for (let parent = target.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) { scroller = parent; break; }
      }
      scroller.scrollBy({ top: target.getBoundingClientRect().top - row.getBoundingClientRect().bottom - 12, behavior: 'instant' });
      schedule();
    };
    const enhanceEvolution = () => {
      const next = new Set();
      const add = (element, attribute) => { mark(element, attribute); next.add(element); };
      const summary = document.getElementById('evolution');
      if (summary?.getClientRects().length && summary.querySelector('.MuiCardHeader-title')?.textContent.trim() === 'Evolución') {
        summary.querySelectorAll('.MuiCardContent-root > .MuiStack-root > .MuiStack-root > .MuiBox-root').forEach(block => {
          if (block.querySelector(':scope > .MuiTypography-caption') && block.querySelector(':scope > .MuiBox-root') &&
              !block.querySelector('input,textarea,[contenteditable="true"],[role="textbox"]')) add(block, 'data-hhr-evolution-block');
        });
      }
      document.querySelectorAll('.MuiCard-root > .MuiCardContent-root').forEach(body => {
        if (!body.getClientRects().length || body.closest('#hhr-prescription-print-modal') ||
            !Array.from(body.children).some(child => child.matches('p.MuiTypography-root') && normalize(child.textContent) === 'evolucion')) return;
        body.querySelectorAll(':scope > .MuiStack-root > .MuiStack-root').forEach(stack => {
          const text = stack.firstElementChild;
          if (text?.matches('p.MuiTypography-root') && !stack.querySelector('input,textarea,[contenteditable="true"],[role="textbox"]')) {
            add(stack, 'data-hhr-evolution-row'); add(text, 'data-hhr-evolution-text');
          }
        });
      });
      [...marked.entries()].filter(([element, attrs]) => [...attrs].some(attr => attr.startsWith('data-hhr-evolution-')) && !next.has(element)).forEach(([element]) => unmark(element));
    };
    const refresh = encounterId => {
      if (disposed) return;
      const tab = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).find(element =>
        element.id?.startsWith('encounter-event-tab-') && element.getClientRects().length);
      if (!encounterId || !tab) { reset(); return; }
      const nextPrimary = tab.closest('.MuiTabs-root');
      if (primary && primary !== nextPrimary) reset();
      primary = nextPrimary;
      resizeObserver?.disconnect();
      if (primary) resizeObserver?.observe(primary);
      if (!style) { style = document.createElement('style'); style.textContent = css; document.head.append(style); }
      if (primary) mark(primary, 'data-hhr-ficha-primary');
      enhanceEvolution();
      const caption = tab.id === 'encounter-event-tab-summary' ? Array.from(document.querySelectorAll('main .MuiTypography-caption'))
        .find(element => normalize(element.textContent) === 'evolucion' && element.getClientRects().length && element.closest('.MuiGrid-container')) : null;
      const nextRow = caption?.closest('.MuiGrid-container');
      if (row && row !== nextRow) {
        links.forEach((item, element) => removeLink(element, item));
        unmark(row); unmark(slot);
        ['top', 'left', 'width'].forEach(key => row.style.removeProperty('--hhr-section-' + key));
        slot?.style.removeProperty('--hhr-section-height'); lastTarget = null;
      }
      row = nextRow || null; slot = row?.parentElement || null;
      if (!row || !slot) return;
      resizeObserver?.observe(slot);
      mark(row, 'data-hhr-ficha-sections'); mark(slot, 'data-hhr-ficha-section-slot');
      [...links.entries()].filter(([element]) => !row.contains(element)).forEach(([element, item]) => removeLink(element, item));
      row.querySelectorAll('.MuiTypography-caption').forEach(element => {
        const id = SECTIONS[normalize(element.textContent)];
        const previous = links.get(element);
        if (previous && (previous.id !== id || !document.getElementById(id))) removeLink(element, previous);
        if (!id || links.has(element) || !document.getElementById(id)) return;
        const item = { id, attributes: Object.fromEntries(['role', 'tabindex', 'aria-current'].map(name => [name, element.getAttribute(name)])) };
        item.click = event => { event.preventDefault(); event.stopPropagation(); jump(item.id); };
        item.keydown = event => { if (event.key === 'Enter' || event.key === ' ') item.click(event); };
        mark(element, 'data-hhr-ficha-link'); element.setAttribute('role', 'link'); element.tabIndex = 0;
        element.addEventListener('click', item.click); element.addEventListener('keydown', item.keydown); links.set(element, item);
      });
      schedule();
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return Object.freeze({ refresh, dispose: () => {
      disposed = true; cancelAnimationFrame(frame); reset(); style?.remove();
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    } });
  };
  globalThis.HhrNativeFichaPresentation = Object.freeze({ create });
})();
