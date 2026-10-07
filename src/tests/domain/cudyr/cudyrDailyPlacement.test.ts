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
  it('keeps crib days excluded, flags the transition hours and then uses the new media bed', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map(date =>
      resolveCudyrDailyPlacement({ ...input, date })
    );
    expect(days.map(day => day.eligibility)).toEqual([
      'no_elegible',
      'no_elegible',
      'por_revisar',
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
