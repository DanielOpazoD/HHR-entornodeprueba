import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  validateReport,
  fingerprint,
  saveOfficialReport,
  readOfficialReport,
} = require('../../../functions/lib/cudyrOfficialReportStore.js');
const fixture = () => {
  const rows = [
    {
      key: 'row',
      date: '2026-08-02',
      clinicalEpisodeId: 'episode',
      patientName: 'Sintético',
      rut: 'synthetic',
      documentType: 'Rut',
      admissionDate: '2026-08-01',
      admissionTime: '10:00',
      bedId: 'R1',
      bedName: 'R1',
      group: 'intermedia',
      modality: 'hospitalizacion',
      eligibility: 'elegible',
      eligibilityReason: '8 horas',
      cudyrStatus: 'registrado',
      evaluation: { category: 'C2' },
    },
  ];
  const coverage = Array.from({ length: 31 }, (_, i) => ({
    date: '2026-08-' + String(i + 1).padStart(2, '0'),
    state: 'disponible',
    reconstructionApproval: { approvedAt: '2026-10-08' },
  }));
  const report = {
    schemaVersion: 1,
    from: '2026-08-01',
    to: '2026-08-31',
    rows,
    coverage,
    issues: [],
  };
  const approval = {
    policyVersion: 2,
    days: coverage.map(d => ({
      date: d.date,
      fingerprint: fingerprint(report, d.date),
    })),
  };
  return { report, approval };
};
it('binds a saved report to every approved day and refuses changed clinical contents', () => {
  const { report, approval } = fixture();
  expect(() => validateReport(report, approval, '2026-08')).not.toThrow();
  report.rows[0].evaluation.category = 'B2';
  expect(() => validateReport(report, approval, '2026-08')).toThrow(/contenido cambió/);
});
it('rejects unresolved or duplicate daily coverage before persisting', () => {
  const { report, approval } = fixture();
  report.coverage[0] = report.coverage[1];
  expect(() => validateReport(report, approval, '2026-08')).toThrow();
});
it('rejects writes from readers', async () => {
  await expect(
    saveOfficialReport({ hospital: {}, data: {}, actor: { role: 'doctor' } })
  ).rejects.toThrow(/permission/);
});
it('does not return clinical payload when source metadata has changed', async () => {
  const getAll = vi.fn(async (...refs) => refs.map(ref => ({ ref, exists: false })));
  const collection = (name: string) => ({
    doc: (id: string) => ({
      path: name + '/' + id,
      get: async () => ({
        ref: { path: name + '/' + id },
        exists: name === 'cudyrOfficialReports',
        data: () =>
          name === 'cudyrOfficialReports'
            ? {
                policyVersion: 2,
                sourceVersion: 'old',
                episodes: [],
                report: 'should-not-be-returned',
              }
            : undefined,
      }),
    }),
    where() {
      return this;
    },
    select() {
      return this;
    },
    limit() {
      return this;
    },
    get: async () => ({ size: 0, docs: [] }),
  });
  const hospital = {
    collection,
    firestore: {
      getAll,
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
          getAll,
        }),
    },
  };
  const result = await readOfficialReport(hospital, { month: '2026-08' });
  expect(result.state).toBe('missing');
  expect(result.report).toBeUndefined();
});

it('rejects changed documentary census evidence after approval', () => {
  const { report, approval } = fixture();
  Object.assign(report.coverage[0], {
    documentaryReconstruction: {
      reason: 'Changed evidence',
      evidenceHashes: ['wrong'],
    },
  });
  expect(() => validateReport(report, approval, '2026-08')).toThrow(/contenido cambió/);
});

it.each(['unchanged', 'documentary-change', 'legacy-correction', 'episode-correction'])(
  'preserves a pre-marker snapshot only with its exact original sources: %s',
  async change => {
    const { createHash } = require('node:crypto');
    const sourceVersion = createHash('sha256')
      .update(JSON.stringify([2, [['cudyrVerifiedContexts/2026-08', '10:0']]]))
      .digest('hex');
    const snapshot = {
      policyVersion: 2,
      sourceVersion,
      version: 'original-version',
      savedAt: '2026-10-08T12:00:00Z',
      episodes: ['synthetic-episode'],
      report: 'original-payload',
    };
    const collection = (name: string) => ({
      doc: (id: string) => {
        const path = name + '/' + id;
        return {
          path,
          get: async () => ({
            ref: { path },
            exists:
              name === 'cudyrOfficialReports' ||
              name === 'cudyrVerifiedContexts' ||
              (name === 'cudyrArchiveVersions' && change === 'legacy-correction'),
            updateTime: { seconds: change === 'documentary-change' ? 11 : 10, nanoseconds: 0 },
            data: () => (name === 'cudyrOfficialReports' ? snapshot : undefined),
          }),
        };
      },
      where() {
        return this;
      },
      select() {
        return this;
      },
      limit() {
        return this;
      },
      get: async () => {
        const docs =
          name === 'cudyrArchiveVersions' && change === 'episode-correction'
            ? [
                {
                  ref: { path: name + '/synthetic-marker' },
                  updateTime: { seconds: 12, nanoseconds: 0 },
                },
              ]
            : [];
        return { size: docs.length, docs };
      },
    });
    const hospital = {
      collection,
      firestore: {
        runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
          }),
      },
    };
    const result = await readOfficialReport(hospital, { month: '2026-08' });
    if (change === 'unchanged') {
      expect(result).toMatchObject({
        state: 'ready',
        sourceVersion,
        version: 'original-version',
        report: 'original-payload',
      });
      const cached = await readOfficialReport(hospital, {
        month: '2026-08',
        knownVersion: result.version,
      });
      expect(cached.state).toBe('unchanged');
      expect(cached.report).toBeUndefined();
    } else {
      expect(result.state).toBe('missing');
      expect(result.report).toBeUndefined();
    }
  }
);
