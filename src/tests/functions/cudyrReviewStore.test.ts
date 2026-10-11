// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { reviewRequest } from '@/tests/fixtures/cudyrReviewFixture';
const require = createRequire(import.meta.url);
const { parseReview } = require('../../../functions/lib/cudyrReviewStore.js');
describe('documentary review request boundaries', () => {
  it('normalizes only evidence and decision, excluding client-supplied audit metadata', () => {
    const parsed = parseReview({ ...reviewRequest(), reviewedBy: { uid: 'forged' }, revision: 99 });
    expect(parsed).not.toHaveProperty('reviewedBy');
    expect(parsed).not.toHaveProperty('revision');
    expect(parsed.evidence).toEqual(reviewRequest().evidence);
  });
  it.each(['contextHash', 'sources', 'from', 'to', 'sourceDate'])(
    'rejects invalid evidence %s',
    field => {
      const data = reviewRequest();
      expect(() =>
        parseReview({ ...data, evidence: { ...data.evidence, [field]: 'invalid' } })
      ).toThrow();
    }
  );
  it('rejects unknown decisions, missing reasons and contradictory episode references', () => {
    for (const decision of [
      { action: 'unknown', episodeId: '', reason: 'Revisado por usuario' },
      { action: 'pending', episodeId: '', reason: 'corto' },
      { action: 'link', episodeId: '', reason: 'Revisado por usuario' },
      { action: 'exclude', episodeId: 'episode', reason: 'Revisado por usuario' },
    ])
      expect(() => parseReview({ ...reviewRequest(), decision })).toThrow();
  });
  it('rejects duplicate/mismatched sources, invalid calendar days and inconsistent source day', () => {
    const data = reviewRequest();
    for (const evidence of [
      { ...data.evidence, sources: [data.evidence.sources[0], data.evidence.sources[0]] },
      { ...data.evidence, sources: [{ ...data.evidence.sources[0], kind: 'discharges' }] },
      { ...data.evidence, to: '2026-07-32' },
      { ...data.evidence, sourceDate: '2026-07-03' },
      { ...data.evidence, sourceDate: '2026-08-02' },
    ])
      expect(() => parseReview({ ...data, evidence })).toThrow();
  });
});
