const { hospitalCalendarDay } = require('./hospitalCalendarDay');

const isValidCalendarDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
};

const historyRetentionCutoff = (now = new Date()) => {
  const today = hospitalCalendarDay(now);
  // UTC is only a calendar arithmetic container, after resolving the hospital's day.
  const calendar = new Date(`${today}T12:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() - 30);
  return [
    String(calendar.getUTCFullYear()).padStart(4, '0'),
    String(calendar.getUTCMonth() + 1).padStart(2, '0'),
    String(calendar.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

// Preserve nanoseconds when Firestore timestamps or ISO strings differ within a millisecond.
const snapshotInstant = value => {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) return null;
    const seconds = Math.floor(milliseconds / 1000);
    return { seconds, nanoseconds: (milliseconds - seconds * 1000) * 1e6 };
  }
  if (value && typeof value === 'object') {
    const { seconds, nanoseconds } = value;
    return Number.isInteger(seconds) &&
      seconds >= -62135596800 &&
      seconds <= 253402300799 &&
      Number.isInteger(nanoseconds) &&
      nanoseconds >= 0 &&
      nanoseconds < 1e9
      ? { seconds, nanoseconds }
      : null;
  }
  if (typeof value !== 'string') return null;
  const iso = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/
  );
  if (!iso || !isValidCalendarDay(iso[1]) || +iso[2] > 23 || +iso[3] > 59 || +iso[4] > 59) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return {
    seconds: Math.floor(milliseconds / 1000),
    nanoseconds: Number((iso[5] || '').padEnd(9, '0')),
  };
};

/** Invalid/missing timestamps are retained outside the two dated copies. */
const selectDailyRecordHistory = ({ dayId, cutoffDay, snapshots }) => {
  if (!isValidCalendarDay(dayId) || !isValidCalendarDay(cutoffDay) || dayId >= cutoffDay) {
    return { deleteIds: [], keepIds: snapshots.map(snapshot => snapshot.id) };
  }
  const dated = snapshots
    .map(snapshot => ({ id: snapshot.id, instant: snapshotInstant(snapshot.snapshotTimestamp) }))
    .filter(snapshot => snapshot.instant !== null)
    .sort(
      (a, b) =>
        b.instant.seconds - a.instant.seconds ||
        b.instant.nanoseconds - a.instant.nanoseconds ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  const deleteIds = dated.slice(2).map(snapshot => snapshot.id);
  const deleted = new Set(deleteIds);
  return {
    deleteIds,
    keepIds: snapshots.filter(snapshot => !deleted.has(snapshot.id)).map(snapshot => snapshot.id),
  };
};

module.exports = { isValidCalendarDay, historyRetentionCutoff, selectDailyRecordHistory };
