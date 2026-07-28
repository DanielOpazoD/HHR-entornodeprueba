/** Trusted Rapa Nui nursing-census calendar for synchronization horizon checks. */
(function (root) {
  'use strict';
  const holidays = new Set([
    '2024-01-01','2024-03-29','2024-03-30','2024-05-01','2024-05-21','2024-06-09','2024-06-20','2024-06-29','2024-07-16','2024-08-15','2024-09-18','2024-09-19','2024-09-20','2024-10-12','2024-10-27','2024-10-31','2024-11-01','2024-12-08','2024-12-25','2025-01-01','2025-04-18','2025-04-19','2025-05-01','2025-05-21','2025-06-20','2025-06-29','2025-06-30','2025-07-16','2025-08-15','2025-09-18','2025-09-19','2025-10-12','2025-10-13','2025-10-31','2025-11-01','2025-12-08','2025-12-25',
    '2026-01-01','2026-04-03','2026-04-04','2026-05-01','2026-05-21','2026-06-20','2026-06-29','2026-07-16','2026-08-15','2026-09-18','2026-09-19','2026-10-12','2026-10-31','2026-11-01','2026-11-02','2026-12-08','2026-12-25','2027-01-01','2027-03-26','2027-03-27','2027-05-01','2027-05-21','2027-06-20','2027-06-21','2027-06-28','2027-07-16','2027-08-15','2027-08-16','2027-09-18','2027-09-19','2027-09-20','2027-10-11','2027-10-31','2027-11-01','2027-12-08','2027-12-25',
    '2028-01-01','2028-04-14','2028-04-15','2028-05-01','2028-05-21','2028-05-22','2028-06-20','2028-06-29','2028-07-16','2028-07-17','2028-08-15','2028-09-18','2028-09-19','2028-10-12','2028-10-31','2028-11-01','2028-12-08','2028-12-25',
  ]);
  const previousIsoDay = iso => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const localStamp = date => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value || '';
    return { iso: `${value('year')}-${value('month')}-${value('day')}`, hhmm: `${value('hour')}:${value('minute')}` };
  };
  const isBusinessDay = iso => !holidays.has(iso) &&
    ![0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
  const clinicalDayAt = date => {
    const { iso, hhmm } = localStamp(date);
    const year = Number(iso.slice(0, 4));
    if (year < 2024 || year > 2028) return null;
    return hhmm < (isBusinessDay(iso) ? '08:00' : '09:00') ? previousIsoDay(iso) : iso;
  };
  const calendarDayAt = date => localStamp(date).iso;
  const historyLookbackDays = (censusDate, now = new Date()) => {
    const iso = String(censusDate || ''), fallback = 14, target = Date.parse(`${iso}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(target) || new Date(target).toISOString().slice(0, 10) !== iso || Number.isNaN(now.getTime())) return fallback;
    const ageDays = Math.floor((Date.parse(`${calendarDayAt(now)}T00:00:00Z`) - target) / 86_400_000);
    return ageDays < 0 ? fallback : Math.min(fallback, Math.max(2, ageDays + 2));
  };
  root.HhrClinicalDayRuntime = Object.freeze({ calendarDayAt, clinicalDayAt, historyLookbackDays, holidays: Object.freeze([...holidays]) });
})(typeof self !== 'undefined' ? self : globalThis);
