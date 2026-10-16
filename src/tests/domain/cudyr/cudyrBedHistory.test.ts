import { describe, expect, it } from 'vitest';
import { buildCudyrBedHistory } from '@/domain/cudyr/cudyrBedHistory';
import { reportPlacement } from '../../services/cudyr/reportFixtures';

const sample = (overrides = {}) => ({
  placement: reportPlacement(overrides),
  observedAt: '2026-10-03T15:00:00Z',
  censusDate: '2026-10-02',
  captureId: 'synthetic',
});
describe('archived bed movement viewer', () => {
  it('deduplicates repeated captures and preserves the original start, descriptor and missing end', () => {
    const item = sample({
      sourceBedLabel: 'CMA R1 Hospitalizados',
      sourceEndAt: '0001-01-01T00:00:00Z',
    });
    const result = buildCudyrBedHistory('synthetic-episode', [
      item,
      { ...item, observedAt: '2026-10-04T15:00:00Z' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      bed: 'CMA R1 Hospitalizados',
      startAt: item.placement.sourceStartAt,
      endAt: '',
      status: 'observada',
    });
  });
  it('flags conflicting closure revisions but allows ordinary open-to-closed progression', () => {
    const open = sample({ sourceEndAt: '' });
    const closed = {
      ...sample({ sourceEndAt: '2026-10-03T10:00:00-05:00' }),
      observedAt: '2026-10-04T15:00:00Z',
    };
    expect(buildCudyrBedHistory('synthetic-episode', [open, closed])[0].status).toBe('finalizada');
    expect(
      buildCudyrBedHistory('synthetic-episode', [
        closed,
        { ...open, observedAt: '2026-10-05T15:00:00Z' },
      ])[0].status
    ).toBe('contradictoria');
    expect(
      buildCudyrBedHistory('synthetic-episode', [
        closed,
        sample({ sourceEndAt: '2026-10-03T09:00:00-05:00' }),
      ])[0].status
    ).toBe('contradictoria');
  });
  it('keeps annulment and contradictory starts visible, never joins other episodes', () => {
    const item = sample();
    const changed = sample({ sourceStartAt: '2026-10-02T13:00:00-05:00' });
    expect(buildCudyrBedHistory('synthetic-episode', [item, changed])[0].status).toBe(
      'contradictoria'
    );
    expect(
      buildCudyrBedHistory('synthetic-episode', [item, sample({ isDeleted: true })])[0].status
    ).toBe('anulada');
    expect(buildCudyrBedHistory('other', [item])).toEqual([]);
  });
});
