/** Bounded HCC date windows. The service rejects requests spanning three full years. */
(function (root) {
  'use strict';
  const EARLIEST_DAY = '19000101';
  const localDay = instant => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Easter', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant).replace(/-/g, '');
  const utcDay = instant => instant.toISOString().slice(0, 10).replace(/-/g, '');
  const parsedDay = value => {
    if (!/^\d{8}$/.test(value || '')) return null;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const instant = new Date(Date.UTC(year, month - 1, day, 12));
    return utcDay(instant) === value ? instant : null;
  };
  const create = (instant, beforeDate) => {
    const today = localDay(instant);
    if (beforeDate && (!parsedDay(beforeDate) || beforeDate > today || beforeDate < EARLIEST_DAY))
      throw new Error('El período de antecedentes solicitado no es válido.');
    const endDate = beforeDate || today;
    const year = Number(endDate.slice(0, 4));
    const month = Number(endDate.slice(4, 6));
    const day = Number(endDate.slice(6, 8));
    const start = new Date(Date.UTC(year, month - 1 - 35, 1, 12));
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
      .getUTCDate();
    start.setUTCDate(Math.min(day, lastDay));
    const startDate = utcDay(start) < EARLIEST_DAY ? EARLIEST_DAY : utcDay(start);
    const priorDay = parsedDay(startDate);
    priorDay.setUTCDate(priorDay.getUTCDate() - 1);
    return {
      startDate,
      endDate,
      nextBeforeDate: startDate === EARLIEST_DAY ? null : utcDay(priorDay),
    };
  };
  root.HhrClinicalAntecedentsWindow = { create, localDay };
})(typeof self !== 'undefined' ? self : globalThis);
