import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCudyrReviewEvidence } from '@/services/cudyr/cudyrReviewEvidence';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { compareCudyrMonth } from '@/services/cudyr/cudyrMonthlyComparison';
import { reportInput } from './reportFixtures';
import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';

describe('case-scoped monthly review evidence', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto));
  afterEach(() => vi.unstubAllGlobals());
  const setup = () => {
    const data = buildCudyrReport(reportInput());
    const row = data.rows[0];
    const item: CudyrComparisonItem = {
      key: 'category:5:2',
      source: 'Eloísa',
      sourceRow: 5,
      sourceDate: row.date,
      sourceValue: 'C2',
      patientName: row.patientName,
      document: row.rut,
      status: 'date_review',
      reason: 'Cotejar',
      candidateKeys: [row.key],
    };
    return { data, item };
  };
  it('keeps a decision current when another patient changes or identical data is recaptured', async () => {
    const { data, item } = setup();
    const initial = await buildCudyrReviewEvidence(data, [item], []);
    data.rows.push({
      ...data.rows[0],
      key: 'unrelated',
      rut: 'other',
      clinicalEpisodeId: 'other',
      modality: 'cma',
    });
    data.rows[0].lastCaptureAt = '2026-10-08T00:00:00Z';
    data.rows[0].sourceRunId = 'another-run';
    data.coverage[0].lastSyncedAt = '2026-10-08T00:00:00Z';
    expect(await buildCudyrReviewEvidence(data, [item], [])).toEqual(initial);
    data.rows[0].modality = 'cuna';
    expect((await buildCudyrReviewEvidence(data, [item], []))[item.key].contextHash).not.toBe(
      initial[item.key].contextHash
    );
  });
  it.each(['reentry', 'shared-rn', 'contradictory-episode'])(
    'invalidates on new %s context',
    async kind => {
      const { data, item } = setup();
      const initial = await buildCudyrReviewEvidence(data, [item], []);
      data.rows.push({
        ...data.rows[0],
        key: 'new',
        rut: kind === 'contradictory-episode' ? 'other-document' : item.document,
        clinicalEpisodeId:
          kind === 'contradictory-episode' ? data.rows[0].clinicalEpisodeId : 'new-episode',
        patientName: kind === 'shared-rn' ? 'RN sintético' : item.patientName,
      });
      expect((await buildCudyrReviewEvidence(data, [item], []))[item.key].contextHash).not.toBe(
        initial[item.key].contextHash
      );
    }
  );
  it('retains incomplete coverage and source identity conflicts even without a candidate', async () => {
    const { data, item } = setup();
    const empty = { ...item, document: 'absent', candidateKeys: [] };
    const initial = await buildCudyrReviewEvidence(data, [empty], []);
    data.coverage[0].state = 'error';
    expect((await buildCudyrReviewEvidence(data, [empty], []))[item.key].contextHash).not.toBe(
      initial[item.key].contextHash
    );
    data.coverage[0].state = 'disponible';
    const collision = { ...empty, key: 'category:6:2', patientName: 'RN sintético' };
    expect(
      (await buildCudyrReviewEvidence(data, [empty, collision], []))[item.key].contextHash
    ).not.toBe(initial[item.key].contextHash);
  });
  it('is independent of presentation order, but preserves clinical author and date', async () => {
    const { data, item } = setup();
    const items = [item, ...compareCudyrMonth(data)];
    const initial = await buildCudyrReviewEvidence(data, items, []);
    data.coverage.reverse();
    expect(await buildCudyrReviewEvidence(data, [...items].reverse(), [])).toEqual(initial);
    data.rows[0].evaluation = { ...data.rows[0].evaluation!, author: 'Autora verificada' };
    expect((await buildCudyrReviewEvidence(data, items, []))[item.key].contextHash).not.toBe(
      initial[item.key].contextHash
    );
  });
});
