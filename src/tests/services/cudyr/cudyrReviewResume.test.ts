import { describe, expect, it } from 'vitest';
import {
  resolveCudyrReviewSources,
  cudyrReviewSourceSets,
} from '@/services/cudyr/cudyrReviewResume';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
import type { SavedCudyrReview } from '@/types/domain/cudyrReview';
import { reviewRequest } from '../../fixtures/cudyrReviewFixture';
const sources = [{ ...reviewRequest().evidence.sources[0], kind: 'categories' as const }];
const archived = (id: string, hash: string) =>
  ({ id, month: '2026-07', file: { name: 'Julio.xls', sha256: hash } }) as ArchivedCudyrSupplement;

describe('resume original source versions', () => {
  it('selects the original archived hash instead of the latest or same filename', () => {
    const result = resolveCudyrReviewSources(
      sources,
      [archived('new', 'b'.repeat(64)), archived('original', sources[0].sha256)],
      [],
      '2026-07'
    );
    expect(result).toEqual({ archiveId: 'original', files: [], missing: [] });
  });
  it('lists missing originals and never uses a different month', () => {
    expect(
      resolveCudyrReviewSources(sources, [archived('original', sources[0].sha256)], [], '2026-08')
        .missing
    ).toEqual(sources);
    expect(
      resolveCudyrReviewSources(sources, [archived('wrong', 'b'.repeat(64))], [], '2026-07').missing
    ).toEqual(sources);
  });
  it('reuses only local files with the exact kind and hash', () => {
    const discharge = { kind: 'discharges' as const, name: 'Altas.xls', sha256: 'c'.repeat(64) };
    const file = {
      ...discharge,
      report: { from: '2026-07-01', to: '2026-07-31', generatedLabel: '', rows: [] },
    };
    expect(resolveCudyrReviewSources([...sources, discharge], [], [file], '2026-07')).toEqual({
      archiveId: '',
      files: [file],
      missing: sources,
    });
  });
  it('offers distinct original sets only for the exact reviewed period', () => {
    const request = reviewRequest();
    const record: SavedCudyrReview = {
      ...request,
      schemaVersion: 1,
      evidence: { ...request.evidence, sources },
      decision: { ...request.decision, action: 'pending' },
      id: 'synthetic',
      revision: 1,
      verification: 'user_review',
      updatedAt: '2026-10-07T20:00:00Z',
      reviewedBy: { uid: 'synthetic', name: 'Revisor', email: 'test@example.com', role: 'admin' },
    };
    const sets = cudyrReviewSourceSets(
      [record, record, { ...record, evidence: { ...record.evidence, to: '2026-07-20' } }],
      '2026-07-01',
      '2026-07-31'
    );
    expect(sets).toHaveLength(1);
    expect(sets[0].sources).toEqual(sources);
  });
});
