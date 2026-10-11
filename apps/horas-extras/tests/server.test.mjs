// Synthetic identities only; initial test keys are derived from these RUTs.
const syntheticRuts = { worker: '11111111-1', admin: '22222222-2' };
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/api.mjs';
import { provisionPerson } from '../server/provision.mjs';
import { digest } from '../server/security.mjs';
import { MemoryStore } from './support/memory-store.mjs';
const origin = 'https://overtime.example';
async function setup() {
  const store = new MemoryStore();
  const userId = await provisionPerson(store, {
    name: 'Ana Test',
    rut: '11111111-1',
    group: 'TENS',
  });
  const adminId = await provisionPerson(store, {
    name: 'Luis Test',
    rut: '22222222-2',
    group: 'Enfermería',
    adminRole: 'Coordinación',
  });
  let time = Date.now();
  let api = createApi({ store, origin, now: () => time });
  const send = async (
    path,
    { method = 'GET', body, cookie, requestOrigin = origin, ip = 'test-ip' } = {}
  ) => {
    const res = await api(
      new Request(`${origin}/api/overtime${path}`, {
        method,
        headers: {
          origin: requestOrigin,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { ip }
    );
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0],
      headers: res.headers,
    };
  };
  const login = async (rut = '11111111-1', password = syntheticRuts.worker.split('-')[0]) =>
    send('/login', { method: 'POST', body: { rut, password } });
  const ready = async (rut, password) => {
    const first = await login(rut, password);
    return send('/password', { method: 'POST', cookie: first.cookie, body: { password: 'a' } });
  };
  return {
    store,
    userId,
    adminId,
    send,
    login,
    ready,
    restart: () => {
      api = createApi({ store, origin, now: () => time });
    },
    expire: () => {
      time += 13 * 3600000;
    },
  };
}
const shift = (date, kind = 'night') => ({ date, kind, nextDay: false, note: '' });

test('initial change is server enforced; single character works, cookies are private, no hashes escape', async () => {
  const f = await setup();
  assert.equal((await f.send('/month?period=2026-09')).status, 401);
  const first = await f.login();
  assert.equal(first.status, 200);
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(first.headers.get('set-cookie'), /Secure/);
  assert.equal(first.data.person.passwordHash, undefined);
  assert.equal((await f.send('/month?period=2026-09', { cookie: first.cookie })).status, 403);
  assert.equal(
    (
      await f.send('/password', {
        method: 'POST',
        cookie: first.cookie,
        body: { password: syntheticRuts.worker.split('-')[0] },
      })
    ).status,
    400
  );
  const changed = await f.send('/password', {
    method: 'POST',
    cookie: first.cookie,
    body: { password: 'a' },
  });
  assert.equal(changed.status, 200);
  assert.equal((await f.send('/me', { cookie: first.cookie })).status, 401);
  assert.equal((await f.login(undefined, '11111111')).status, 401);
  assert.equal((await f.login(undefined, 'a')).status, 200);
  const privatePerson = await f.store.get('people', f.userId);
  assert.notEqual(privatePerson.passwordHash, 'a');
  assert.equal(privatePerson.mustChange, false);
});

test('saved records survive API restart, second device login and period changes; forged ownership ignored', async () => {
  const f = await setup();
  const auth = await f.ready();
  const saved = await f.send('/shift', {
    method: 'PUT',
    cookie: auth.cookie,
    body: {
      period: '2026-09',
      revision: 0,
      id: 'night',
      sheetId: f.adminId,
      shift: shift('2026-09-17'),
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.sheets[0].id, f.userId);
  assert.equal(saved.data.sheets[0].shifts[0].end, '09:00');
  f.restart();
  const other = await f.login(undefined, 'a');
  const month = await f.send('/month?period=2026-09', { cookie: other.cookie });
  assert.equal(month.data.sheets[0].shifts.length, 1);
  assert.equal(
    (await f.send('/month?period=2026-10', { cookie: other.cookie })).data.sheets[0].shifts.length,
    0
  );
  assert.equal((await f.store.get('people', f.adminId)).shifts.length, 0);
  assert.equal(
    (await f.send('/month?period=2026-09&team=true', { cookie: other.cookie })).status,
    403
  );
  assert.equal(month.headers.get('cache-control'), 'no-store');
});

test('admin sees both groups including empty staff and can save only own hours', async () => {
  const f = await setup();
  const auth = await f.ready('22222222-2', '22222222');
  const month = await f.send('/month?period=2026-09&team=true', { cookie: auth.cookie });
  assert.deepEqual(
    month.data.sheets.map(p => p.group),
    ['TENS', 'Enfermería']
  );
  assert.equal(
    month.data.sheets.every(p => p.passwordHash === undefined && p.authVersion === undefined),
    true
  );
  const saved = await f.send('/shift', {
    method: 'PUT',
    cookie: auth.cookie,
    body: {
      period: '2026-09',
      revision: 0,
      id: 'long',
      sheetId: f.userId,
      shift: shift('2026-09-01', 'long'),
    },
  });
  assert.equal(saved.data.sheets[0].id, f.adminId);
  assert.equal((await f.store.get('people', f.userId)).shifts.length, 0);
});

test('concurrent writes, stale edits, overlaps across months and deletes preserve data', async () => {
  const f = await setup();
  const auth = await f.ready();
  const save = (id, date, revision, extra = {}) =>
    f.send('/shift', {
      method: 'PUT',
      cookie: auth.cookie,
      body: { period: date.slice(0, 7), revision, id, shift: { ...shift(date), ...extra } },
    });
  const results = await Promise.all([save('a', '2026-09-30', 0), save('b', '2026-09-01', 0)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(
    (await save('cross', '2026-10-01', 1, { kind: 'custom', start: '07:00', end: '09:00' })).status,
    409
  );
  assert.equal((await save('a', '2026-10-01', 1)).status, 400);
  const edit = await save('a', '2026-09-30', 1, { kind: 'long' });
  assert.equal(edit.status, 200);
  assert.equal(edit.data.sheets[0].shifts[0].kind, 'long');
  assert.equal(
    (
      await f.send('/shift', {
        method: 'DELETE',
        cookie: auth.cookie,
        body: { period: '2026-09', revision: 1, id: 'a' },
      })
    ).status,
    409
  );
  const removed = await f.send('/shift', {
    method: 'DELETE',
    cookie: auth.cookie,
    body: { period: '2026-09', revision: 2, id: 'a' },
  });
  assert.equal(removed.data.sheets[0].shifts.length, 0);
});

test('profession is independent from ADMIN; medical own hours stay out of nursing and TENS exports', async () => {
  const f = await setup();
  const rut = '33333333-3';
  const id = await provisionPerson(f.store, {
    name: 'Medical Test',
    rut,
    group: 'Médico',
    adminRole: 'Jefatura',
  });
  const first = await f.login(rut, rut.split('-')[0]);
  assert.equal(first.data.person.group, 'Médico');
  assert.equal(first.data.person.mustChange, true);
  assert.equal(
    (await f.send('/month?period=2026-09&team=true', { cookie: first.cookie })).status,
    403
  );
  assert.equal(
    (
      await f.send('/shift', {
        method: 'PUT',
        cookie: first.cookie,
        body: { period: '2026-09', revision: 0, id: 'medical', shift: shift('2026-09-01', 'long') },
      })
    ).status,
    403
  );
  const auth = await f.send('/password', {
    method: 'POST',
    cookie: first.cookie,
    body: { password: 'm' },
  });
  const saved = await f.send('/shift', {
    method: 'PUT',
    cookie: auth.cookie,
    body: { period: '2026-09', revision: 0, id: 'medical', shift: shift('2026-09-01', 'long') },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.sheets[0].id, id);
  const month = await f.send('/month?period=2026-09&team=true', { cookie: auth.cookie });
  assert.equal(month.status, 200);
  for (const group of ['TENS', 'Enfermería']) {
    const exported = month.data.sheets.filter(person => person.group === group);
    assert.equal(exported.length, 1);
    assert.equal(
      exported.some(person => person.id === id),
      false
    );
  }
  await f.store.transaction(async tx => {
    const person = await tx.get('people', id);
    tx.set('people', id, { ...person, adminRole: '' });
  });
  assert.equal(
    (await f.send('/month?period=2026-09&team=true', { cookie: auth.cookie })).status,
    403
  );
  assert.equal((await f.send('/month?period=2026-09', { cookie: auth.cookie })).status, 200);
});

test('CSRF, brute force, session expiry, logout and deactivated accounts fail closed', async () => {
  const f = await setup();
  const auth = await f.ready();
  assert.equal(
    (
      await f.send('/logout', {
        method: 'POST',
        cookie: auth.cookie,
        body: {},
        requestOrigin: 'https://evil.example',
      })
    ).status,
    403
  );
  for (let i = 0; i < 4; i++) assert.equal((await f.login(undefined, 'wrong')).status, 401);
  assert.equal((await f.login(undefined, 'a')).status, 429);
  assert.equal(
    (await f.send('/logout', { method: 'POST', cookie: auth.cookie, body: {} })).status,
    200
  );
  assert.equal((await f.send('/me', { cookie: auth.cookie })).status, 401);
  const admin = await f.ready('22222222-2', '22222222');
  f.expire();
  assert.equal((await f.send('/me', { cookie: admin.cookie })).status, 401);
  const login = await f.login('22222222-2', 'a');
  await f.store.transaction(async tx => {
    const p = await tx.get('people', f.adminId);
    tx.set('people', f.adminId, { ...p, active: false });
  });
  assert.equal((await f.send('/me', { cookie: login.cookie })).status, 401);
});

test('provisioning never overwrites an existing account', async () => {
  const f = await setup();
  await f.ready();
  await assert.rejects(
    provisionPerson(f.store, { name: 'Replace', rut: '11111111-1', group: 'TENS' }),
    /ya existe/
  );
  assert.equal((await f.store.get('people', digest('11111111-1'))).name, 'Ana Test');
});

test('password changes require a session before hashing and have a separate attempt limit', async () => {
  const f = await setup();
  assert.equal(
    (await f.send('/password', { method: 'POST', body: { password: 'a' } })).status,
    401
  );
  let auth = await f.ready();
  for (let i = 0; i < 4; i++) {
    auth = await f.send('/password', {
      method: 'POST',
      cookie: auth.cookie,
      body: { password: 'b' },
    });
    assert.equal(auth.status, 200);
  }
  assert.equal(
    (await f.send('/password', { method: 'POST', cookie: auth.cookie, body: { password: 'c' } }))
      .status,
    429
  );
  assert.equal((await f.login(undefined, 'b')).status, 200);
});

test('oversized valid notes fail before Firestore document size is exceeded', async () => {
  const f = await setup();
  const auth = await f.ready();
  await f.store.transaction(async tx => {
    const p = await tx.get('people', f.userId);
    const shifts = Array.from({ length: 1000 }, (_, i) => ({
      id: `s${i}`,
      date: '2026-09-01',
      endDate: '2026-09-01',
      kind: 'custom',
      start: '08:00',
      end: '08:01',
      note: '界'.repeat(200),
    }));
    tx.set('people', f.userId, { ...p, shifts });
  });
  const result = await f.send('/shift', {
    method: 'PUT',
    cookie: auth.cookie,
    body: { period: '2026-09', revision: 0, id: 'large', shift: shift('2026-09-17') },
  });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /capacidad/);
  assert.equal((await f.store.get('people', f.userId)).revision, 0);
});

test('a shared hospital IP can admit more than thirty distinct staff without losing per-account limits', async () => {
  const f = await setup();
  await f.ready();
  const template = await f.store.get('people', f.userId);
  for (let i = 0; i < 35; i++) {
    const body = String(10000000 + i);
    let sum = 0;
    [...body].reverse().forEach((d, j) => {
      sum += Number(d) * (2 + (j % 6));
    });
    const check = 11 - (sum % 11);
    const rut = `${body}-${check === 11 ? '0' : check === 10 ? 'K' : check}`;
    const id = digest(rut);
    await f.store.transaction(async tx => {
      tx.set('people', id, { ...template, id, rut, name: 'Synthetic shared network staff' });
    });
    assert.equal((await f.login(rut, 'a')).status, 200);
  }
});
