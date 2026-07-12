import { describe, expect, it } from 'vitest';
import { mergeScaleSources, evaluationScalesForCensusDay } from '@/features/rayen-import';
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

  it('dedupes a scale present in both sources, preferring the summary copy (tabla resumen primero)', () => {
    const history = [scale({ author: 'from-history', recordedAt: '2026-07-10T08:00:00' })];
    const summary = [scale({ author: 'from-summary', recordedAt: '10-07-2026 09:30:00 -06:00' })];

    const merged = mergeScaleSources(history, summary);

    expect(merged).toHaveLength(1);
    expect(merged[0].author).toBe('from-summary');
  });

  it('a LIVE score of the day beats an archived one from the other source, even if newer (Edgardo case)', () => {
    // History has only an ARCHIVED Downton (alto) applied 10-07 in the AFTERNOON; the live Downton
    // (medio) applied 10-07 in the MORNING lives only in the summary. Live must win despite being older.
    const history = [
      scale({
        code: 'DOWNTON',
        recordedDate: '2026-07-10',
        recordedAt: '2026-07-10T16:00:00',
        total: 8,
        severity: 'Riesgo alto',
        archived: true,
      }),
    ];
    const summary = [
      scale({
        code: 'DOWNTON',
        recordedDate: '2026-07-10',
        recordedAt: '10-07-2026 09:00:00 -06:00',
        total: 2,
        severity: 'Riesgo medio',
      }),
    ];

    const merged = mergeScaleSources(history, summary);

    expect(merged.filter(s => s.code === 'DOWNTON')).toHaveLength(1);
    const downton = merged.find(s => s.code === 'DOWNTON');
    expect(downton?.total).toBe(2);
    expect(downton?.severity).toBe('Riesgo medio');
    expect(
      evaluationScalesForCensusDay(merged, '2026-07-10').find(s => s.code === 'DOWNTON')?.total
    ).toBe(2);
  });

  it('keeps an archived score when it is the only measurement of its day (across both sources)', () => {
    const history = [
      scale({
        code: 'DOWNTON',
        recordedDate: '2026-07-10',
        total: 3,
        severity: 'Riesgo alto',
        archived: true,
      }),
    ];
    const merged = mergeScaleSources(history, []);
    expect(merged.filter(s => s.code === 'DOWNTON')).toHaveLength(1);
    expect(merged[0].total).toBe(3);
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
