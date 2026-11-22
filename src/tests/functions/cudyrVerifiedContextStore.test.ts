// @vitest-environment node
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const {
  parseVerifiedContext,
  saveCudyrVerifiedContext,
} = require('../../../functions/lib/cudyrVerifiedContextStore.js');

interface FakeDocRef {
  path: string;
  audit?: boolean;
  collection: (name: string) => { doc: (id: string) => FakeDocRef };
}

interface FakeTransaction {
  get: (ref: FakeDocRef) => Promise<{ exists: boolean; data?: () => unknown }>;
  set?: (ref: FakeDocRef, value: unknown) => void;
  create?: (ref: FakeDocRef, value: unknown) => void;
}

const makeRef = (path: string): FakeDocRef => ({
  path,
  collection: (name: string) => ({ doc: (id: string) => makeRef(`${path}/${name}/${id}`) }),
});

const input = () => {
  const bytes = Buffer.from(JSON.stringify({ source: 'synthetic documentary evidence' }));
  return {
    schemaVersion: 1,
    confirmed: true,
    month: '2026-10',
    action: 'replace',
    reason: 'Conciliación respaldada por documentos del episodio.',
    expectedRevision: 0,
    operationId: 'synthetic-operation-123',
    files: [{ name: 'evidence.json', base64: bytes.toString('base64') }],
    entries: [
      {
        date: '2026-10-02',
        reportId: 'a'.repeat(64),
        sourceRow: 3,
        clinicalEpisodeId: '123',
        admissionAt: '2026-10-02T14:00:00-05:00',
        dischargeAt: '2026-10-04T14:00:00-05:00',
        group: 'intermedia',
        modality: 'hospitalizacion',
        bedId: 'R1',
        bedName: 'R1',
        document: 'SYNTHETIC',
        documentType: 'Otro',
        basis: 'reviewed_documentary_context',
        reason: 'Contexto documental verificado por responsable autorizado.',
        evidenceHashes: [createHash('sha256').update(bytes).digest('hex')],
      },
    ],
  };
};
describe('verified context archive boundary', () => {
  it('hashes attached bytes and forbids manual CUDYR values', () => {
    const request = input();
    expect(parseVerifiedContext(request).files[0].sha256).toBe(
      request.entries[0].evidenceHashes[0]
    );
    expect(() =>
      parseVerifiedContext({ ...request, entries: [{ ...request.entries[0], category: 'C2' }] })
    ).toThrow();
  });
  it.each([
    'hospital',
    'confirmation',
    'evidence',
    'date',
    'duplicate',
    'modality',
    'reversed-stay',
    'revision',
  ])('rejects invalid %s', kind => {
    const request: Record<string, unknown> & ReturnType<typeof input> = input();
    if (kind === 'hospital') request.hospitalId = 'other';
    if (kind === 'confirmation') request.confirmed = false;
    if (kind === 'evidence') request.files = [];
    if (kind === 'date') request.entries[0].date = '2026-10-99';
    if (kind === 'duplicate') request.entries.push({ ...request.entries[0] });
    if (kind === 'modality') request.entries[0].modality = 'cuna';
    if (kind === 'reversed-stay') request.entries[0].dischargeAt = '2026-10-01T00:00:00Z';
    if (kind === 'revision') request.expectedRevision = -1;
    expect(() => parseVerifiedContext(request)).toThrow();
  });
  it.each([
    ['2026-10-20T14:00:00-05:00', '2026-10-21T14:00:00-05:00'],
    ['2026-09-29T14:00:00-05:00', '2026-10-02T08:00:00-05:00'],
  ])('rejects a stay outside the reviewed clinical day', (admissionAt, dischargeAt) => {
    const request = input();
    Object.assign(request.entries[0], { admissionAt, dischargeAt });
    expect(() => parseVerifiedContext(request)).toThrow(/does not overlap/);
  });
  it('accepts an early next-day admission under the previous clinical night', () => {
    const request = input();
    request.entries[0].admissionAt = '2026-10-03T02:00:00-05:00';
    expect(parseVerifiedContext(request).entries).toHaveLength(1);
  });
  it('fails closed on absent monthly evidence without writing', async () => {
    const paths: string[] = [];
    const hospital = makeRef('hospital');
    const tx: FakeTransaction = {
      get: async () => ({ exists: false }),
      set: () => {
        paths.push('set');
      },
      create: () => {
        paths.push('create');
      },
    };
    await expect(
      saveCudyrVerifiedContext({
        hospital,
        data: input(),
        actor: { uid: 'reviewer' },
        runTransaction: (f: (transaction: FakeTransaction) => Promise<unknown>) => f(tx),
      })
    ).rejects.toThrow('Monthly source is missing');
    expect(paths).toEqual([]);
  });
  it('uses revision checks before writing and supports idempotent receipts', async () => {
    const hospital = {
      collection: () => ({
        doc: () => ({ collection: () => ({ doc: () => ({ path: 'audit', audit: true }) }) }),
      }),
    };
    const tx: FakeTransaction = {
      get: async (docRef: FakeDocRef) =>
        docRef.audit ? { exists: false } : { exists: true, data: () => ({ revision: 2 }) },
    };
    await expect(
      saveCudyrVerifiedContext({
        hospital,
        data: input(),
        actor: { uid: 'reviewer' },
        runTransaction: (f: (transaction: FakeTransaction) => Promise<unknown>) => f(tx),
      })
    ).rejects.toThrow('recargue');
  });
});

