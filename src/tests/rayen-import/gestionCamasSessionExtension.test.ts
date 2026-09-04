import { describe, expect, it } from 'vitest';

import '../../../extension/gestion-camas-session.js';

interface SessionRecord {
  token: string;
  apiBase: string;
  facId: string;
  capturedAt: number;
  lastVerifiedAt: number | null;
  expiresAt: number | null;
  identity: { fullName: string; username: string };
}

const session = (
  globalThis as typeof globalThis & {
    HhrGestionCamasSession: {
      buildSessionRecord: (info: unknown, now?: number) => SessionRecord | null;
      isVerificationFresh: (record: SessionRecord | null, now?: number) => boolean;
      isUsable: (record: SessionRecord | null, now?: number) => boolean;
      normalizeApiBase: (value: unknown) => string;
      publicStatus: (record: SessionRecord | null, now?: number) => Record<string, unknown>;
    };
  }
).HhrGestionCamasSession;

const jwtFixture = (claims: Record<string, unknown>): string => {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.${['test', 'fixture'].join('-')}`;
};

describe('Gestión de Camas session helpers', () => {
  it('accepts only the reviewed backend and exposes safe identity and expiry metadata', () => {
    const now = Date.UTC(2026, 6, 15, 14, 0, 0);
    const fixture = jwtFixture({
      exp: now / 1000 + 3600,
      name: 'Valeria Salfate',
      preferred_username: 'vsalfate',
    });
    const record = session.buildSessionRecord(
      {
        token: fixture,
        apiBase: 'https://hospbackend.rayensalud.cl/api/',
        facId: '1342',
        verified: true,
      },
      now
    );

    expect(record).toMatchObject({
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      expiresAt: now + 3600_000,
      identity: { fullName: 'Valeria Salfate', username: 'vsalfate' },
    });
    expect(record?.lastVerifiedAt).toBeNull();
    if (!record) throw new Error('Expected a valid session fixture');
    record.lastVerifiedAt = now;
    expect(session.isUsable(record, now)).toBe(true);
    expect(session.publicStatus(record, now)).toMatchObject({
      status: 'ready',
      remainingSeconds: 3600,
      // «Verificada hace N min» del monitor de conexiones de HHR.
      lastVerifiedAt: now,
      connectionSource: 'session',
    });
    expect(session.normalizeApiBase('https://evil.example/api')).toBe('');
    expect(session.normalizeApiBase('http://hospbackend.rayensalud.cl/api')).toBe('');
    expect(
      session.buildSessionRecord({
        token: fixture,
        apiBase: 'https://hospbackend.rayensalud.cl',
        facId: '',
      })
    ).toBeNull();
  });

  it('distinguishes expiring, expired and missing sessions without exposing the token', () => {
    const now = Date.UTC(2026, 6, 15, 14, 0, 0);
    const fixture = jwtFixture({ exp: now / 1000 + 5 * 60, name: 'Valeria Salfate' });
    const expiring = session.buildSessionRecord(
      {
        token: fixture,
        apiBase: 'https://hospbackend.rayensalud.cl',
        facId: '1342',
        verified: true,
      },
      now
    );
    expect(expiring?.lastVerifiedAt).toBeNull();
    if (!expiring) throw new Error('Expected a valid expiring session fixture');
    expiring.lastVerifiedAt = now;
    const expiringStatus = session.publicStatus(expiring, now);
    expect(expiringStatus).toMatchObject({ status: 'ready', expiring: true });
    expect(expiringStatus).not.toHaveProperty('token');

    expect(session.publicStatus(expiring, now + 6 * 60_000)).toMatchObject({
      status: 'stale',
      remainingSeconds: 0,
    });
    expect(session.publicStatus(null, now)).toMatchObject({
      status: 'missing',
      reason: 'session_unverified',
      lastVerifiedAt: null,
      connectionSource: 'none',
    });
  });

  it('keeps opaque access tokens usable but labels their expiry as provider-controlled', () => {
    const now = Date.UTC(2026, 6, 15, 14, 0, 0);
    const fixture = Array.from({ length: 28 }, (_, index) =>
      String.fromCharCode(97 + (index % 26))
    ).join('');
    const record = session.buildSessionRecord(
      {
        token: fixture,
        apiBase: 'https://hospbackend.rayensalud.cl',
        facId: '1342',
        verified: true,
      },
      now
    );
    expect(record?.lastVerifiedAt).toBeNull();
    if (!record) throw new Error('Expected a valid opaque session fixture');
    record.lastVerifiedAt = now;
    expect(session.isUsable(record, now)).toBe(true);
    expect(session.publicStatus(record, now)).toMatchObject({
      status: 'ready',
      expiresAt: null,
      remainingSeconds: null,
    });
    expect(session.publicStatus(record, now + 3 * 60_000)).toMatchObject({
      status: 'stale',
      verification: 'pending',
    });
  });

  it('does not show a captured but unverified token as connected', () => {
    const now = Date.UTC(2026, 6, 15, 14, 0, 0);
    const fixture = jwtFixture({ exp: now / 1000 + 3600 });
    const record = session.buildSessionRecord(
      {
        token: fixture,
        apiBase: 'https://hospbackend.rayensalud.cl',
        facId: '1342',
      },
      now
    );
    expect(session.isUsable(record, now)).toBe(true);
    expect(session.isVerificationFresh(record, now)).toBe(false);
    expect(session.publicStatus(record, now)).toMatchObject({
      status: 'stale',
      verification: 'pending',
    });
  });
});
