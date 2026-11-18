/** Navigate the date groups already rendered by Eloísa's native Historial. */
(() => {
  'use strict';
  const HOST_ID = 'hhr-history-date-navigation';
  const STYLE_ID = HOST_ID + '-styles';
  const railCss = `
    [data-hhr-history-rail] { display:flex; }
    [data-hhr-history-rail] > [role="tab"] { flex-shrink:0; }
    [data-hhr-history-rail] > [data-hhr-history-tab] ~ [role="tab"] { order:2; }
    [data-hhr-history-scroll] { overflow-x:auto !important; scrollbar-width:none; }
  `;
  const dateLabel = label => {
    if (/^(Hoy|Ayer)$/i.test(label)) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Pacific/Easter', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const part = type => Number(parts.find(item => item.type === type)?.value);
      const day = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
      if (/^Ayer$/i.test(label)) day.setUTCDate(day.getUTCDate() - 1);
      return label + ' · ' + new Intl.DateTimeFormat('es-CL', {
        timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
      }).format(day);
    }
    return /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(label) ? label : '';
  };
  const create = () => {
    let host = null;
    let groups = [];
    let encounterId = '';
    let tab = null;
    let rail = null;
    let horizontalScroll = null;
    let timelineRoot = null;
    let selected = -1;
    let frame = 0;
    let scroller = window;
    let disposed = false;
    const clear = () => {
      host?.remove();
      rail?.removeAttribute('data-hhr-history-rail');
      tab?.removeAttribute('data-hhr-history-tab');
      horizontalScroll?.removeAttribute('data-hhr-history-scroll');
      host = null;
      rail = null;
      horizontalScroll = null;
      timelineRoot = null;
      groups = [];
      selected = -1;
    };
    const visibleTop = () => {
      const scrollTop = scroller === window ? 0 : scroller.getBoundingClientRect().top;
      return Math.max(scrollTop, rail.getBoundingClientRect().bottom);
    };
    const update = () => {
      frame = 0;
      if (!host?.isConnected || !groups.length) return;
      const boundary = visibleTop() + 16;
      let index = 0;
      groups.forEach((group, candidate) => {
        if (group.element.getBoundingClientRect().top <= boundary) index = candidate;
      });
      const scrollElement = scroller === window ? document.scrollingElement : scroller;
      const viewportHeight = scroller === window ? innerHeight : scrollElement.clientHeight;
      const offset = scroller === window ? window.scrollY : scrollElement.scrollTop;
      const bottom = scroller === window ? innerHeight : scrollElement.getBoundingClientRect().top + scrollElement.clientTop + viewportHeight;
      const last = groups[groups.length - 1].element.getBoundingClientRect();
      if (scrollElement?.scrollHeight > viewportHeight + 2 && offset + viewportHeight >= scrollElement.scrollHeight - 2 &&
          last.top < bottom && last.bottom > boundary) index = groups.length - 1;
      if (selected !== index) {
        selected = index;
        host.shadowRoot.querySelector('select').value = String(index);
      }
      host.shadowRoot.querySelector('[data-step="-1"]').disabled = index === 0;
      host.shadowRoot.querySelector('[data-step="1"]').disabled = index === groups.length - 1;
    };
    const scheduleUpdate = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(update);
    };
    const jump = index => {
      const group = groups[index];
      if (!host?.isConnected || !group?.element.isConnected) return;
      const align = () => scroller.scrollBy({
        top: group.element.getBoundingClientRect().top - visibleTop() - 12,
        behavior: 'instant',
      });
      align();
      // A sticky native header can change position during the first scroll.
      window.cancelAnimationFrame(frame);
      update();
      align();
      scheduleUpdate();
    };
    const revealDates = () => {
      if (!host?.isConnected) return;
      const bounds = horizontalScroll.getBoundingClientRect();
      const dates = host.getBoundingClientRect();
      const left = tab.getBoundingClientRect().left;
      if (dates.right > bounds.right) horizontalScroll.scrollLeft += Math.ceil(dates.right - bounds.right + 4);
      else if (left < bounds.left) horizontalScroll.scrollLeft -= Math.ceil(bounds.left - left + 4);
    };
    const resize = () => {
      revealDates();
      scheduleUpdate();
    };
    const mount = (timeline, tabList) => {
      rail = tabList;
      timelineRoot = timeline;
      horizontalScroll = rail.closest('.MuiTabs-scroller') || rail;
      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = railCss;
        document.head.append(style);
      }
      rail.setAttribute('data-hhr-history-rail', '');
      tab.setAttribute('data-hhr-history-tab', '');
      horizontalScroll.setAttribute('data-hhr-history-scroll', '');
      host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = 'display:flex;align-items:center;flex:none;order:1;margin-inline:6px;';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { color-scheme: light; }
          nav { display:flex;align-items:center;gap:3px;white-space:nowrap;font:12px/1.4 system-ui,sans-serif;color:#22333a; }
          button,select { box-sizing:border-box;height:26px;border:1px solid #d7e1df;border-radius:6px;background:#fff;color:#0b6e66;font:inherit; }
          button { width:24px;flex:none;cursor:pointer;font-size:18px; }
          select { width:136px;padding:0 5px;cursor:pointer; }
          button:hover:not(:disabled),select:hover { background:#edf7f4; }
          button:disabled { opacity:.4;cursor:default; }
          :focus-visible { outline:2px solid #0b6e66;outline-offset:2px; }
        </style>
        <nav aria-label="Navegar por fechas del historial">
            <button type="button" data-step="-1" aria-label="Fecha más reciente">‹</button>
            <select aria-label="Fecha del historial" title="Fechas cargadas en el historial"></select>
            <button type="button" data-step="1" aria-label="Fecha anterior">›</button>
        </nav>`;
      shadow.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => jump(selected + Number(button.dataset.step)));
      });
      shadow.querySelector('select').addEventListener('change', event => jump(Number(event.target.value)));
      // Append after the native tabs in the DOM so MUI retains its tab indices.
      rail.append(host);
      scroller = window;
      for (let parent = timeline; parent && parent !== document.body; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(window.getComputedStyle(parent).overflowY)) {
          scroller = parent;
          break;
        }
      }
    };
    const refresh = nextEncounterId => {
      if (disposed) return;
      if (encounterId !== nextEncounterId) clear();
      encounterId = nextEncounterId;
      const nextTab = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]'))
        .find(element => element.textContent.trim() === 'Historial' && element.getClientRects().length);
      const tabList = nextTab?.parentElement;
      if (!nextEncounterId || !tabList?.matches('[role="tablist"]')) { clear(); return; }
      // Native groups: a date Chip in its own Stack, followed by event Cards.
      // Ignore dates inside cards (birth dates, orders, notes) and hidden tab panels.
      const candidates = Array.from(document.querySelectorAll('.MuiChip-label')).flatMap(chip => {
        const label = dateLabel(chip.textContent.trim());
        const divider = chip.closest('.MuiChip-root')?.parentElement;
        const element = divider?.parentElement;
        if (!label || !element?.matches('.MuiBox-root') ||
            element.firstElementChild !== divider || divider.children.length !== 1 ||
            !divider.nextElementSibling?.matches('.MuiCard-root') ||
            !chip.getClientRects().length || chip.closest('#hhr-prescription-print-modal')) return [];
        return [{ element, label }];
      });
      const timeline = candidates[0]?.element.parentElement;
      const nextGroups = candidates.filter(group => group.element.parentElement === timeline);
      if (!timeline || !nextGroups.length) { clear(); return; }
      if (tab !== nextTab || host?.parentElement !== tabList || timelineRoot !== timeline) clear();
      tab = nextTab;
      const changed = groups.length !== nextGroups.length || nextGroups.some((group, index) =>
        group.element !== groups[index]?.element || group.label !== groups[index]?.label);
      groups = nextGroups;
      const mounted = !host;
      if (mounted) mount(timeline, tabList);
      if (changed) {
        const select = host.shadowRoot.querySelector('select');
        select.replaceChildren(...groups.map((group, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = group.label;
          return option;
        }));
        selected = -1;
      }
      if (mounted) revealDates();
      scheduleUpdate();
    };
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', resize);
    return Object.freeze({
      refresh,
      dispose: () => {
        disposed = true;
        clear();
        window.cancelAnimationFrame(frame);
        window.removeEventListener('scroll', scheduleUpdate, true);
        window.removeEventListener('resize', resize);
      },
    });
  };
  globalThis.HhrHistoryDateNavigation = Object.freeze({ create });
})();
