/** Classify an exact publication using the native Eloísa history. */
(() => {
  'use strict';

  const medical = /^m[eé]dic[oa](?:\s+(?:cirujan[oa]|especialista|tratante))?$/i;
  const indications = ['patientPharmaIndicationResume', 'patientFreeIndicationResume', 'nutritionOrderResume', 'restResume'];
  const nameKey = name => typeof name === 'string'
    ? name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() : '';

  function publicationKey(value) {
    if (typeof value !== 'string') return '';
    // clinical-clock-allow raw-offset-clock: Offset-bearing values convert through Date.parse and Intl (Pacific/Easter) below; unzoned values keep local wall time.
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})?$/i.exec(value);
    if (!match) return '';
    const fraction = (match[2] || '').padEnd(7, '0');
    if (!match[3]) return 'wall:' + match[1] + '.' + fraction;
    const instant = Date.parse(value);
    return Number.isFinite(instant) ? 'instant:' + instant + ':' + fraction.slice(3) : '';
  }

  const hospitalTime = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Easter', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const tidy = value => typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim() : '';
  const excerpts = {
    evolutionResume: entry => entry.OBE_NOTES,
    patientPharmaIndicationResume: entry => entry.VIRTUAL_MEDICAL_PRODUCT || entry.DESCRIPTOR,
    patientFreeIndicationResume: entry => entry.INDICATION,
    nutritionOrderResume: entry => entry.DIET_type || entry.OBSERVATION,
    restResume: entry => entry.rest_type || entry.OBSERVATION,
  };
  function localMinute(publication, key) {
    if (key.startsWith('wall:')) return publication.slice(0, 16);
    const parts = Object.fromEntries(hospitalTime.formatToParts(new Date(publication)).map(({ type, value }) => [type, value]));
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
  }

  function describe(events, publication, publisher) {
    const key = publicationKey(publication);
    if (!key || !Array.isArray(events)) return undefined;
    const matches = events.filter(event => publicationKey(event?.publishDatetime) === key);
    if (matches.length !== 1) return undefined;
    const event = matches[0];
    const hasEntries = resume => Array.isArray(event[resume]) && event[resume].length > 0;
    const author = nameKey(publisher);
    // Offsetless timestamps cannot identify the same instant on their own.
    const physicianEntered = resume => hasEntries(resume) && event[resume].every(entry =>
      medical.test(String(entry?.HCPR_NAME || entry?.HCP_ROLE || '').trim()) &&
      (!key.startsWith('wall:') || (author && nameKey(entry?.HCP_LEGAL || entry?.HCP_NAME) === author)));
    const orders = indications.filter(hasEntries);
    const evolution = hasEntries('evolutionResume');
    if (evolution ? (orders.length || !physicianEntered('evolutionResume')) : (!orders.length || !orders.every(physicianEntered))) return;
    const sections = evolution ? ['evolutionResume'] : orders;
    const entries = sections.flatMap(key => event[key].map(entry => ({ key, entry })));
    const authorNames = new Set(entries.map(({ entry }) => tidy(entry.HCP_LEGAL || entry.HCP_NAME)).filter(Boolean));
    const pieces = entries.filter(({ entry }) => ![true, 1, 'true', '1'].some(flag =>
      entry.ARCHIVED === flag || entry.IS_CROSSED_OUT === flag))
      .map(({ key, entry }) => tidy(excerpts[key](entry))).filter(Boolean);
    const excerpt = pieces.join(' · ');
    return {
      kind: evolution ? 'evolution' : 'indication',
      minute: localMinute(publication, key),
      author: (authorNames.size === 1 ? [...authorNames][0] : authorNames.size === 0 ? tidy(publisher) : '').slice(0, 140),
      excerpt: excerpt.length > 220 ? excerpt.slice(0, 219).trimEnd() + '…' : excerpt,
    };
  }

  const classify = (...args) => describe(...args)?.kind;

  function createReader(readHistory) {
    const cache = new Map();
    const lanes = [Promise.resolve(), Promise.resolve()];
    let lane = 0;
    return (episode, publication, publisher, isCurrent) => {
      if (!/^[1-9]\d{0,15}$/.test(episode) || !publicationKey(publication)) return Promise.resolve();
      const previous = cache.get(episode);
      if (previous?.publication === publication && previous.publisher === publisher && previous.isCurrent()) return previous.result;
      const entry = { publication, publisher, isCurrent, result: lanes[lane].then(async () => {
        if (cache.get(episode) !== entry || !isCurrent()) return undefined;
        try {
          const data = await readHistory(episode);
          return cache.get(episode) === entry && isCurrent() ? describe(data, publication, publisher) : undefined;
        } catch (_error) {
          return undefined;
        }
      }) };
      cache.set(episode, entry);
      lanes[lane] = entry.result;
      lane = (lane + 1) % lanes.length;
      return entry.result;
    };
  }

  globalThis.HhrNursingNovelty = Object.freeze({ classify, createReader });
})();
