(function (root) {
  'use strict';

  const DAY_MS = 86_400_000;
  const shiftIsoDay = (iso, days) =>
    new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

  const resolveWindow = (lookbackDays, startedAt, completedAt) => {
    const runtime = root.HhrClinicalDayRuntime;
    const days = Number(lookbackDays);
    if (!runtime || !Number.isInteger(days) || days < 3 || days > 180) return null;
    const startedDay = runtime.calendarDayAt(startedAt);
    const completedDay = runtime.calendarDayAt(completedAt);
    if (startedDay !== completedDay) return null;
    return {
      startIsoDay: shiftIsoDay(completedDay, -(days - 2)),
      endIsoDay: shiftIsoDay(completedDay, -1),
    };
  };

  const responseAttacher = (lookbackDays, startedAt = new Date()) => payload => {
    const coverage = resolveWindow(lookbackDays, startedAt, new Date());
    return {
      ...payload,
      effectiveLookbackDays: lookbackDays,
      ...(coverage
        ? {
            coverageWindowStartIsoDay: coverage.startIsoDay,
            coverageWindowEndIsoDay: coverage.endIsoDay,
          }
        : {}),
    };
  };

  root.HhrClinicalHistoryCoverage = Object.freeze({ resolveWindow, responseAttacher });
})(typeof self !== 'undefined' ? self : globalThis);
