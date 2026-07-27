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

  it('dedupes the same application across sources and preserves reliable history attribution', () => {
    const history = [scale({ author: 'from-history', recordedAt: '2026-07-10T08:00:00' })];
    const summary = [scale({ author: 'from-summary', recordedAt: '10-07-2026 08:00:00 -06:00' })];

    const merged = mergeScaleSources(history, summary);

    expect(merged).toHaveLength(1);
    expect(merged[0].author).toBe('from-history');
  });

  it('enriches an exact history copy when only the summary provides severity', () => {
    const history = [scale({ recordedAt: '2026-07-10T08:00:00', severity: null })];
    const summary = [scale({ recordedAt: '10-07-2026 08:00:00 -06:00', severity: 'Riesgo bajo' })];

    const merged = mergeScaleSources(history, summary);

    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe('Riesgo bajo');
  });

  it('keeps exact-timestamp records separate when their severities conflict', () => {
    const history = [scale({ recordedAt: '2026-07-10T08:00:00', severity: 'Riesgo alto' })];
    const summary = [scale({ recordedAt: '10-07-2026 08:00:00 -06:00', severity: 'Riesgo bajo' })];

    const merged = mergeScaleSources(history, summary);

    expect(merged).toHaveLength(2);
    expect(merged.map(item => item.severity).sort()).toEqual(['Riesgo alto', 'Riesgo bajo']);
  });

  it('canonicalizes leading-zero and optional-second clock formats without losing distinct times', () => {
    const history = [scale({ recordedAt: '2026-07-10T8:00' })];
    const exactSummary = [scale({ recordedAt: '10-07-2026 08:00:00 -06:00' })];
    const laterSummary = [scale({ recordedAt: '10-07-2026 09:30 -06:00' })];

    expect(mergeScaleSources(history, exactSummary)).toHaveLength(1);
    expect(mergeScaleSources(history, laterSummary)).toHaveLength(2);
  });

  it('reconciles the same application when Resumen omits seconds and Historial includes them', () => {
    const history = [
      scale({
        recordedDate: '2026-07-26',
        recordedAt: '2026-07-26T13:01:19',
        author: 'Nicole Palma',
        authorRole: 'Enfermera(o)',
      }),
    ];
    const summary = [
      scale({
        recordedDate: '2026-07-26',
        recordedAt: '26-07-2026 13:01',
        author: 'Nicole Palma',
        authorRole: '',
      }),
    ];

    const merged = mergeScaleSources(history, summary);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      encounterEventId: 20260726130119,
      author: 'Nicole Palma',
      authorRole: 'Enfermera(o)',
    });
  });

  it('keeps genuine repeats when one source exposes two applications in the same minute', () => {
    const history = [
      scale({
        recordedDate: '2026-07-26',
        recordedAt: '2026-07-26T13:01:19',
        sourceOrder: 1,
      }),
      scale({
        recordedDate: '2026-07-26',
        recordedAt: '2026-07-26T13:01:48',
        sourceOrder: 2,
      }),
    ];
    const summary = [
      scale({ recordedDate: '2026-07-26', recordedAt: '26-07-2026 13:01', sourceOrder: 3 }),
    ];

    expect(mergeScaleSources(history, summary)).toHaveLength(2);
  });

  it('keeps history attribution when only the summary marks the exact copy as visible', () => {
    const history = [
      scale({
        recordedAt: '2026-07-10T08:00:00',
        archived: true,
        author: 'Enfermera Historial',
      }),
    ];
    const summary = [
      scale({
        recordedAt: '10-07-2026 08:00:00 -06:00',
        archived: false,
        author: 'Nombre Resumen',
      }),
    ];

    const [merged] = mergeScaleSources(history, summary);
    expect(merged.archived).toBe(false);
    expect(merged.author).toBe('Enfermera Historial');
  });

  it('does not collapse real repeated applications with identical results inside one source', () => {
    const history = [
      scale({ recordedAt: '2026-07-10T08:00:00' }),
      scale({ recordedAt: '2026-07-10T12:00:00' }),
    ];
    const summary = [
      scale({ recordedAt: '10-07-2026 08:00:00 -06:00' }),
      scale({ recordedAt: '10-07-2026 12:00:00 -06:00' }),
    ];

    const merged = mergeScaleSources(history, summary);

    expect(merged).toHaveLength(2);
    expect(merged.map(application => application.encounterEventId).sort()).toEqual([
      20260710080000, 20260710120000,
    ]);
  });

  it('keeps the extra repeated application when only one source exposes it', () => {
    const history = [scale({ recordedAt: '2026-07-10T10:00:00' })];
    const summary = [
      scale({ recordedAt: '10-07-2026 10:00:00 -06:00' }),
      scale({ recordedAt: '10-07-2026 15:00:00 -06:00' }),
    ];

    expect(mergeScaleSources(history, summary)).toHaveLength(2);
  });

  it('keeps ambiguous same-result records when source times differ', () => {
    const history = [scale({ recordedAt: '2026-07-10T08:00:00' })];
    const summary = [scale({ recordedAt: '10-07-2026 09:30:00 -06:00' })];

    expect(mergeScaleSources(history, summary)).toHaveLength(2);
  });

  it('preserves timestamp-less fallback ordering keys', () => {
    const first = scale({ encounterEventId: 20260710000000, recordedAt: '2026-07-10' });
    const second = scale({ encounterEventId: 20260710000001, recordedAt: '2026-07-10' });

    expect(mergeScaleSources([], [first, second]).map(item => item.encounterEventId)).toEqual([
      20260710000000, 20260710000001,
    ]);
  });

  it('does not reconcile ambiguous clockless records across sources', () => {
    const history = scale({ encounterEventId: 10, recordedAt: '2026-07-10' });
    const summary = scale({ encounterEventId: 20, recordedAt: '10-07-2026' });

    expect(mergeScaleSources([history], [summary])).toHaveLength(2);
  });

  it('keeps distinct live and archived applications from the same day (Edgardo case)', () => {
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

    expect(merged.filter(s => s.code === 'DOWNTON')).toHaveLength(2);
    expect(merged.find(s => s.archived)?.total).toBe(8);
    expect(merged.find(s => !s.archived)?.total).toBe(2);
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

  it('preserves the source ordering key when recordedAt carries no parseable time', () => {
    const merged = mergeScaleSources(
      [],
      [scale({ recordedAt: '2026-07-10', recordedDate: '2026-07-10' })]
    );
    expect(merged[0].encounterEventId).toBe(1);
  });

  it('is a no-op-safe union when a source is empty', () => {
    const only = [scale({ code: 'DOWNTON', total: 3 })];
    expect(mergeScaleSources(only, [])).toHaveLength(1);
    expect(mergeScaleSources([], only)).toHaveLength(1);
    expect(mergeScaleSources([], [])).toEqual([]);
  });
});
