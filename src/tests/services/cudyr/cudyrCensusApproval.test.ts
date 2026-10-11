import { describe, it, expect } from 'vitest';
import {
  applyCudyrCensusApprovals,
  cudyrDayFingerprint,
  cudyrCensusAccepted,
  prepareCudyrCensusApproval,
} from '@/services/cudyr/cudyrCensusApproval';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from './reportFixtures';
import type { CudyrVerifiedContext } from '@/services/cudyr/cudyrVerifiedContext';
const fixture = () => {
  const data = buildCudyrReport(confirmedReportInput());
  data.from = data.to = data.rows[0].date;
  data.coverage = data.coverage.filter(d => d.date === data.from);
  data.rows.forEach(row => {
    row.monthlyEvidence = {
      reportId: 'source',
      sourceDate: '2026-10-03',
      checkedAt: '2026-10-08T20:00:00Z',
      state: 'found',
    };
  });
  return data;
};
const reviewFor = async (data: ReturnType<typeof fixture>) =>
  ({
    month: data.from.slice(0, 7),
    censusApproval: {
      policyVersion: 2,
      approvedAt: '2026-10-08T20:00:00Z',
      approvedBy: { uid: 'reviewer', name: 'Responsable' },
      reason: 'Reconstrucción aprobada',
      days: await Promise.all(
        data.coverage.map(async d => ({
          date: d.date,
          fingerprint: await cudyrDayFingerprint(data, d.date),
        }))
      ),
    },
  }) as CudyrVerifiedContext;
describe('documented approval of reconstructed census', () => {
  it('accepts the reconstructed population without rewriting the source mismatch or clinical rows', async () => {
    const data = fixture();
    data.coverage.forEach(d => {
      d.censusVerification = {
        state: 'mismatch',
        missing: 1,
        extra: 1,
        reason: 'Informe censal incompleto',
      };
    });
    const result = await applyCudyrCensusApprovals(data, [await reviewFor(data)]);
    expect(result.rows).toBe(data.rows);
    expect(result.coverage.every(cudyrCensusAccepted)).toBe(true);
    expect(result.coverage[0].censusVerification?.state).toBe('mismatch');
  });
  it.each(['category', 'patient', 'eligibility', 'removed', 'added'])(
    'does not carry approval over changed %s',
    async kind => {
      const data = fixture(),
        review = await reviewFor(data),
        date = data.rows[0].date;
      if (kind === 'category') data.rows[0].evaluation!.category = 'A1';
      if (kind === 'patient') data.rows[0].rut = 'changed';
      if (kind === 'eligibility') data.rows[0].eligibility = 'no_elegible';
      if (kind === 'removed') data.rows.shift();
      if (kind === 'added')
        data.rows.push({
          ...data.rows[0],
          key: 'new',
          clinicalEpisodeId: 'new',
        });
      const result = await applyCudyrCensusApprovals(data, [review]);
      expect(result.coverage.find(d => d.date === date)?.reconstructionApproval).toBeUndefined();
    }
  );
  it('ignores read timestamps but refuses incomplete reads and missing approvals', async () => {
    const data = fixture(),
      review = await reviewFor(data);
    data.generatedAt = '2026-10-09T20:00:00Z';
    expect(
      (await applyCudyrCensusApprovals(data, [review])).coverage[0].reconstructionApproval
    ).toBeDefined();
    data.issues = ['Lectura fallida'];
    expect(
      (await applyCudyrCensusApprovals(data, [review])).coverage[0].reconstructionApproval
    ).toBeUndefined();
    expect(
      (await applyCudyrCensusApprovals(data, [])).coverage[0].reconstructionApproval
    ).toBeUndefined();
  });
  it('refuses to approve a partial month', async () => {
    await expect(prepareCudyrCensusApproval(fixture())).rejects.toThrow('Complete');
  });
});

it.each(['query', 'eligibility'])(
  'does not turn a matching human attestation into official data with unresolved %s',
  async kind => {
    const data = fixture();
    if (kind === 'query') {
      data.captures = [];
      data.rows.forEach(r => {
        delete r.monthlyEvidence;
        r.evaluation = null;
        r.cudyrStatus = 'sin_captura';
      });
    }
    if (kind === 'eligibility') data.rows[0].eligibility = 'por_revisar';
    const result = await applyCudyrCensusApprovals(data, [await reviewFor(data)]);
    expect(result.coverage[0].reconstructionApproval).toBeUndefined();
  }
);

it('keeps row fingerprints stable across approval revision without embedding monthly approval in rows', async () => {
  const data = fixture();
  data.rows[0].verifiedContext = {
    revision: 1,
    reviewedAt: '2026-10-08T20:00:00Z',
    reviewedBy: 'Responsable',
    reason: 'Episodio documental comprobado',
    evidenceHashes: ['a'.repeat(64)],
    applicationTimingBasis: 'assumed_before_0800',
  };
  const review = await reviewFor(data);
  data.rows[0].verifiedContext.revision = 2;
  const result = await applyCudyrCensusApprovals(data, [review]);
  expect(result.coverage[0].reconstructionApproval).toBeDefined();
  expect(result.rows[0].verifiedContext).not.toHaveProperty('censusApproval');
});
