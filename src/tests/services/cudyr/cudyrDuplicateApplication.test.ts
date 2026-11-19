// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { CudyrSourceEvaluation as Evaluation } from '@/types/domain/cudyrHistory';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { applyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyProjection';
import { buildCudyrMonthlyIndicator } from '@/features/cudyr/indicator/cudyrMonthlyIndicator';
import { confirmedReportInput, reportObservation } from './reportFixtures';

// Sources pass through the real archive validator, with its real event and observation keys.
const { parseArchiveRequest, evaluationKey, observationKey, owningCensusDate } = createRequire(
  import.meta.url
)('../../../../functions/lib/cudyrHistoryContract.js');

const items = [1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map((value, index) => ({
  fieldId: String(index + 1),
  label: 'Ítem ' + (index + 1),
  typeId: index < 6 ? 1 : 2,
  value: String(value),
}));
const source = (id: string, patch: Partial<Evaluation> = {}): Evaluation => ({
  ...reportObservation().evaluation,
  items: structuredClone(items),
  authorRoleId: '2',
  sourceEvaluationId: id,
  sourceVersion: 'v-' + id,
  ...patch,
});
const archived = (entries: Evaluation[]) =>
  parseArchiveRequest({
    schemaVersion: 1,
    authorityDate: '2026-10-02',
    runId: 'synthetic',
    evaluations: entries,
  }).evaluations.map((evaluation: Evaluation) =>
    reportObservation({
      evaluation,
      censusDate: owningCensusDate(evaluation.recordedAt),
      eventKey: evaluationKey('synthetic', evaluation),
      id: observationKey('synthetic', evaluation),
    })
  ) as ReturnType<typeof reportObservation>[];
const report = (observations: ReturnType<typeof archived>) =>
  applyCudyrMonthlySources(
    buildCudyrReport(confirmedReportInput({ sourcePolicy: 'eloisa_only', observations })),
    []
  );
const summary = (data: ReturnType<typeof report>) => {
  const row = data.rows[0]!;
  const { eligible, categorized } = buildCudyrMonthlyIndicator(data, new Date(data.generatedAt));
  return {
    status: row.cudyrStatus,
    category: row.evaluation?.category ?? null,
    count: row.evaluationCount,
    eligible,
    categorized,
  };
};
const REVIEW = { status: 'por_revisar', category: null, categorized: 0 };

describe('CUDYR application saved several times in the source (CUD-11)', () => {
  it('counts an identical triple save once and keeps every archived copy', () => {
    const data = report(archived(['1', '2', '3'].map(id => source(id))));
    expect(summary(data)).toMatchObject({
      status: 'registrado',
      category: 'C2',
      count: 1,
      eligible: 1,
      categorized: 1,
    });
    expect(data.observations).toHaveLength(3);
  });

  it('keeps any differing item, score, category, author or role field and invalid times in review', () => {
    const cases: [string, Partial<Evaluation>][] = [
      ['category', { category: 'C3' }],
      ['dependency', { dependencyScore: 10 }],
      ['risk', { riskScore: 9 }],
      ['authorId', { authorId: 'other' }],
      ['author', { author: 'Otra persona' }],
      ['roleId', { authorRoleId: '1' }],
      ['role', { authorRole: 'Médico' }],
      ['fieldId', { items: items.map((x, i) => (i === 2 ? { ...x, fieldId: '15' } : x)) }],
      ...items.map((_, k): [string, Partial<Evaluation>] => [
        'item-' + k,
        { items: items.map((x, i) => (i === k ? { ...x, value: '3' } : x)) },
      ]),
    ];
    for (const [key, patch] of cases)
      expect(
        summary(report(archived([source('a'), source('b'), source('c', patch)]))),
        key
      ).toMatchObject(REVIEW);
    for (const time of ['', 'invalid']) {
      const observations = archived([source('a'), source('b')]);
      observations.forEach(o => {
        o.evaluation.recordedAt = time;
      });
      expect(summary(report(observations)), time).toMatchObject(REVIEW);
    }
  });

  it('keeps annulled applications and their versions in the archive', () => {
    for (const [key, events] of Object.entries({
      'one-live-one-void': [source('a'), source('b', { isDeleted: true })],
      'two-live-one-void': [source('a'), source('b', { isDeleted: true }), source('c')],
      'void-revision': [
        source('a'),
        source('a', { sourceVersion: 'void', isDeleted: true }),
        source('b'),
      ],
      'all-void': [source('a', { isDeleted: true }), source('b', { isDeleted: true })],
    })) {
      const data = report(archived(events));
      expect(data.rows[0]!.warnings.join(' '), key).toContain('anulada');
      expect(data.observations.filter(x => x.evaluation.isDeleted)).toHaveLength(
        events.filter(x => x.isDeleted).length
      );
      expect(summary(data).category, key).toBe(key === 'all-void' ? null : 'C2');
    }
  });

  it('keeps review when two items swap clinical dimension with equal totals', () => {
    const swapped = items.map(x =>
      x.fieldId === '1' ? { ...x, typeId: 2 } : x.fieldId === '7' ? { ...x, typeId: 1 } : x
    );
    const data = report(archived([source('a'), source('b', { items: swapped })]));
    expect(summary(data)).toMatchObject({ ...REVIEW, count: 2 });
  });

  it('compares every archived version, not only the fullest one', () => {
    const swapped = items.map(x =>
      x.fieldId === '1' ? { ...x, typeId: 2 } : x.fieldId === '7' ? { ...x, typeId: 1 } : x
    );
    const events = [source('a'), source('a', { sourceVersion: 'v2', items: swapped }), source('b')];
    expect(summary(report(archived(events)))).toMatchObject({ ...REVIEW, count: 2 });
  });

  it('keeps review when archived versions identify two different authors', () => {
    const events = ['a', 'b'].flatMap(id => [
      source(id, {
        author: '',
        authorId: 'author-' + id,
        authorRoleId: '',
        authorRole: '',
        sourceVersion: 'v1',
      }),
      source(id, { author: '', authorId: '', sourceVersion: 'v2' }),
    ]);
    expect(summary(report(archived(events)))).toMatchObject({ ...REVIEW, count: 2 });
  });

  it('keeps review when no author is documented for either event', () => {
    const events = ['a', 'b'].map(id => source(id, { authorId: '', author: '' }));
    expect(summary(report(archived(events)))).toMatchObject({ ...REVIEW, count: 2 });
  });

  it('keeps review when the role is not documented for either event', () => {
    const events = ['a', 'b'].map(id => source(id, { authorRoleId: '', authorRole: '' }));
    expect(summary(report(archived(events)))).toMatchObject({ ...REVIEW, count: 2 });
  });
});
