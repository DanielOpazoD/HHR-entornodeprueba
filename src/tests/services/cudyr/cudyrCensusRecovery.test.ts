import { describe, it, expect } from 'vitest';
import { createCudyrRecoveredRow } from '@/services/cudyr/cudyrRecoveredRow';
import { applyCudyrCensusContinuity } from '@/services/cudyr/cudyrCensusContinuity';
import { applyCudyrFirstNightRecovery } from '@/services/cudyr/cudyrFirstNightRecovery';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
const row = (date: string) => ({
  ...createCudyrRecoveredRow(date, 'Paciente Ejemplo', '11111111-1'),
  clinicalEpisodeId: '123',
  contextSource: 'hhr_daily',
  bedId: 'R1',
  bedName: 'R1',
  modality: 'hospitalizacion' as const,
  group: 'intermedia' as const,
  admissionDate: '2026-09-16',
  admissionTime: '10:00',
  hospitalAdmissionAt: '2026-09-16T10:00:00-05:00',
  hospitalStayAdmissionAt: '2026-09-16T10:00:00-05:00',
  eligibility: 'elegible' as const,
});
const dataset = (rows: ReturnType<typeof row>[]) =>
  ({
    schemaVersion: 1,
    from: '2026-09-01',
    to: '2026-09-30',
    generatedAt: '2026-10-09T12:00:00Z',
    rows,
    exclusions: [],
    coverage: [17, 18, 19].map(day => ({
      date: `2026-09-${day}`,
      state: 'sin_censo',
      lastSyncedAt: '',
      runId: '',
    })),
    issues: [],
    observations: [],
    captures: [],
    corrections: [],
    dischargeAudit: [],
  }) as CudyrReportDataset;
