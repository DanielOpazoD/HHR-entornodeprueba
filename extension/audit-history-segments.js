/**
 * audit-history-segments.js (extension — importScripts in the SW, require() in tests)
 *
 * Measured 2026-11-02 against Eloísa: GetHospitalizedEncounterHistory answers HTTP 500 for any
 * period that includes 2026-09-06, the day mainland Chile skipped midnight when summer time began.
 * No date format avoids it, and Eloísa's own Informes screen sends the same request. A period that
 * stops the day before (23:59:59) and one that starts the day after (00:00) are both served, so a
 * stay that crosses such a day is fetched in segments around it. The day itself cannot be obtained.
 *
 * The report server counts days in mainland time, so this is the only module that reads
 * America/Santiago; everything shown to people stays in Rapa Nui time (TIME-02).
 */
(function (root) {
  'use strict';

  const SERVER_ZONE = 'America/Santiago';
  const MAX_DAYS = 4000;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SERVER_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset',
  });
  const partsOf = instant => {
    const parts = {};
    formatter.formatToParts(instant).forEach(part => { parts[part.type] = part.value; });
    return parts;
  };
  const serverDay = instant => {
    const parts = partsOf(instant);
    return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
  };
  const addDays = (day, count) => {
    const next = new Date(Date.UTC(day.y, day.m - 1, day.d + count));
    return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
  };
  const dayKey = day => `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
  const compareDays = (left, right) => dayKey(left).localeCompare(dayKey(right));

  /** Mainland offset around midday of a day, written as ±HH:MM. */
  const offsetOn = day => {
    const match = /GMT([+-]\d{2}:\d{2})/.exec(partsOf(Date.UTC(day.y, day.m - 1, day.d, 16)).timeZoneName || '');
    return match ? match[1] : '+00:00';
  };
  const offsetMinutes = offset => {
    const [, sign, hours, minutes] = /([+-])(\d{2}):(\d{2})/.exec(offset);
    return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  };

  /** A day whose midnight did not exist: the clock moved forward from the day before. */
  const skippedMidnight = day => offsetMinutes(offsetOn(day)) > offsetMinutes(offsetOn(addDays(day, -1)));

  const skippedDaysBetween = (first, last) => {
    const days = [];
    for (let day = first, steps = 0; compareDays(day, last) <= 0 && steps < MAX_DAYS; day = addDays(day, 1), steps += 1) {
      if (skippedMidnight(day)) days.push(day);
    }
    return days;
  };

  const wallClock = (day, time) => `${dayKey(day)}T${time}${offsetOn(day)}`;

  /**
   * Periods of a stay that avoid every day the report server cannot build.
   * Returns { skipped: ['YYYY-MM-DD'], segments: [{ start, end }], parts } where parts lists the
   * segments and the skipped days in time order; no skipped days means no split.
   */
  const segmentsAround = ({ start, end }) => {
    const startAt = Date.parse(start);
    const endAt = Date.parse(end);
    const none = { skipped: [], segments: [], parts: [] };
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt > endAt) return none;
    const lastDay = serverDay(endAt);
    const skipped = skippedDaysBetween(serverDay(startAt), lastDay);
    if (skipped.length === 0) return none;
    const segments = [];
    const parts = [];
    let from = start;
    let fromDay = serverDay(startAt);
    const addSegment = segment => {
      segments.push(segment);
      parts.push({ segment });
    };
    skipped.forEach(day => {
      if (compareDays(fromDay, day) < 0) addSegment({ start: from, end: wallClock(addDays(day, -1), '23:59:59') });
      parts.push({ skippedDay: dayKey(day) });
      fromDay = addDays(day, 1);
      from = wallClock(fromDay, '00:00:00');
    });
    if (compareDays(fromDay, lastDay) <= 0) addSegment({ start: from, end });
    return { skipped: skipped.map(dayKey), segments, parts };
  };

  /** Two periods that split a segment at a mainland midnight, or null when it lies within one day. */
  const halves = ({ start, end }) => {
    const first = serverDay(Date.parse(start));
    const last = serverDay(Date.parse(end));
    const days = Math.round((Date.UTC(last.y, last.m - 1, last.d) - Date.UTC(first.y, first.m - 1, first.d)) / 86400000);
    if (!(days >= 1)) return null;
    const lastOfFirst = addDays(first, Math.floor((days - 1) / 2));
    return [
      { start, end: wallClock(lastOfFirst, '23:59:59') },
      { start: wallClock(addDays(lastOfFirst, 1), '00:00:00'), end },
    ];
  };

  /** The mainland day an instant falls on, as YYYY-MM-DD. */
  const dayOf = instant => dayKey(serverDay(Date.parse(instant)));

  const api = Object.freeze({ dayOf, halves, segmentsAround });
  root.HhrAuditHistorySegments = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
