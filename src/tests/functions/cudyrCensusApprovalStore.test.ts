// @vitest-environment node
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const {
  parseCensusApproval,
  saveCudyrCensusApproval,
} = require('../../../functions/lib/cudyrCensusApprovalStore.js');
const request = () => ({
  month: '2026-08',
  schemaVersion: 1,
  confirmed: true,
  action: 'approve_census',
  expectedRevision: 2,
  operationId: 'synthetic-approval-123',
  reason: 'Censo reconstruido aprobado por responsable.',
  days: Array.from({ length: 31 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    fingerprint: 'a'.repeat(64),
  })),
});
it('requires a complete, closed month and rejects clinical payloads', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
  try {
    expect(parseCensusApproval(request()).days).toHaveLength(31);
    // Revision 0: the month has no documentary reconciliation yet.
    expect(parseCensusApproval({ ...request(), expectedRevision: 0 }).expectedRevision).toBe(0);
    for (const change of [
      { confirmed: false },
      { days: request().days.slice(1) },
      { days: [request().days[1], ...request().days.slice(1)] },
      { hospitalId: 'other' },
      { entries: [] },
      { evaluation: { category: 'A1' } },
      { expectedRevision: -1 },
    ])
      expect(() => parseCensusApproval({ ...request(), ...change })).toThrow();
    vi.setSystemTime(new Date('2026-09-01T11:59:59-06:00'));
    expect(() => parseCensusApproval(request())).toThrow();
    vi.setSystemTime(new Date('2026-09-01T12:00:00-06:00'));
    expect(parseCensusApproval(request()).month).toBe('2026-08');
  } finally {
    vi.useRealTimers();
  }
});
it('preserves documentary reconstruction, audits approval, and checks revisions and retries', async () => {
  const prior = {
    revision: 2,
    verification: 'reviewed_documentary_context',
    entries: [{ synthetic: true }],
    files: [{ sha256: 'evidence' }],
    reviewedBy: { name: 'Original' },
    updatedAt: 'original-time',
  };
  const db = new Map<string, any>([['h/cudyrVerifiedContexts/2026-08', prior]]);
  const ref = (path: string): any => ({
    path,
    collection: (name: string) => ({
      doc: (id: string) => ref(`${path}/${name}/${id}`),
    }),
  });
  const tx = {
    get: async (r: any) => ({
      exists: db.has(r.path),
      data: () => db.get(r.path),
    }),
    set: (r: any, d: any) => db.set(r.path, d),
    create: (r: any, d: any) => db.set(r.path, d),
  };
  const args = {
    hospital: ref('h'),
    actor: { uid: 'reviewer', name: 'Reviewer', role: 'admin' },
    data: request(),
    runTransaction: (f: any) => f(tx),
  };
  expect(await saveCudyrCensusApproval(args)).toEqual({
    persisted: true,
    revision: 3,
  });
  const saved = db.get('h/cudyrVerifiedContexts/2026-08');
  for (const key of ['entries', 'files', 'reviewedBy', 'updatedAt'])
    expect(saved[key]).toEqual((prior as any)[key]);
  expect(saved.censusApproval.days).toHaveLength(31);
  expect(await saveCudyrCensusApproval(args)).toEqual({
    persisted: true,
    revision: 3,
  });
  await expect(
    saveCudyrCensusApproval({
      ...args,
      data: { ...request(), operationId: 'another-operation-123' },
    })
  ).rejects.toThrow('recargue');
  await expect(
    saveCudyrCensusApproval({
      ...args,
      actor: { uid: 'other', role: 'viewer' },
    })
  ).rejects.toThrow('permission');
});
it('creates the month at revision 0 without claiming a documentary review', async () => {
  const db = new Map<string, any>();
  const ref = (path: string): any => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const tx = {
    get: async (r: any) => ({ exists: db.has(r.path), data: () => db.get(r.path) }),
    set: (r: any, d: any) => db.set(r.path, d),
    create: (r: any, d: any) => db.set(r.path, d),
  };
  const save = (data: object) =>
    saveCudyrCensusApproval({
      hospital: ref('h'),
      actor: { uid: 'reviewer', name: 'Reviewer', role: 'nurse_hospital' },
      data: { ...request(), ...data },
      runTransaction: (f: any) => f(tx),
    });
  await expect(save({ expectedRevision: 1 })).rejects.toThrow('recargue');
  expect(await save({ expectedRevision: 0 })).toEqual({ persisted: true, revision: 1 });
  expect(db.get('h/cudyrVerifiedContexts/2026-08')).toMatchObject({
    revision: 1,
    entries: [],
    verification: 'census_approval_only',
    reviewedBy: { uid: 'reviewer' },
    censusApproval: { reason: request().reason },
  });
  db.set('h/cudyrVerifiedContexts/2026-08', { revision: 1, verification: 'unknown' });
  await expect(
    save({ expectedRevision: 1, operationId: 'synthetic-approval-456' })
  ).rejects.toThrow('Unknown');
});