it('persists evidence and auditable revision atomically; retries do not create another revision', async () => {
  const request = input();
  const source = supplementRequest();
  request.entries[0].sourceRow = source.report.patients[0].sourceRow;
  const fileHash = createHash('sha256')
    .update(Buffer.from(source.file.base64, 'base64'))
    .digest('hex');
  const db = new Map<string, unknown>([
    [
      'h/cudyrMonthlySupplements/' + request.entries[0].reportId,
      {
        report: source.report,
        file: { sha256: fileHash },
        capture: { source: 'extension_monthly_report' },
      },
    ],
    ['h/cudyrSupplementFiles/' + fileHash, { base64: source.file.base64 }],
  ]);
  const hospital = makeRef('h');
  const runTransaction = async (f: (transaction: FakeTransaction) => Promise<unknown>) => {
    const staged = new Map<string, unknown>();
    const result = await f({
      get: async (r: FakeDocRef) => ({ exists: db.has(r.path), data: () => db.get(r.path) }),
      set: (r: FakeDocRef, v: unknown) => {
        staged.set(r.path, v);
      },
      create: (r: FakeDocRef, v: unknown) => {
        staged.set(r.path, v);
      },
    });
    staged.forEach((v, k) => db.set(k, v));
    return result;
  };
  const args = {
    hospital,
    data: request,
    actor: { uid: 'reviewer', name: 'Synthetic reviewer' },
    runTransaction,
  };
  expect(await saveCudyrVerifiedContext(args)).toEqual({ persisted: true, revision: 1 });
  expect(await saveCudyrVerifiedContext(args)).toEqual({ persisted: true, revision: 1 });
  expect(
    (db.get('h/cudyrVerifiedContexts/2026-10') as { reviewedBy: { uid: string } }).reviewedBy.uid
  ).toBe('reviewer');
  expect([...db.keys()].filter(k => k.includes('/revisions/'))).toHaveLength(1);
  await expect(
    saveCudyrVerifiedContext({
      ...args,
      data: { ...request, reason: 'Otra revisión con un motivo diferente.' },
    })
  ).rejects.toThrow('Operation content changed');
});