describe('bounded historical census recovery', () => {
  it('restores only missing context between same-episode same-bed observations and clears scores', () => {
    const before = {
      ...row('2026-09-16'),
      evaluation: {
        category: 'C2' as const,
        source: 'Eloísa',
        recordedAt: '',
        author: '',
        authorId: '',
        authorRole: '',
        sourceEvaluationId: '',
      },
      evaluationCount: 1,
    };
    const result = applyCudyrCensusContinuity(dataset([before, row('2026-09-20')]));
    const restored = result.rows.filter(r => r.contextSource === 'hhr_census_continuity');
    expect(restored.map(r => r.date)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19']);
    expect(restored.every(r => r.evaluation === null && !r.monthlyEvidence)).toBe(true);
  });
  it('does not insert a patient into a complete census unless that date was documentarily reconstructed', () => {
    const d = dataset([row('2026-09-16'), row('2026-09-20')]);
    d.coverage = d.coverage.map(day => ({ ...day, state: 'disponible' }));
    expect(applyCudyrCensusContinuity(d).rows).toHaveLength(2);
    expect(applyCudyrCensusContinuity(d, new Set(['2026-09-18'])).rows).toHaveLength(3);
  });
  it.each([true, false])('does not bridge a resolved departure on either endpoint (%s)', before => {
    const d = dataset([row('2026-09-16'), row('2026-09-20')]);
    d.rows[before ? 0 : 1].resolvedSystemDeparture = true;
    expect(applyCudyrCensusContinuity(d).rows).toHaveLength(2);
  });
  it.each([0, 1])('does not bridge a manual actual discharge on endpoint %s', endpoint => {
    const d = dataset([row('2026-09-16'), row('2026-09-20')]);
    d.rows[endpoint].correction = { actualDischarge: { date: '2026-09-18', time: '12:00' } } as any;
    expect(applyCudyrCensusContinuity(d).rows).toHaveLength(2);
  });
  it('does not bridge different beds, resolved departures, or daily manual exceptions', () => {
    expect(
      applyCudyrCensusContinuity(
        dataset([row('2026-09-16'), { ...row('2026-09-20'), bedId: 'H1C1' }])
      ).rows
    ).toHaveLength(2);
    expect(
      applyCudyrCensusContinuity(
        dataset([{ ...row('2026-09-16'), resolvedSystemDeparture: true }, row('2026-09-20')])
      ).rows
    ).toHaveLength(2);
    const d = dataset([row('2026-09-16'), row('2026-09-20')]);
    d.exclusions = [
      { date: '2026-09-18', clinicalEpisodeId: '123' },
    ] as CudyrReportDataset['exclusions'];
    expect(applyCudyrCensusContinuity(d).rows.some(r => r.date === '2026-09-18')).toBe(false);
  });
  it.each(['', '2026-09-20T09:00:00-05:00'])(
    'does not bridge an unknown or interrupted stay despite identical first admission: %s',
    hospitalStayAdmissionAt => {
      const d = dataset([row('2026-09-16'), { ...row('2026-09-20'), hospitalStayAdmissionAt }]);
      expect(applyCudyrCensusContinuity(d).rows).toHaveLength(2);
    }
  );
  it.each(['2026-09-16T18:00:00-05:00', '2026-09-16T09:00:00-05:00'])(
    'counts only the ordinary hospital segment, preserving earlier crib entry %s',
    hospitalAdmissionAt => {
      const context = {
        ...row('2026-09-17'),
        admissionTime: '18:00',
        hospitalAdmissionAt,
        hospitalStayAdmissionAt: '2026-09-16T18:00:00-05:00',
      };
      const source = {
        ...createCudyrRecoveredRow('2026-09-16', 'Paciente Ejemplo', '11111111-1'),
        contextSource: 'eloisa_monthly_report',
        evaluation: {
          category: 'C2' as const,
          source: 'Eloísa',
          recordedAt: '',
          author: '',
          authorId: '',
          authorRole: '',
          sourceEvaluationId: '',
        },
        evaluationCount: 1,
        monthlyEvidence: {
          reportId: 'report',
          sourceDate: '2026-09-17',
          checkedAt: '2026-10-01T12:00:00Z',
          state: 'found' as const,
        },
      };
      const d = dataset([context]);
      d.rows.push(source);
      const result = applyCudyrFirstNightRecovery(d, []);
      const first = result.rows.find(r => r.date === '2026-09-16')!;
      expect(first.eligibility).toBe('no_elegible');
      expect(first.evaluation?.category).toBe('C2');
      expect(first.cudyrStatus).toBe('registrado');
    }
  );
  it('links an early next-calendar-day admission to the preceding night without making it eligible', () => {
    const d = dataset([
      {
        ...row('2026-09-17'),
        admissionDate: '2026-09-17',
        admissionTime: '02:00',
        hospitalAdmissionAt: '2026-09-17T02:00:00-05:00',
        hospitalStayAdmissionAt: '2026-09-17T02:00:00-05:00',
      },
    ]);
    d.rows.push({
      ...createCudyrRecoveredRow('2026-09-16', 'Paciente Ejemplo', '11111111-1'),
      contextSource: 'eloisa_monthly_report',
      evaluation: {
        category: 'C2',
        source: 'Eloísa',
        recordedAt: '',
        author: '',
        authorId: '',
        authorRole: '',
        sourceEvaluationId: '',
      },
      monthlyEvidence: {
        reportId: 'report',
        sourceDate: '2026-09-17',
        checkedAt: '',
        state: 'found',
      },
    });
    const first = applyCudyrFirstNightRecovery(d, []).rows.find(r => r.date === '2026-09-16')!;
    expect(first.contextSource).toBe('hhr_first_night_recovery');
    expect(first.clinicalEpisodeId).toBe('123');
    expect(first.eligibility).toBe('no_elegible');
    expect(first.evaluation?.category).toBe('C2');
  });
  it.each([
    'conflict',
    'duplicate',
    'missing document',
    'unresolved context',
    'bed transition',
  ] as const)('keeps ambiguous %s monthly rows unlinked', kind => {
    const d = dataset([row('2026-09-17')]);
    const source = {
      ...createCudyrRecoveredRow('2026-09-16', 'Paciente Ejemplo', '11111111-1'),
      contextSource: 'eloisa_monthly_report',
      evaluation: {
        category: 'C2',
        source: 'Eloísa',
        recordedAt: '',
        author: '',
        authorId: '',
        authorRole: '',
        sourceEvaluationId: '',
      },
      monthlyEvidence: {
        reportId: 'report',
        sourceDate: '2026-09-17',
        checkedAt: '',
        state: kind === 'conflict' ? 'conflict' : 'found',
      },
    } as CudyrReportDataset['rows'][number];
    if (kind === 'missing document') {
      source.rut = '';
      d.rows[0].rut = '';
    }
    if (kind === 'unresolved context') d.rows[0].eligibility = 'por_revisar';
    if (kind === 'bed transition')
      d.rows[0].bedHistory = [
        { bed: 'H1C1', status: 'finalizada', modality: 'hospitalizacion' },
      ] as any;
    d.rows.push(source);
    if (kind === 'duplicate') d.rows.push({ ...source, key: 'second-source-row' });
    const result = applyCudyrFirstNightRecovery(d, []);
    expect(result.rows).toHaveLength(d.rows.length);
    expect(result.rows.some(r => r.contextSource === 'hhr_first_night_recovery')).toBe(false);
  });
  it('does not borrow next-day capture metadata and respects a departure before the recovered reference', () => {
    const context = {
      ...row('2026-09-17'),
      captureId: 'next-day-capture',
      evaluationCapturedAt: '2026-09-18T04:00:00-05:00',
      correction: {
        actualDischarge: { date: '2026-09-16', time: '23:00', timeZone: 'Pacific/Easter' },
      } as any,
    };
    const source = {
      ...createCudyrRecoveredRow('2026-09-16', 'Paciente Ejemplo', '11111111-1'),
      contextSource: 'eloisa_monthly_report',
      evaluation: {
        category: 'C2',
        source: 'Eloísa',
        recordedAt: '',
        author: '',
        authorId: '',
        authorRole: '',
        sourceEvaluationId: '',
      },
      monthlyEvidence: {
        reportId: 'report',
        sourceDate: '2026-09-17',
        checkedAt: '',
        state: 'found' as const,
      },
    };
    const d = dataset([context]);
    d.rows.push(source);
    const first = applyCudyrFirstNightRecovery(d, []).rows.find(r => r.date === '2026-09-16')!;
    expect(first.eligibility).toBe('no_elegible');
    expect(first.captureId).toBe('');
    expect(first.evaluationCapturedAt).toBeUndefined();
    expect(first.evaluation?.category).toBe('C2');
    context.correction = undefined as any;
    context.movements = [{ section: 'discharges', date: '2026-09-17', time: '00:30' }] as any;
    const resolved = dataset([context]);
    resolved.rows.push(source);
    const hidden = applyCudyrFirstNightRecovery(resolved, []).rows.find(
      r => r.date === '2026-09-16'
    )!;
    expect(hidden.resolvedSystemDeparture).toBe(true);
    expect(hidden.eligibility).toBe('no_elegible');
  });
  it('holds first-night recovery if the admission day differs or multiple episodes share identity', () => {
    const source = {
      ...createCudyrRecoveredRow('2026-09-16', 'Paciente Ejemplo', '11111111-1'),
      contextSource: 'eloisa_monthly_report',
      evaluation: {
        category: 'C2' as const,
        source: 'Eloísa',
        recordedAt: '',
        author: '',
        authorId: '',
        authorRole: '',
        sourceEvaluationId: '',
      },
      monthlyEvidence: {
        reportId: 'report',
        sourceDate: '2026-09-17',
        checkedAt: '',
        state: 'found' as const,
      },
    };
    const d = dataset([{ ...row('2026-09-17'), admissionDate: '2026-09-15' }]);
    d.rows.push(source);
    expect(applyCudyrFirstNightRecovery(d, []).rows.at(-1)?.contextSource).toBe(
      'eloisa_monthly_report'
    );
    const ambiguous = dataset([
      row('2026-09-17'),
      { ...row('2026-09-18'), clinicalEpisodeId: '456' },
    ]);
    ambiguous.rows.push(source);
    expect(applyCudyrFirstNightRecovery(ambiguous, []).rows.at(-1)?.contextSource).toBe(
      'eloisa_monthly_report'
    );
  });
});
