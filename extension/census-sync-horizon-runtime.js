/** Bounded delayed-census policy shared by the extension capture coordinator. */
(function (root) {
  'use strict';
  const MAX_HISTORICAL_LOOKBACK_DAYS = 7;
  const MILLISECONDS_PER_DAY = 86_400_000;
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const localDayAt = date => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  const isoDayNumber = iso => {
    if (!ISO_DAY.test(String(iso || ''))) return null;
    const [year, month, day] = iso.split('-').map(Number);
    const timestamp = Date.UTC(year, month - 1, day);
    return new Date(timestamp).toISOString().slice(0, 10) === iso
      ? timestamp / MILLISECONDS_PER_DAY
      : null;
  };
  const isSupportedTargetDay = (targetDay, at) => {
    const clinicalDay = root.HhrClinicalDayRuntime?.clinicalDayAt(at);
    const target = isoDayNumber(targetDay), current = isoDayNumber(clinicalDay);
    if (target === null || current === null) return false;
    const lookbackDays = current - target;
    return lookbackDays >= 0 && lookbackDays <= MAX_HISTORICAL_LOOKBACK_DAYS;
  };
  const validateCaptureBoundary = (started, completed) => {
    if (localDayAt(completed) !== localDayAt(started)) {
      return 'El día cambió durante la captura. Vuelve a sincronizar para conservar una referencia temporal única.';
    }
    if (root.HhrClinicalDayRuntime?.clinicalDayAt(completed) !==
      root.HhrClinicalDayRuntime?.clinicalDayAt(started)) {
      return 'El turno de enfermería cambió durante la captura. Vuelve a sincronizar para conservar un único corte temporal.';
    }
    return null;
  };
  root.HhrCensusSyncHorizonRuntime = Object.freeze({
    MAX_HISTORICAL_LOOKBACK_DAYS, isSupportedTargetDay, validateCaptureBoundary,
  });
})(typeof self !== 'undefined' ? self : globalThis);