it.each([
  '2026-02-30T14:00:00-05:00',
  '2026-10-02T24:00:00Z',
  '2026-10-02T14:60:00Z',
  '2026-10-02T14:00:00+14:30',
])('rejects nonexistent admission timestamp %s', value => {
  const request = input();
  request.entries[0].admissionAt = value;
  expect(() => parseVerifiedContext(request)).toThrow();
});
it('accepts standard ISO timestamps including milliseconds', () => {
  const request = input();
  request.entries[0].admissionAt = '2026-10-02T19:00:00.000Z';
  expect(parseVerifiedContext(request).entries[0].admissionAt).toBe('2026-10-02T19:00:00.000Z');
});

it('requires explicit reasoned withdrawal to clear a month', () => {
  const request = input();
  expect(() => parseVerifiedContext({ ...request, entries: [], files: [] })).toThrow();
  expect(() =>
    parseVerifiedContext({ ...request, action: 'withdraw', reason: '', entries: [], files: [] })
  ).toThrow();
  expect(
    parseVerifiedContext({
      ...request,
      action: 'withdraw',
      reason: 'Se retira esta revisión porque su contexto debe cotejarse nuevamente.',
      entries: [],
      files: [],
    }).action
  ).toBe('withdraw');
});

describe('reviewed absent identity in a complete official report', () => {
  it.each([
    'accepted',
    'document present',
    'name present',
    'wrong month',
    'missing name',
    'missing document',
  ])('validates original report bytes before persisting: %s', async kind => {
    const request = input();
    const source = supplementRequest();
    const entry: Record<string, unknown> = {
      ...request.entries[0],
      sourceRow: null,
      basis: 'reviewed_report_absence',
      patientName: 'Synthetic missing patient',
    };
    if (kind === 'document present') entry.document = source.report.patients[0].document;
    if (kind === 'name present') entry.patientName = source.report.patients[0].patientName;
    if (kind === 'missing name') delete entry.patientName;
    if (kind === 'missing document') entry.document = '';
    if (kind === 'wrong month') {
      request.month = '2026-11';
      entry.date = '2026-11-02';
    }
    const payload = { ...request, entries: [entry] };
    const fileHash = createHash('sha256')
      .update(Buffer.from(source.file.base64, 'base64'))
      .digest('hex');
    const db = new Map<string, unknown>([
      [
        'h/cudyrMonthlySupplements/' + String(entry.reportId),
        {
          report: source.report,
          file: { sha256: fileHash },
          capture: { source: 'extension_monthly_report' },
        },
      ],
      ['h/cudyrSupplementFiles/' + fileHash, { base64: source.file.base64 }],
    ]);
    const writes: string[] = [];
    const action = saveCudyrVerifiedContext({
      hospital: makeRef('h'),
      data: payload,
      actor: { uid: 'reviewer' },
      runTransaction: (f: (transaction: FakeTransaction) => Promise<unknown>) =>
        f({
          get: async (r: FakeDocRef) => ({ exists: db.has(r.path), data: () => db.get(r.path) }),
          set: (r: FakeDocRef) => {
            writes.push(r.path);
          },
          create: (r: FakeDocRef) => {
            writes.push(r.path);
          },
        }),
    });
    if (kind === 'accepted') {
      await expect(action).resolves.toEqual({ persisted: true, revision: 1 });
      expect(writes).toContain('h/cudyrVerifiedContexts/2026-10');
    } else {
      await expect(action).rejects.toThrow();
      expect(writes).toEqual([]);
    }
  });
});

it('restricts maternal identity exceptions to documentary RN absence reviews', () => {
  const request = input();
  const maternalEntry: Record<string, unknown> = {
    ...request.entries[0],
    sourceRow: null,
    basis: 'reviewed_report_absence',
    patientName: 'RN de Madre Apellido',
    maternalSourceRow: 7,
    modality: 'cuna',
    group: 'sin_grupo',
  };
  expect(
    parseVerifiedContext({ ...request, entries: [maternalEntry] }).entries[0].maternalSourceRow
  ).toBe(7);
  maternalEntry.modality = 'hospitalizacion';
  maternalEntry.group = 'media';
  expect(() => parseVerifiedContext({ ...request, entries: [maternalEntry] })).toThrow();
});
