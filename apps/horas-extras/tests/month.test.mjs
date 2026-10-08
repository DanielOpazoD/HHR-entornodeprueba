import test from 'node:test';
import assert from 'node:assert/strict';
import { initialMonth, transition } from '../src/domain/month.mjs';
const admin = { id: 'admin-demo', role: 'admin', name: 'Enfermera Diurna' };
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
