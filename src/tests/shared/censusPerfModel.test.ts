import { describe, expect, it } from 'vitest';
import { createCensusPerfModel } from '@/shared/runtime/censusPerfModel';
const setup = () => {
  let n = 0;
  let t = 1;
  const model = createCensusPerfModel({
    now: () => t++,
    id: () => `id-${++n}`,
    timeOrigin: 100,
    environment: 'production',
  });
  return model;
};
describe('bounded census startup diagnostics', () => {
  it('separates navigation identities and never exports a clinical context key', () => {
    const m = setup();
    const id = m.visit('patient@example.cl?rut=123&date=2026-09-11');
    m.census(id, 'record_available');
    expect(JSON.stringify(m.snapshot())).not.toMatch(/patient|rut|2026/);
    expect(m.snapshot().visits[0].events.record_available).toBeGreaterThan(0);
    const another = createCensusPerfModel({
      now: () => 1,
      id: () => 'another-navigation',
      timeOrigin: 200,
      environment: 'development',
    });
    expect(m.snapshot().navigationId).not.toBe(another.snapshot().navigationId);
  });
  it('deduplicates strict-mode replays but fences late frames after context replacement', () => {
    const m = setup();
    const old = m.visit('a');
    expect(m.visit('a')).toBe(old);
    m.census(old, 'record_available');
    const t = m.snapshot().visits[0].events.record_available;
    m.census(old, 'record_available');
    expect(m.snapshot().visits[0].events.record_available).toBe(t);
    m.visit('b');
    m.census(old, 'table_commit');
    expect(m.snapshot().visits[0].events.table_commit).toBeUndefined();
    expect(m.visit('a')).not.toBe(old);
  });
  it('requires an actual table commit before a paint opportunity', () => {
    const m = setup();
    const id = m.visit('a');
    m.census(id, 'table_paint_opportunity');
    expect(m.snapshot().visits[0].events).toEqual({});
    m.census(id, 'table_commit');
    m.census(id, 'table_paint_opportunity');
    expect(m.snapshot().visits[0].events.table_paint_opportunity).toBeGreaterThan(
      m.snapshot().visits[0].events.table_commit!
    );
  });
  it.each([
    [true, false, true],
    [false, true, true],
    [false, false, false],
  ])(
    'does not call cache, pending writes or missing record remote confirmation (%s,%s,%s)',
    (cache, pending, exists) => {
      const m = setup();
      m.visit('today');
      m.remote('today', cache, pending, exists);
      expect(m.snapshot().visits[0].events.remote_confirmed).toBeUndefined();
    }
  );
  it('requires the matching day and a non-pending server snapshot', () => {
    const m = setup();
    m.visit('today');
    m.remote('yesterday', false, false, true);
    expect(m.snapshot().visits[0].events.remote_confirmed).toBeUndefined();
    m.remote('today', false, false, true);
    expect(m.snapshot().visits[0].events.remote_confirmed).toBeGreaterThan(0);
  });
  it('keeps independent auth attempts and does not attribute late completion to another attempt', () => {
    const m = setup();
    const a = m.begin('app_button');
    const b = m.begin('app_button');
    m.auth(a, 'failed');
    m.auth(a, 'authorized');
    m.auth(b, 'authorized');
    expect(m.snapshot().authAttempts[0].events.authorized).toBeUndefined();
    expect(m.snapshot().authAttempts[1].events.authorized).toBeGreaterThan(0);
  });
  it('retains the Google click boundary, and labels credential-only arrivals honestly', () => {
    const m = setup();
    const id = m.begin('google_button');
    expect(m.receiveCredential()).toBe(id);
    m.auth(id, 'authorized');
    const next = m.receiveCredential();
    expect(next).not.toBe(id);
    expect(m.snapshot().authAttempts[1].boundary).toBe('credential_received');
  });
  it('opens a fresh visit after a new login even for the same clinical day', () => {
    const m = setup();
    const first = m.visit('same-date');
    m.begin('app_button');
    expect(m.visit('same-date')).not.toBe(first);
  });
  it('bounds retention and returns detached copies', () => {
    const m = setup();
    for (let n = 0; n < 100; n++) {
      m.begin('app_button');
      m.visit(String(n));
    }
    const s = m.snapshot();
    expect(s.visits).toHaveLength(10);
    expect(s.authAttempts).toHaveLength(20);
    s.visits.length = 0;
    expect(m.snapshot().visits).toHaveLength(10);
  });
  it('rejects unapproved navigation names and does not overwrite the first timestamp', () => {
    const m = setup();
    m.navigation('email@example.com');
    m.navigation('auth:ready');
    const before = m.snapshot().navigationEvents['auth:ready'];
    m.navigation('auth:ready');
    expect(m.snapshot().navigationEvents).toEqual({ 'auth:ready': before });
  });
});
