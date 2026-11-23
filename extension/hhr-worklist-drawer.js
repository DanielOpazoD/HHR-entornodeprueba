/** Display-only utilities for the Eloísa sidebar. */
(() => {
  'use strict';
  const weatherCondition = code => {
    if (code === 0) return ['clear', 'Despejado'];
    if (code < 3) return ['partly', 'Parcialmente nublado'];
    if (code === 3) return ['cloud', 'Nublado'];
    if (code < 50) return ['fog', 'Neblina'];
    if (code >= 95) return ['storm', 'Tormenta'];
    if ((code >= 71 && code <= 77) || code >= 85) return ['snow', 'Nieve'];
    return ['rain', 'Lluvia'];
  };
  const el = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  };

  const sourceIcon = (label, href) => {
    const link = el('a', '', { href, target: '_blank', rel: 'noopener noreferrer',
      class: 'hhr-source-icon', 'aria-label': label, title: label });
    link.append(el('span', '↗', { 'aria-hidden': 'true' }));
    return link;
  };

  function create({ fetchWeather, fetchDailyBirths } = {}) {
    const records = new Map();
    let timer;
    let dailyDialog;
    const tick = () => { for (const { weather } of records.values()) void weather.refresh(); };
    const openDailyBirths = async (drawer, trigger) => {
      if (dailyDialog?.open) return;
      const dialog = el('dialog', '', { 'data-hhr-daily-births-dialog': '', 'aria-label': 'Un día como hoy' });
      const header = el('header', '');
      const heading = el('h2', 'Un día como hoy');
      const close = el('button', '×', { type: 'button', 'aria-label': 'Cerrar', autofocus: '' });
      const content = el('div', '', { class: 'hhr-daily-body' });
      const status = el('p', 'Cargando efemérides…', { role: 'status' });
      header.append(heading, close);
      content.append(status);
      dialog.append(header, content);
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') event.stopPropagation();
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        if (dailyDialog === dialog) dailyDialog = undefined;
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
      }, { once: true });
      drawer.append(dialog);
      dailyDialog = dialog;
      dialog.showModal();

      let data;
      try { data = await fetchDailyBirths?.(); } catch { /* Show the same empty state after a transport failure. */ }
      if (!dialog.open || !dialog.isConnected) return;
      if (!data || data.error) {
        status.textContent = 'No se pudieron cargar las efemérides.';
        return;
      }
      heading.after(el('p', data.label, { class: 'hhr-daily-births-date' }));
      status.remove();
      const events = el('section', '', { class: 'hhr-daily-events' });
      const eventsHeading = el('div', '', { class: 'hhr-daily-source-heading' });
      eventsHeading.append(el('h3', 'Efemérides de Chile'), sourceIcon('Abrir calendario en Efemerides.cl', data.eventsSource));
      events.append(eventsHeading);
      if (data.events?.length) {
        const list = el('ul', '');
        list.append(...data.events.map(title => el('li', title)));
        events.append(list);
      } else {
        events.append(el('p', data.eventsUnavailable
          ? 'Efemerides.cl no está disponible.' : 'Efemerides.cl no registra conmemoraciones para hoy.'));
      }
      const history = el('section', '', { class: 'hhr-daily-history' });
      const historyHeading = el('div', '', { class: 'hhr-daily-source-heading' });
      historyHeading.append(el('h3', 'Hechos históricos'), sourceIcon('Abrir acontecimientos en Wikipedia', data.historySource));
      history.append(historyHeading);
      if (data.history?.length) {
        const list = el('ul', '');
        for (const { text, year, url } of data.history) {
          const item = el('li', '');
          item.append(el('span', String(year), { class: 'hhr-daily-births-year' }),
            el('a', text, { href: url, target: '_blank', rel: 'noopener noreferrer' }));
          list.append(item);
        }
        history.append(list);
      } else {
        history.append(el('p', data.historyUnavailable
          ? 'No se pudieron cargar los hechos históricos.' : 'Sin hechos destacados para esta fecha.'));
      }
      const births = el('section', '');
      const birthsHeading = el('div', '', { class: 'hhr-daily-source-heading' });
      birthsHeading.append(el('h3', 'Nacimientos'), sourceIcon('Abrir nacimientos en Wikipedia', data.source));
      births.append(birthsHeading);
      if (data.people?.length) {
        const list = el('ul', '');
        const extra = el('ul', '');
        for (const { name, year, description, url } of data.people) {
          const item = el('li', '');
          const details = el('div', '');
          details.append(el('a', name, { href: url, target: '_blank', rel: 'noopener noreferrer' }));
          if (description) details.append(el('span', description));
          item.append(el('span', String(year), { class: 'hhr-daily-births-year' }), details);
          (list.children.length < 3 ? list : extra).append(item);
        }
        births.append(list);
        if (extra.children.length) {
          const more = el('details', '', { class: 'hhr-daily-more' });
          more.append(el('summary', 'Más nacimientos (' + extra.children.length + ')'), extra);
          births.append(more);
        }
      } else {
        births.append(el('p', data.unavailable
          ? 'No se pudieron cargar los nacimientos.' : 'No hay nacimientos disponibles para esta fecha.'));
      }
      content.append(history, births, events);
    };
    const weatherCard = () => {
      const card = el('section', '', { 'data-hhr-drawer-weather': '', 'aria-label': 'Tiempo en Rapa Nui' });
      const panel = el('div', 'Consultando el tiempo…', { class: 'hhr-drawer-forecast' });
      const status = el('div', '', { class: 'hhr-weather-status', role: 'status' });
      card.append(panel, status);
      let pending = false;
      let nextRead = 0;
      let hasForecast = false;
      function unavailable() {
        nextRead = Date.now() + 60_000;
        if (hasForecast) status.textContent = 'Pronóstico sin actualizar';
        else panel.textContent = 'Pronóstico no disponible';
      }
      const refresh = async () => {
        if (pending || Date.now() < nextRead || document.hidden || !card.getClientRects().length) return;
        pending = true;
        try {
          const forecast = await fetchWeather?.();
          if (!card.isConnected) return;
          if (forecast?.bands?.length !== 3) { unavailable(); return; }
          nextRead = Math.max(Date.now() + 60_000, forecast.updatedAt + 15 * 60_000);
          const [kind, label] = weatherCondition(forecast.code);
          const sky = el('div', '', { class: 'hhr-weather-sky', 'data-weather': kind, 'aria-hidden': 'true' });
          if (!forecast.isDay) sky.setAttribute('data-night', '');
          sky.append(...['light', 'cloud', 'precip'].map(part => el('span', '', { class: 'hhr-sky-' + part })));
          const hero = el('div', '', { class: 'hhr-weather-hero' });
          const headline = el('div', '');
          const place = el('div', '', { class: 'hhr-weather-place' });
          place.append(el('strong', 'Rapa Nui'), sourceIcon('Abrir Open-Meteo', 'https://open-meteo.com/'));
          headline.append(place, el('span', forecast.current + ' °C', { class: 'hhr-weather-temperature' }));
          hero.append(headline, sky);
          const conditions = el('p', label + ' · Viento ' + forecast.wind + ' km/h', { class: 'hhr-weather-conditions' });
          const slots = el('div', '', { class: 'hhr-drawer-forecast-slots' });
          forecast.bands.forEach(({ min, max, rain, gust }, index) => {
            const slot = el('div', '');
            slot.append(el('strong', index * 24 + '–' + (index + 1) * 24 + ' h'),
              el('span', min + '–' + max + ' °C'),
              el('span', 'Lluvia ' + rain + '%'),
              el('span', 'Ráf. ' + gust + ' km/h', { title: 'Ráfagas máximas' }));
            slots.append(slot);
          });
          panel.replaceChildren(hero, conditions, slots);
          hasForecast = true;
          status.textContent = '';
        } catch (_error) {
          if (card.isConnected) unavailable();
        } finally {
          pending = false;
        }
      };
      return { card, refresh };
    };
    // Paint on the drawer itself, beyond any narrower or clipped native logo wrappers.
    const paintBrandBand = (drawer, brand) => {
      const box = brand?.getBoundingClientRect();
      if (!box?.height) {
        drawer.style.removeProperty('--hhr-drawer-brand-top');
        drawer.style.removeProperty('--hhr-drawer-brand-height');
        return;
      }
      const top = box.top - drawer.getBoundingClientRect().top - drawer.clientTop + drawer.scrollTop;
      drawer.style.setProperty('--hhr-drawer-brand-top', top + 'px');
      drawer.style.setProperty('--hhr-drawer-brand-height', box.height + 'px');
    };
    const markBrand = (drawer, record) => {
      const images = [...drawer.querySelectorAll('img')].filter(img => !img.closest('li,[data-hhr-drawer-tools]'));
      const menu = drawer.querySelector('[data-hhr-menu-icon="worklist"],[data-hhr-menu-icon="care"]');
      const logo = images.find(img =>
        /rayen|elo[ií]sa|logo/i.test((img.getAttribute('alt') || '') + ' ' + (img.getAttribute('src') || ''))) ||
        images.find(img => menu && (img.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING));
      const link = logo?.closest('a');
      let brand = drawer.contains(link) ? link : logo?.parentElement;
      if (brand === drawer) brand = undefined;
      while (brand && brand.parentElement !== drawer && brand.parentElement.childElementCount === 1 &&
             !brand.parentElement.textContent.trim()) {
        brand = brand.parentElement;
      }
      if (record.brand !== brand) {
        if (record.brand) record.resize.unobserve(record.brand);
        record.brand?.removeAttribute('data-hhr-drawer-brand');
        if (brand) {
          brand.setAttribute('data-hhr-drawer-brand', '');
          record.resize.observe(brand);
        }
        record.brand = brand;
      }
      if (record.logo !== (brand ? logo : undefined)) {
        record.logo?.removeAttribute('data-hhr-drawer-logo');
        if (brand) logo?.setAttribute('data-hhr-drawer-logo', '');
        record.logo = brand ? logo : undefined;
      }
      paintBrandBand(drawer, brand);
    };
    const hideNativeClock = (drawer, record) => {
      const native = new Set();
      for (const node of drawer.querySelectorAll('time,p,span,div')) {
        if (node.children.length || node.closest('[data-hhr-drawer-tools],dialog,button,a,[role="button"],[role="link"]')) continue;
        if (node.matches('time') ||
            /^(?:Versión:\s*\S+|\d{2}[-/]\d{2}[-/]\d{4},?\s+\d{2}:\d{2}(?::\d{2})?)$/.test(node.textContent.trim())) native.add(node);
      }
      // A wrapper that serves only the retired footer should not leave a divider or empty space.
      for (const node of native) {
        const parent = node.parentElement;
        if (!parent || parent === drawer || !parent.matches(':is(div,footer,section):not([role],[tabindex],[contenteditable])') ||
            [...parent.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()) ||
            [...parent.children].some(child => !native.has(child) && !child.matches('hr:empty:not([tabindex],[contenteditable])'))) continue;
        native.add(parent);
      }
      for (const node of record.native) if (!native.has(node)) node.removeAttribute('data-hhr-drawer-native-clock');
      for (const node of native) if (!record.native.has(node)) node.setAttribute('data-hhr-drawer-native-clock', '');
      record.native = native;
    };
    const decorate = drawer => {
      if (records.has(drawer)) {
        const record = records.get(drawer);
        markBrand(drawer, record);
        hideNativeClock(drawer, record);
        return;
      }
      const tools = el('section', '', { 'data-hhr-drawer-tools': '', 'aria-label': 'Herramientas de Eloísa' });
      const icons = globalThis.HhrUI?.icons;
      const curiosity = el('button', '', {
        type: 'button', class: 'hhr-drawer-shortcut', 'aria-haspopup': 'dialog',
      });
      curiosity.innerHTML = icons?.calendar || '';
      curiosity.append(el('span', 'Un día como hoy'));
      curiosity.addEventListener('click', event => { if (event.isTrusted) void openDailyBirths(drawer, curiosity); });
      tools.append(globalThis.HhrFavoriteLinks.create(), curiosity);
      const weather = weatherCard();
      drawer.setAttribute('data-hhr-drawer-enhanced', '');
      drawer.append(tools, weather.card);
      const record = { weather, tools, native: new Set() };
      record.resize = new ResizeObserver(() => paintBrandBand(drawer, record.brand));
      record.resize.observe(drawer);
      records.set(drawer, record);
      markBrand(drawer, record);
      hideNativeClock(drawer, record);
      tick();
      timer ??= setInterval(tick, 10_000);
    };
    const removeDecoration = (drawer, { weather, tools, native, brand, logo, resize }) => {
      resize.disconnect();
      paintBrandBand(drawer);
      tools.remove();
      weather.card.remove();
      drawer.removeAttribute('data-hhr-drawer-enhanced');
      brand?.removeAttribute('data-hhr-drawer-brand');
      logo?.removeAttribute('data-hhr-drawer-logo');
      native.forEach(node => node.removeAttribute('data-hhr-drawer-native-clock'));
      records.delete(drawer);
    };
    const prune = () => {
      for (const [drawer, record] of records) if (!drawer.isConnected) removeDecoration(drawer, record);
      if (dailyDialog && !dailyDialog.isConnected) dailyDialog = undefined;
      if (!records.size) { clearInterval(timer); timer = undefined; }
    };
    return { decorate, prune, dispose() {
      dailyDialog?.close();
      dailyDialog?.remove();
      dailyDialog = undefined;
      clearInterval(timer);
      records.forEach((record, drawer) => removeDecoration(drawer, record));
    } };
  }
  globalThis.HhrWorklistDrawer = { create };
})();
