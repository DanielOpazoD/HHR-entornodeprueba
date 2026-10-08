import test from 'node:test';
import assert from 'node:assert/strict';
import { initialMonth, transition } from '../src/domain/month.mjs';
const admin = { id: 'luis', role: 'admin', name: 'Enfermera Diurna' };
const staff = id => ({ id, role: 'staff', name: id });
const run = (month, action, actor = admin) =>
  transition(month, action, actor, '2026-10-07T12:00:00Z');
test('send, return, edit, resend, approve, close and reasoned reopening', () => {
  const original = initialMonth();
  let month = run(original, { type: 'submit', sheetId: 'ana' }, staff('ana'));
  assert.equal(original.sheets[0].status, 'draft');
  assert.throws(() => run(month, { type: 'delete', sheetId: 'ana', id: 'a1' }, staff('ana')));
  month = run(month, { type: 'return', sheetId: 'ana', reason: 'Revisar horario' });
  month = run(
    month,
    { type: 'save', sheetId: 'ana', shift: { id: 'a1', date: '2026-09-04', kind: 'night' } },
    staff('ana')
  );
  month = run(month, { type: 'submit', sheetId: 'ana' }, staff('ana'));
  month = run(month, { type: 'submit', sheetId: 'pedro' }, staff('pedro'));
  for (const person of month.sheets) month = run(month, { type: 'approve', sheetId: person.id });
  month = run(month, { type: 'close' });
  assert.equal(month.closed, true);
  assert.throws(() => run(month, { type: 'return', sheetId: 'ana', reason: 'Corrección' }));
  assert.throws(() => run(month, { type: 'reopen', reason: ' ' }));
  month = run(month, { type: 'reopen', reason: 'Corrección autorizada' });
  assert.equal(month.closed, false);
  assert.equal(month.audit[0].reason, 'Corrección autorizada');
  assert.equal(month.sheets[0].status, 'approved');
});
test('admin cannot approve drafts or close unresolved roster; staff cannot approve or close', () => {
  const month = initialMonth();
  assert.throws(() => run(month, { type: 'approve', sheetId: 'ana' }));
  assert.throws(() => run(month, { type: 'close' }));
  assert.throws(() => run(month, { type: 'approve', sheetId: 'luis' }, staff('luis')));
  assert.throws(() => run(month, { type: 'close' }, staff('ana')));
  assert.throws(() => run(month, { type: 'submit', sheetId: 'ana' }, staff('pedro')));
});
test('an empty report requires explicit no-extra declaration and cannot erase existing shifts', () => {
  let month = initialMonth();
  assert.throws(() => run(month, { type: 'no-extras', sheetId: 'ana' }, staff('ana')));
  for (const id of ['a1', 'a2'])
    month = run(month, { type: 'delete', sheetId: 'ana', id }, staff('ana'));
  assert.throws(() => run(month, { type: 'submit', sheetId: 'ana' }, staff('ana')));
  month = run(month, { type: 'no-extras', sheetId: 'ana' }, staff('ana'));
  month = run(month, { type: 'submit', sheetId: 'ana' }, staff('ana'));
  assert.equal(month.sheets[0].noExtras, true);
});
test('overlap is rejected without changing existing data', () => {
  const month = initialMonth();
  assert.throws(() =>
    run(
      month,
      {
        type: 'save',
        sheetId: 'ana',
        shift: { id: 'new', date: '2026-09-05', kind: 'custom', start: '08:00', end: '10:00' },
      },
      staff('ana')
    )
  );
  assert.equal(month.sheets[0].shifts.length, 2);
});

test('admin has own editable hours and worker cannot forge an admin profile', () => {
  let month = initialMonth('2027-02');
  assert.throws(() => run(month, { type: 'close' }, { id: 'ana', role: 'admin' }));
  month = run(
    month,
    { type: 'save', sheetId: 'luis', shift: { id: 'own', date: '2027-02-01', kind: 'long' } },
    staff('luis')
  );
  assert.equal(month.sheets.find(item => item.id === 'luis').shifts.length, 1);
  assert.throws(() =>
    run(month, {
      type: 'save',
      sheetId: 'ana',
      shift: { id: 'other', date: '2027-02-02', kind: 'long' },
    })
  );
});
test('period isolation, invalid period and cross-month overlap', () => {
  const september = initialMonth();
  let october = initialMonth('2026-10');
  assert.equal(october.sheets[0].shifts.length, 0);
  assert.throws(() => initialMonth('2028-01'));
  assert.throws(() =>
    run(
      october,
      { type: 'save', sheetId: 'ana', shift: { id: 'bad', date: '2026-09-30', kind: 'night' } },
      staff('ana')
    )
  );
  const adjacent = {
    id: 'adj',
    date: '2026-09-30',
    endDate: '2026-10-01',
    start: '20:00',
    end: '08:00',
  };
  assert.throws(() =>
    run(
      october,
      {
        type: 'save',
        sheetId: 'ana',
        adjacentShifts: [adjacent],
        shift: { id: 'clash', date: '2026-10-01', kind: 'custom', start: '07:00', end: '09:00' },
      },
      staff('ana')
    )
  );
  october = run(
    october,
    {
      type: 'save',
      sheetId: 'ana',
      adjacentShifts: [adjacent],
      shift: { id: 'touch', date: '2026-10-01', kind: 'long' },
    },
    staff('ana')
  );
  assert.equal(october.sheets[0].shifts.length, 1);
  assert.equal(september.sheets[0].shifts.length, 2);
});
