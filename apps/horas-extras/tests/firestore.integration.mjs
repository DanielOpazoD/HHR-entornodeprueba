// Synthetic identities only; initial test keys are derived from these RUTs.
const syntheticRuts = { worker: '33333333-3', admin: '44444444-4' };
import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredStore } from '../server/firestore.mjs';
import { createApi } from '../server/api.mjs';
import { provisionPerson } from '../server/provision.mjs';

test('Firestore transaction persistence, reload, conflict protection and Excel group data', async () => {
  assert.equal(process.env.OVERTIME_FIREBASE_PROJECT_ID, 'demo-overtime');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8187');
  const store = configuredStore();
  const origin = 'http://127.0.0.1:8801';
  let handler = createApi({ store, origin, secureCookies: false });
  const send = async (path, method = 'GET', body, cookie) => {
    const r = await handler(
      new Request(`${origin}/api/overtime${path}`, {
        method,
        headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
      { ip: 'emulator-integration' }
    );
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get('set-cookie')?.split(';')[0],
    };
  };
  await provisionPerson(store, { name: 'Emulator Worker', rut: '33333333-3', group: 'TENS' });
  await provisionPerson(store, {
    name: 'Emulator Admin',
    rut: '44444444-4',
    group: 'Enfermería',
    adminRole: 'Coordinación',
  });
  const first = await send('/login', 'POST', {
    rut: '33333333-3',
    password: syntheticRuts.worker.split('-')[0],
  });
  assert.equal(first.status, 200);
  const auth = await send('/password', 'POST', { password: 'x' }, first.cookie);
  const payload = {
    period: '2026-09',
    revision: 0,
    id: 'firestore-night',
    shift: { date: '2026-09-17', kind: 'night', note: '', nextDay: false },
  };
  const attempts = await Promise.all([
    send('/shift', 'PUT', payload, auth.cookie),
    send('/shift', 'PUT', { ...payload, id: 'second' }, auth.cookie),
  ]);
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
  // A new API and datastore adapter read the same Firestore documents.
  handler = createApi({ store: configuredStore(), origin, secureCookies: false });
  const month = await send('/month?period=2026-09', 'GET', undefined, auth.cookie);
  assert.equal(month.data.sheets[0].shifts.length, 1);
  assert.equal(month.data.sheets[0].shifts[0].end, '09:00');
  const firstAdmin = await send('/login', 'POST', {
    rut: '44444444-4',
    password: syntheticRuts.admin.split('-')[0],
  });
  const admin = await send('/password', 'POST', { password: 'y' }, firstAdmin.cookie);
  const team = await send('/month?period=2026-09&team=true', 'GET', undefined, admin.cookie);
  assert.deepEqual(team.data.sheets.map(p => p.group).sort(), ['Enfermería', 'TENS']);
  assert.equal(
    team.data.sheets.some(p => p.shifts.length === 0),
    true
  );
});
