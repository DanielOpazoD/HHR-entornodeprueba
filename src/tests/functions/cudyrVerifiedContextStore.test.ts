import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const {
  parseVerifiedContext,
  saveCudyrVerifiedContext,
} = require('../../../functions/lib/cudyrVerifiedContextStore.js');
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
    const request: any = input();
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
    const ref = (path: string): any => ({
      path,
      collection: (n: string) => ({ doc: (id: string) => ref(`${path}/${n}/${id}`) }),
    });
    const hospital = ref('hospital');
    const tx = {
      get: async () => ({ exists: false }),
      set: () => paths.push('set'),
      create: () => paths.push('create'),
    };
    await expect(
      saveCudyrVerifiedContext({
        hospital,
        data: input(),
        actor: { uid: 'reviewer' },
        runTransaction: (f: any) => f(tx),
      })
    ).rejects.toThrow('Monthly source is missing');
    expect(paths).toEqual([]);
  });
  it('uses revision checks before writing and supports idempotent receipts', async () => {
    const hospital: any = {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ audit: true }) }) }) }),
    };
    const tx = {
      get: async (ref: any) =>
        ref.audit ? { exists: false } : { exists: true, data: () => ({ revision: 2 }) },
    };
    await expect(
      saveCudyrVerifiedContext({
        hospital,
        data: input(),
        actor: { uid: 'reviewer' },
        runTransaction: (f: any) => f(tx),
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
  const db = new Map<string, any>([
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
  const ref = (path: string): any => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(path + '/' + name + '/' + id) }),
  });
  const hospital = ref('h');
  const runTransaction = async (f: any) => {
    const staged = new Map<string, any>();
    const result = await f({
      get: async (r: any) => ({ exists: db.has(r.path), data: () => db.get(r.path) }),
      set: (r: any, v: any) => staged.set(r.path, v),
      create: (r: any, v: any) => staged.set(r.path, v),
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
  expect(db.get('h/cudyrVerifiedContexts/2026-10').reviewedBy.uid).toBe('reviewer');
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
    const request: any = input();
    const source = supplementRequest();
    const e = request.entries[0];
    e.sourceRow = null;
    e.basis = 'reviewed_report_absence';
    e.patientName = 'Synthetic missing patient';
    if (kind === 'document present') e.document = source.report.patients[0].document;
    if (kind === 'name present') e.patientName = source.report.patients[0].patientName;
    if (kind === 'missing name') delete e.patientName;
    if (kind === 'missing document') e.document = '';
    if (kind === 'wrong month') {
      request.month = '2026-11';
      e.date = '2026-11-02';
    }
    const fileHash = createHash('sha256')
      .update(Buffer.from(source.file.base64, 'base64'))
      .digest('hex');
    const db = new Map<string, any>([
      [
        'h/cudyrMonthlySupplements/' + e.reportId,
        {
          report: source.report,
          file: { sha256: fileHash },
          capture: { source: 'extension_monthly_report' },
        },
      ],
      ['h/cudyrSupplementFiles/' + fileHash, { base64: source.file.base64 }],
    ]);
    const ref = (path: string): any => ({
      path,
      collection: (n: string) => ({ doc: (id: string) => ref(path + '/' + n + '/' + id) }),
    });
    const writes: string[] = [];
    const action = saveCudyrVerifiedContext({
      hospital: ref('h'),
      data: request,
      actor: { uid: 'reviewer' },
      runTransaction: (f: any) =>
        f({
          get: async (r: any) => ({ exists: db.has(r.path), data: () => db.get(r.path) }),
          set: (r: any) => writes.push(r.path),
          create: (r: any) => writes.push(r.path),
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
  const request: any = input();
  request.entries[0] = {
    ...request.entries[0],
    sourceRow: null,
    basis: 'reviewed_report_absence',
    patientName: 'RN de Madre Apellido',
    maternalSourceRow: 7,
    modality: 'cuna',
    group: 'sin_grupo',
  };
  expect(parseVerifiedContext(request).entries[0].maternalSourceRow).toBe(7);
  request.entries[0].modality = 'hospitalizacion';
  request.entries[0].group = 'media';
  expect(() => parseVerifiedContext(request)).toThrow();
});
