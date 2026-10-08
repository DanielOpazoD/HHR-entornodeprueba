import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculate,
  makeShift,
  normalizeRut,
  overlaps,
  totals,
  dayNumber,
} from '../src/domain/overtime.mjs';

for (const [date, kind, start, end, total, diurnal, nocturnal] of [
  ['2026-09-01', 'long', '08:00', '20:00', 12, 12, 0],
  ['2026-09-05', 'long', '09:00', '20:00', 11, 0, 11],
  ['2026-09-18', 'long', '09:00', '20:00', 11, 0, 11],
  ['2026-09-01', 'night', '20:00', '08:00', 12, 2, 10],
  ['2026-09-04', 'night', '20:00', '09:00', 13, 1, 12],
  ['2026-09-17', 'night', '20:00', '09:00', 13, 1, 12],
  ['2026-09-18', 'night', '20:00', '09:00', 13, 0, 13],
  ['2026-09-19', 'night', '20:00', '09:00', 13, 0, 13],
  ['2026-09-20', 'night', '20:00', '08:00', 12, 1, 11],
  ['2026-09-30', 'night', '20:00', '08:00', 12, 2, 10],
])
  test(`${date} ${kind}: ${total}h = ${diurnal} + ${nocturnal}`, () => {
    const shift = makeShift({ date, kind });
    assert.equal(shift.start, start);
    assert.equal(shift.end, end);
    assert.deepEqual(calculate(shift), {
      total: total * 60,
      diurnal: diurnal * 60,
      nocturnal: nocturnal * 60,
    });
  });

test('exact half-hours and 07/21 boundaries, without rounding individual shifts', () => {
  const morning = makeShift({ date: '2026-09-01', kind: 'custom', start: '06:30', end: '07:30' });
  const evening = makeShift({ date: '2026-09-01', kind: 'custom', start: '20:30', end: '21:30' });
  assert.deepEqual(totals([morning, evening]), { total: 120, diurnal: 60, nocturnal: 60 });
});
test('partial shift touching a night is allowed, overlapping night is rejected', () => {
  const night = makeShift({ id: 'n', date: '2026-09-04', kind: 'night' });
  const touching = makeShift({
    id: 'p',
    date: '2026-09-04',
    kind: 'custom',
    start: '17:30',
    end: '20:00',
  });
  const clash = makeShift({
    id: 'c',
    date: '2026-09-05',
    kind: 'custom',
    start: '08:30',
    end: '10:00',
  });
  assert.equal(overlaps([night], touching), false);
  assert.equal(overlaps([night], clash), true);
  assert.equal(overlaps([night], night), false);
});
test('invalid dates, times, unsupported calendar and zero duration fail closed', () => {
  for (const date of ['2026-09-31', '2025-12-31', '2028-01-02', '2026-9-01'])
    assert.throws(() => dayNumber(date));
  for (const [start, end] of [
    ['25:00', '08:00'],
    ['20:00', '08:00'],
    ['08:00', '08:00'],
    ['07:61', '08:00'],
  ])
    assert.throws(() => makeShift({ date: '2026-09-01', kind: 'custom', start, end }));
  assert.throws(() => makeShift({ date: '2028-01-01', kind: 'long' }));
});
test('classification agrees with independent minute-by-minute reference throughout the month', () => {
  const nonbusiness = new Set([5, 6, 12, 13, 18, 19, 20, 26, 27]);
  for (let day = 1; day <= 30; day++)
    for (const kind of ['long', 'night']) {
      const shift = makeShift({ date: `2026-09-${String(day).padStart(2, '0')}`, kind });
      const from = Number(shift.start.slice(0, 2)) * 60;
      const until = Number(shift.end.slice(0, 2)) * 60 + (kind === 'night' ? 1440 : 0);
      let diurnal = 0;
      for (let minute = from; minute < until; minute++) {
        const actualDay = day + Math.floor(minute / 1440);
        if (!nonbusiness.has(actualDay) && minute % 1440 >= 420 && minute % 1440 < 1260) diurnal++;
      }
      assert.deepEqual(calculate(shift), {
        total: until - from,
        diurnal,
        nocturnal: until - from - diurnal,
      });
    }
});
test('RUT accepts formatting and verifies the digit', () => {
  assert.equal(normalizeRut('11.111.111-1'), '11111111-1');
  assert.equal(normalizeRut('11.111.111-2'), null);
  assert.equal(normalizeRut('abc'), null);
});

test('other months and years classify holidays and midnight transitions', () => {
  for (const date of ['2026-04-02', '2026-12-31', '2027-09-16', '2027-06-27', '2027-12-31']) {
    const shift = makeShift({ date, kind: 'night' });
    assert.equal(shift.end, '09:00');
    assert.equal(calculate(shift).total, 780);
  }
  for (const date of ['2026-04-03', '2027-03-26', '2027-06-28', '2027-09-17', '2027-10-11']) {
    assert.deepEqual(calculate(makeShift({ date, kind: 'long' })), {
      total: 660,
      diurnal: 0,
      nocturnal: 660,
    });
  }
  assert.equal(makeShift({ date: '2027-02-28', kind: 'night' }).endDate, '2027-03-01');
  assert.throws(() => makeShift({ date: '2027-02-29', kind: 'long' }));
});
