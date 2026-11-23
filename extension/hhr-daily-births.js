/** Public dates only. Both sources receive an anonymous request from the extension worker. */
(() => {
  'use strict';
  const zone = 'Pacific/Easter';
  const numeric = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const display = new Intl.DateTimeFormat('es', { timeZone: zone, month: 'long', day: 'numeric' });
  let cached;
  const wikipedia = 'https://es.wikipedia.org';
  const articleUrl = title => wikipedia + '/wiki/' + encodeURIComponent(title.replace(/\s+/g, '_'));

  async function retrieve(fetchImpl, url, signal = AbortSignal.timeout(7000)) {
    const response = await fetchImpl(url, {
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
      signal,
    });
    if (!response.ok) throw new Error('No se pudo consultar la fuente pública.');
    return response;
  }

  async function recentPageViews(fetchImpl, ids) {
    const batchSize = 50;
    const signal = AbortSignal.timeout(3500);
    const batches = [];
    for (let start = 0; start < ids.length; start += batchSize) batches.push(ids.slice(start, start + batchSize));
    async function fetchBatch(batch) {
      try {
        const query = new URLSearchParams({
          action: 'query', format: 'json', formatversion: '2', origin: '*',
          prop: 'pageviews', pvipdays: '30', pageids: batch.join('|'),
        });
        const response = await retrieve(fetchImpl, wikipedia + '/w/api.php?' + query, signal);
        const data = await response.json();
        return (data.query?.pages || []).map(page => [
          page.pageid,
          Object.values(page.pageviews || {}).reduce((sum, count) => Number.isFinite(count) && count > 0 ? sum + count : sum, 0),
        ]);
      } catch {
        return [];
      }
    }
    const views = new Map();
    const concurrent = 5;
    for (let start = 0; start < batches.length && !signal.aborted; start += concurrent) {
      const results = await Promise.all(batches.slice(start, start + concurrent).map(fetchBatch));
      for (const [id, count] of results.flat()) views.set(id, count);
    }
    return views;
  }

  async function birthsFor(fetchImpl, month, day) {
    const response = await retrieve(fetchImpl, wikipedia + '/api/rest_v1/feed/onthisday/births/' + month + '/' + day);
    const { births } = await response.json();
    if (!Array.isArray(births)) throw new Error('No se reconoció la lista de nacimientos.');
    const names = new Set();
    const people = [];
    for (const birth of births) {
      const page = birth?.pages?.[0];
      const name = typeof page?.titles?.normalized === 'string' && page.titles.normalized.trim();
      if (!name || !Number.isInteger(birth.year) || names.has(name)) continue;
      names.add(name);
      const description = typeof page.description === 'string' ? page.description.trim().slice(0, 130) : '';
      const id = Number.isSafeInteger(page.pageid) && page.pageid > 0 ? page.pageid : undefined;
      const url = articleUrl(name);
      people.push({ id, name: name.slice(0, 120), year: birth.year, description, url });
    }
    const ids = [...new Set(people.flatMap(person => person.id ? [person.id] : []))];
    const views = await recentPageViews(fetchImpl, ids);
    people.sort((a, b) => (views.get(b.id) || 0) - (views.get(a.id) || 0));
    return people.slice(0, 8).map(({ name, year, description, url }) => ({ name, year, description, url }));
  }

  async function historyFor(fetchImpl, month, day) {
    const feed = wikipedia + '/api/rest_v1/feed/onthisday/';
    const load = async type => {
      const response = await retrieve(fetchImpl, feed + type + '/' + month + '/' + day, AbortSignal.timeout(3500));
      const entries = (await response.json())[type];
      if (!Array.isArray(entries)) throw new Error('No se reconoció la lista de hechos históricos.');
      const result = [];
      for (const entry of entries) {
        const text = typeof entry?.text === 'string' && entry.text.trim();
        if (!text || !Number.isInteger(entry.year) || /^(?:nacen?|mueren?|fallecen?)\b/i.test(text)) continue;
        const titles = (Array.isArray(entry.pages) ? entry.pages : []).map(page => page?.titles?.normalized)
          .filter(title => typeof title === 'string' && title.trim());
        const title = titles.find(title => text.toLocaleLowerCase('es').includes(title.replace(/ \(.*\)$/, '').toLocaleLowerCase('es')))
          || titles[0];
        if (!title) continue;
        const summary = text.length > 185 ? text.slice(0, 185).replace(/\s+\S*$/, '') + '…' : text;
        result.push({ text: summary, year: entry.year, url: articleUrl(title) });
        if (result.length === 3) break;
      }
      return result;
    };
    const selected = await load('selected').catch(() => []);
    return selected.length ? selected : load('events');
  }

  const entityText = Object.freeze({ amp:'&', nbsp:' ', quot:'"', apos:"'", lt:'<', gt:'>' });
  function plainText(html) {
    return html.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi, (entity, key) => {
      if (!key.startsWith('#')) return entityText[key.toLowerCase()];
      const hex = key[1].toLowerCase() === 'x';
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/\s+/g, ' ').trim();
  }

  async function eventsFor(fetchImpl, url, { day, monthName, year }) {
    const html = await (await retrieve(fetchImpl, url)).text();
    const title = html.match(/<title>Efemérides de Chile\s*-\s*([^<]+)<\/title>/i)?.[1];
    if (title?.trim().toLowerCase() !== monthName + ' ' + year) {
      throw new Error('No se reconoció el mes del calendario.');
    }
    const events = new Set();
    let recognizedDates = false;
    // The source exposes a calendar in HTML. Read the dated summary as text only.
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const date = row[1].match(/<td\s+class=["']t2["']\s*>([\s\S]*?)<\/td>/i)?.[1];
      const parts = date && /^(\d{1,2}) (.+)$/.exec(plainText(date).toLowerCase());
      if (!parts || parts[2] !== monthName) continue;
      recognizedDates = true;
      if (Number(parts[1]) !== Number(day)) continue;
      const summary = row[1].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1];
      const text = summary && plainText(summary);
      if (text) events.add(text.slice(0, 160));
      if (events.size === 5) break;
    }
    if (!recognizedDates) throw new Error('No se reconocieron las fechas del calendario.');
    return [...events];
  }

  async function read(now = new Date(), fetchImpl = fetch) {
    const { year, month, day } = Object.fromEntries(numeric.formatToParts(now).map(({ type, value }) => [type, value]));
    const monthName = display.formatToParts(now).find(item => item.type === 'month').value;
    const key = year + '/' + month + '/' + day;
    if (cached?.key !== key) cached = { key };
    const entry = cached;
    const dayPage = articleUrl(Number(day) + ' de ' + monthName);
    const source = dayPage + '#Nacimientos';
    const eventsSource = 'https://www.efemerides.cl/index.php?mesConsulta=' + Number(month);
    entry.births ??= birthsFor(fetchImpl, month, day).catch(() => { delete entry.births; return null; });
    entry.events ??= eventsFor(fetchImpl, eventsSource, { day, monthName, year }).catch(() => { delete entry.events; return null; });
    entry.history ??= historyFor(fetchImpl, month, day).catch(() => { delete entry.history; return null; });
    const [people, events, history] = await Promise.all([entry.births, entry.events, entry.history]);
    return {
      label: display.format(now), source, people: people || [], unavailable: people === null,
      eventsSource, events: events || [], eventsUnavailable: events === null,
      historySource: dayPage + '#Acontecimientos', history: history || [], historyUnavailable: history === null,
    };
  }

  globalThis.HhrDailyBirths = Object.freeze({ read });
})();
