import { describe, expect, it } from 'vitest';
import {
  cudyrReferenceInstant,
  resolveCudyrDailyPlacement,
} from '@/domain/cudyr/cudyrDailyPlacement';
import type { ObservedCudyrPlacement } from '@/domain/cudyr/cudyrPlacementTimeline';

const evidence = (
  bedId: string,
  modality: 'cuna' | 'hospitalizacion',
  start: string,
  end = ''
): ObservedCudyrPlacement => ({
  observedAt: '2026-10-05T15:00:00-05:00',
  censusDate: '2026-10-05',
  captureId: 'capture',
  placement: {
    clinicalEpisodeId: 'episode',
    sourceMappingId: bedId + modality,
    sourceBedId: bedId,
    sourceBedLabel: bedId,
    sourceDepartmentId: '',
    sourceDepartmentLabel: '',
    sourceVersion: 'opaque',
    sourceStartAt: start,
    sourceEndAt: end,
    currentAssignment: true,
    isDeleted: false,
    bedId,
    modality,
  },
});
const sourcePlacements = [
  evidence('H1C1', 'cuna', '2026-10-01T10:00:00-05:00', '2026-10-03T15:00:00-05:00'),
  evidence('NEO1', 'hospitalizacion', '2026-10-03T15:00:00-05:00'),
];
const input = {
  patientName: 'RN sintético',
  admissionDate: '2026-10-01',
  admissionTime: '10:00',
  clinicalEpisodeId: 'episode',
  placements: [{ bedId: 'NEO1' }],
  sourcePlacements,
};

describe('daily CUDYR context projection', () => {
  it.each([
    ['2026-10-05', '2026-10-06', '01:17', 'no_elegible'],
    ['2026-10-05', '2026-10-06', '07:59', 'no_elegible'],
    ['2026-10-05', '2026-10-06', '08:00', 'por_revisar'],
    ['2026-10-02', '2026-10-03', '08:59', 'no_elegible'],
    ['2026-10-02', '2026-10-03', '09:00', 'por_revisar'],
  ])(
    'recognizes night admissions through the real handoff: %s %s %s',
    (date, admissionDate, admissionTime, expected) => {
      const row = resolveCudyrDailyPlacement({
        ...input,
        date,
        admissionDate,
        admissionTime,
        sourcePlacements: [],
        useCensusAdmission: true,
      });
      expect(row.eligibility).toBe(expected);
      if (expected === 'no_elegible') expect(row.hospitalStayAdmissionAt).toBeTruthy();
    }
  );

  it.each([
    ['17:00', 'elegible'],
    ['17:01', 'no_elegible'],
    ['22:23', 'no_elegible'],
    ['', 'por_revisar'],
    ['25:00', 'por_revisar'],
  ])('evaluates daily HHR admission %s at the 01:00 cutoff', (time, eligibility) => {
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      admissionDate: '2026-10-02',
      admissionTime: time,
      sourcePlacements: [],
      useCensusAdmission: true,
    });
    expect(day.eligibility).toBe(eligibility);
  });
  it('does not use demographic admission to override a documented crib tranche', () => {
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      useCensusAdmission: true,
    });
    expect(day.modality).toBe('cuna');
    expect(day.eligibility).toBe('no_elegible');
  });
  it('does not override a closed hospital stay using demographic admission', () => {
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      useCensusAdmission: true,
      sourcePlacements: [
        evidence(
          'H1C1',
          'hospitalizacion',
          '2026-10-01T10:00:00-05:00',
          '2026-10-02T12:00:00-05:00'
        ),
      ],
    });
    expect(day.eligibility).toBe('por_revisar');
  });
  it('uses the older daily admission even if the only captured assignment starts later', () => {
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      useCensusAdmission: true,
      sourcePlacements: [evidence('H1C1', 'hospitalizacion', '2026-10-04T10:00:00-05:00')],
    });
    expect(day.eligibility).toBe('elegible');
    expect(day.hospitalStayAdmissionAt).toBe('2026-10-01T15:00:00.000Z');
  });
  it('uses the latest full descriptor once when older captures contain the abbreviated label', () => {
    const old = evidence('R2', 'hospitalizacion', '2026-10-01T10:00:00-05:00');
    const newer = {
      ...old,
      observedAt: '2026-10-06T15:00:00-05:00',
      placement: { ...old.placement, sourceBedLabel: 'R2 Hospitalizados' },
    };
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      sourcePlacements: [newer, old],
    });
    expect(day.contexts).toHaveLength(1);
    expect(day.contexts[0].bedName).toBe('R2 Hospitalizados');
    expect(day.sourceEvidence).toHaveLength(2);
  });
  it('does not roll an impossible date into a valid cutoff', () => {
    expect(cudyrReferenceInstant('2026-02-30')).toBeNull();
    expect(cudyrReferenceInstant('invalid')).toBeNull();
  });
  it('does not turn an explicitly unknown source modality into hospitalization from the bed name', () => {
    const unknown = evidence('R2', 'hospitalizacion', '2026-10-01T10:00:00-05:00');
    unknown.placement.modality = 'desconocida';
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      sourcePlacements: [unknown],
    });
    expect(day.eligibility).toBe('por_revisar');
  });
  it('resolves the fixed cutoff with the actual hospital timezone in summer and winter', () => {
    expect(cudyrReferenceInstant('2026-10-01')).toBe('2026-10-02T06:00:00.000Z');
    expect(cudyrReferenceInstant('2026-06-01')).toBe('2026-06-02T07:00:00.000Z');
  });
  it('keeps crib days excluded, uses confirmed hospital admission hours and then uses the new media bed', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map(date =>
      resolveCudyrDailyPlacement({ ...input, date })
    );
    expect(days.map(day => day.eligibility)).toEqual([
      'no_elegible',
      'no_elegible',
      'elegible', // Ten confirmed hours in the hospital service before the 01:00 cutoff.
      'elegible',
    ]);
    expect(days[3].group).toBe('media');
  });
  it('does not validate an evaluation from an excluded tranche using a later hospital bed', () => {
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-03',
      evaluationAt: '2026-10-03T14:00:00-05:00',
    });
    expect(day.modality).toBe('cuna');
    expect(day.eligibility).toBe('no_elegible');
  });
  it('keeps an intermedia historical assignment despite the current media context and UPC', () => {
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      sourcePlacements: [evidence('R2', 'hospitalizacion', '2026-10-01T10:00:00-05:00')],
    });
    expect(day.group).toBe('intermedia');
    expect(day.contextSource).toBe('eloisa_interval');
  });
  it('retains each daily HHR snapshot when source intervals are absent without projecting future days', () => {
    const day = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      sourcePlacements: [],
      placements: [{ bedId: 'H2C2', bedMode: 'Cuna' }],
    });
    expect(day.eligibility).toBe('no_elegible');
    expect(day.contextSource).toBe('hhr_daily');
  });
});

it('keeps blocked census patients under review even with an old hospital admission', () => {
  const result = resolveCudyrDailyPlacement({
    date: '2026-10-07',
    clinicalEpisodeId: 'synthetic-episode',
    patientName: 'Sintético',
    admissionDate: '2026-10-01',
    admissionTime: '10:00',
    isBlocked: true,
    useCensusAdmission: true,
    placements: [{ bedId: 'H1C1' }],
    sourcePlacements: [],
  });
  expect(result.eligibility).toBe('por_revisar');
  expect(result.reason).toContain('bloqueada');
});
