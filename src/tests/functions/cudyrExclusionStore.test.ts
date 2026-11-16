// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { parseExclusion } = require('../../../functions/lib/cudyrExclusionStore.js');
const input = {
  kind: 'save-daily-exclusion',
  schemaVersion: 1,
  confirmed: true,
  date: '2026-07-02',
  clinicalEpisodeId: 'episode',
  expectedRevision: 0,
  operationId: '00000000-0000-4000-8000-000000000001',
  reason: 'cma',
  note: 'Modalidad verificada.',
};
describe('daily exclusion request', () => {
  it('rejects missing evidence, forged scope and invalid identities', () => {
    for (const patch of [
      { reason: 'other' },
      { note: '' },
      { date: '2026-02-30' },
      { clinicalEpisodeId: '' },
      { confirmed: false },
      { expectedRevision: -1 },
      { hospitalId: 'other' },
      { operationId: 'invalid' },
    ])
      expect(() => parseExclusion({ ...input, ...patch })).toThrow();
  });
  it('uses server-owned identity and supports withdrawing without deleting evidence', () => {
    const result = parseExclusion({
      ...input,
      reason: null,
      updatedBy: { uid: 'forged' },
      updatedAt: 'forged',
    });
    expect(result.reason).toBeNull();
    expect(result).not.toHaveProperty('updatedBy');
    expect(result).not.toHaveProperty('updatedAt');
  });
  it('keeps the episode request exactly as before, so stored receipts still match', () => {
    expect(parseExclusion(input)).toEqual({
      date: '2026-07-02',
      clinicalEpisodeId: 'episode',
      expectedRevision: 0,
      operationId: '00000000-0000-4000-8000-000000000001',
      reason: 'cma',
      note: 'Modalidad verificada.',
    });
  });
  it('targets a discharge without episode only with its two reasons and never both identities', () => {
    const { clinicalEpisodeId: _episode, ...base } = input;
    const discharge = { ...base, dischargeId: 'rayen-egreso:P123456785:2026-07-02' };
    for (const reason of ['not_hospitalized', 'under_eight_hours', null])
      expect(parseExclusion({ ...discharge, reason })).toMatchObject({
        clinicalEpisodeId: '',
        dischargeId: 'rayen-egreso:P123456785:2026-07-02',
        reason,
      });
    for (const patch of [
      { reason: 'cma' },
      { reason: 'healthy_crib' },
      { dischargeId: '' },
      { dischargeId: null },
      { dischargeId: 'x'.repeat(201) },
      { clinicalEpisodeId: 'episode' },
      { clinicalEpisodeId: '' },
    ])
      expect(() => parseExclusion({ ...discharge, ...patch })).toThrow();
  });
});
