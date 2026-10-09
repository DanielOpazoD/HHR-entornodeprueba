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
