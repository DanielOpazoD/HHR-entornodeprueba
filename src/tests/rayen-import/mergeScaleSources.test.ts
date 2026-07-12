import { describe, expect, it } from 'vitest';
import { mergeScaleSources } from '@/features/rayen-import';
import type { EvaluationScale } from '@/features/rayen-import';

const scale = (over: Partial<EvaluationScale>): EvaluationScale => ({
  code: 'BRADEN',
  name: 'Escala de riesgo UPP (Braden)',
  encounterEventId: 1,
  recordedDate: '2026-07-10',
  recordedAt: '2026-07-10T08:00:00',
  author: '',
  authorRole: '',
  items: [],
  total: 17,
  severity: 'Riesgo bajo',
  ...over,
});

describe('mergeScaleSources', () => {
  it('unions scales that exist in only one source (Rodrigo Braden case)', () => {
    // History has only a Downton; the Braden lives ONLY in the summary/encounterFormEntry source.
    const history = [scale({ code: 'DOWNTON', total: 4, severity: 'Riesgo alto' })];
    const summary = [scale({ code: 'BRADEN', total: 21, severity: 'Riesgo bajo' })];

    const merged = mergeScaleSources(history, summary);

    expect(merged).toHaveLength(2);
    expect(merged.find(s => s.code === 'BRADEN')?.total).toBe(21);
    expect(merged.find(s => s.code === 'DOWNTON')?.total).toBe(4);
  });

  it('dedupes a scale present in both sources, preferring the history copy', () => {
    const history = [scale({ author: 'from-history', recordedAt: '2026-07-10T08:00:00' })];
    const summary = [scale({ author: 'from-summary', recordedAt: '10-07-2026 09:30:00 -06:00' })];

    const merged = mergeScaleSources(history, summary);

    expect(merged).toHaveLength(1);
    expect(merged[0].author).toBe('from-history');
  });

  it('normalizes the ordering key to a YYYYMMDDHHMMSS timestamp for both sources', () => {
    const history = [
      scale({
        code: 'DOWNTON',
        recordedDate: '2026-07-11',
        recordedAt: '2026-07-11T12:35:29.97',
        total: 5,
      }),
    ];
    const summary = [
      scale({
        code: 'BRADEN',
        recordedDate: '2026-07-10',
        recordedAt: '10-07-2026 8:14:31 -06:00',
        total: 21,
      }),
    ];

    const merged = mergeScaleSources(history, summary);

    expect(merged.find(s => s.code === 'DOWNTON')?.encounterEventId).toBe(20260711123529);
    expect(merged.find(s => s.code === 'BRADEN')?.encounterEventId).toBe(20260710081431);
  });

  it('falls back to 000000 time when recordedAt carries no parseable time', () => {
    const merged = mergeScaleSources(
      [],
      [scale({ recordedAt: '2026-07-10', recordedDate: '2026-07-10' })]
    );
    expect(merged[0].encounterEventId).toBe(20260710000000);
  });

  it('is a no-op-safe union when a source is empty', () => {
    const only = [scale({ code: 'DOWNTON', total: 3 })];
    expect(mergeScaleSources(only, [])).toHaveLength(1);
    expect(mergeScaleSources([], only)).toHaveLength(1);
    expect(mergeScaleSources([], [])).toEqual([]);
  });
});
