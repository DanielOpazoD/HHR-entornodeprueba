(function (root) {
  'use strict';

  const DAY_MS = 86_400_000;
  const shiftIsoDay = (iso, days) => {
    const shifted = new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS);
    return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : null;
  };

  const resolveWindow = (lookbackDays, startedAt, completedAt) => {
    const runtime = root.HhrClinicalDayRuntime;
    const days = Number(lookbackDays);
    if (!runtime || !Number.isSafeInteger(days) || days < 3) return null;
    const startedDay = runtime.calendarDayAt(startedAt);
    const completedDay = runtime.calendarDayAt(completedAt);
    if (startedDay !== completedDay) return null;
    const startIsoDay = shiftIsoDay(completedDay, -(days - 2));
    const endIsoDay = shiftIsoDay(completedDay, -1);
    return /^\d{4}-\d{2}-\d{2}$/.test(startIsoDay || '') && endIsoDay
      ? { startIsoDay, endIsoDay }
      : null;
  };

  const responseAttacher = (lookbackDays, startedAt = new Date()) => payload => {
    const coverage = resolveWindow(lookbackDays, startedAt, new Date());
    if (!coverage) return { ...payload, effectiveLookbackDays: lookbackDays };
    return {
      ...payload,
      effectiveLookbackDays: lookbackDays,
      coverageWindowStartIsoDay: coverage.startIsoDay,
      coverageWindowEndIsoDay: coverage.endIsoDay,
    };
  };

  root.HhrClinicalHistoryCoverage = Object.freeze({ resolveWindow, responseAttacher });
})(typeof self !== 'undefined' ? self : globalThis);
