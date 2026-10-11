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
  it('uses a reviewed crib correction but respects a later Eloísa hospital transfer', () => {
    const placements = [
      {
        bedId: 'NEO1',
        section: 'census' as const,
        bedMode: 'Cama' as const,
        neonatalPlacementDecision: {
          clinicalEpisodeId: 'episode',
          kind: 'independent' as const,
          bedId: 'NEO1',
          effectiveAt: '2026-10-02T14:00:00-05:00',
          reviewedAt: '2026-10-02T16:00:00-05:00',
          reviewedBy: 'Nurse',
          sourceService: 'Cirugía',
          sourcePlacementKey: 'H1C1:cuna',
        },
      },
    ];
    const crib = evidence('H1C1', 'cuna', '2026-10-01T10:00:00-05:00');
    crib.placement.sourceDepartmentLabel = 'Cirugía';
    const corrected = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-02',
      placements,
      sourcePlacements: [crib],
    });
    expect(corrected.eligibility).toBe('elegible');
    expect(corrected.contextSource).toBe('hhr_daily');
    for (const changes of [{ bedId: 'H2C2' }, { sourceDepartmentLabel: 'Otra área' }]) {
      const unaccepted = resolveCudyrDailyPlacement({
        ...input,
        date: '2026-10-02',
        placements,
        sourcePlacements: [{ ...crib, placement: { ...crib.placement, ...changes } }],
      });
      expect(unaccepted.contextSource).toBe('eloisa_interval');
      expect(unaccepted.eligibility).toBe('no_elegible');
    }
    const matching = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-04',
      placements,
      sourcePlacements: [
        {
          ...sourcePlacements[1],
          placement: { ...sourcePlacements[1].placement, sourceDepartmentLabel: 'Cirugía' },
        },
      ],
    });
    expect(matching.hospitalStayAdmissionAt).toBe('2026-10-02T14:00:00-05:00');
    const otherService = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-04',
      placements,
      sourcePlacements: [
        {
          ...sourcePlacements[1],
          placement: { ...sourcePlacements[1].placement, sourceDepartmentLabel: 'Otra área' },
        },
      ],
    });
    expect(otherService.contextSource).toBe('eloisa_interval');
    expect(otherService.contexts[0].location).toBe('Otra área');
    expect(otherService.hospitalStayAdmissionAt).toBe('2026-10-02T14:00:00-05:00');
    for (const label of ['Urgencias / UEA', 'CMA Pabellón']) {
      const excluded = resolveCudyrDailyPlacement({
        ...input,
        date: '2026-10-04',
        placements,
        sourcePlacements: [
          {
            ...sourcePlacements[1],
            placement: { ...sourcePlacements[1].placement, sourceDepartmentLabel: label },
          },
        ],
      });
      expect(excluded.eligibility).toBe('no_elegible');
      expect(excluded.contextSource).toBe('eloisa_interval');
    }
    const before = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-01',
      admissionDate: '2026-09-25',
      admissionTime: '12:00',
      useCensusAdmission: true,
      placements,
      sourcePlacements: [],
    });
    expect(before.eligibility).toBe('por_revisar');
    const transferred = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-04',
      placements,
      sourcePlacements: [evidence('R3', 'hospitalizacion', '2026-10-03T15:00:00-05:00')],
    });
    expect(transferred.contextSource).toBe('eloisa_interval');
    expect(transferred.hospitalStayAdmissionAt).toBe('2026-10-02T14:00:00-05:00');
    for (const prior of [
      evidence('BOX1', 'hospitalizacion', '2026-10-03T14:00:00-05:00', '2026-10-03T20:00:00-05:00'),
      evidence('NEO1', 'hospitalizacion', '2026-10-02T14:00:00-05:00', '2026-10-03T18:00:00-05:00'),
    ]) {
      const history = [prior, evidence('R3', 'hospitalizacion', '2026-10-03T20:00:00-05:00')];
      const original = JSON.stringify(history);
      const newStay = resolveCudyrDailyPlacement({
        ...input,
        date: '2026-10-03',
        placements,
        sourcePlacements: history,
      });
      expect(newStay.hospitalStayAdmissionAt).toBe('2026-10-03T20:00:00-05:00');
      expect(newStay.eligibility).toBe('no_elegible');
      expect(JSON.stringify(history)).toBe(original);
    }
    expect(transferred.reason).not.toContain('Ubicación RN confirmada');
    const conflict = resolveCudyrDailyPlacement({
      ...input,
      date: '2026-10-04',
      placements,
      sourcePlacements: [crib, ...sourcePlacements],
    });
    expect(conflict.eligibility).toBe('por_revisar');
  });

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
