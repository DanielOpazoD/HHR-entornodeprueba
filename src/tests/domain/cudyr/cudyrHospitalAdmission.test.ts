import { describe, expect, it } from 'vitest';
import { resolveCudyrHospitalAdmission } from '@/domain/cudyr/cudyrHospitalAdmission';
import { resolveCudyrDailyPlacement } from '@/domain/cudyr/cudyrDailyPlacement';
import { cudyrModality } from '@/domain/cudyr/cudyrStatisticalContext';
import { reportPlacement } from '../../services/cudyr/reportFixtures';
const observed = (bedId: string, start: string, end = '0001-01-01T00:00:00Z') => ({
  placement: reportPlacement({
    bedId,
    sourceBedLabel: bedId,
    sourceBedId: bedId,
    sourceMappingId: bedId,
    sourceStartAt: start,
    sourceEndAt: end,
  }),
  observedAt: '2026-10-08T15:00:00Z',
  censusDate: '2026-10-07',
  captureId: bedId,
});
const episode = 'synthetic-episode';
const reference = '2026-10-08T06:00:00Z';
const resolve = (history: ReturnType<typeof observed>[], eligibility = false) =>
  resolveCudyrHospitalAdmission(episode, history, reference, eligibility);
describe('first registered hospital bed entry', () => {
  it('uses the first hospital bed timestamp despite a different episode admission and no prior closures', () => {
    const first = observed('H1C1', '2026-10-07T16:17:30-05:00');
    const later = observed('H6C2', '2026-10-07T20:41:08-05:00');
    expect(resolve([later, first]).at).toBe(first.placement.sourceStartAt);
    const day = resolveCudyrDailyPlacement({
      date: '2026-10-07',
      patientName: 'Sintético',
      clinicalEpisodeId: episode,
      admissionDate: '2026-10-06',
      admissionTime: '14:17',
      placements: [{ bedId: 'H6C2' }],
      sourcePlacements: [{ ...first, observedAt: '2026-10-07T22:36:00Z' }, later],
    });
    expect(day.hospitalStayAdmissionAt).toBe(first.placement.sourceStartAt);
    expect(day.eligibility).toBe('elegible'); // 8h42 at 01:00, not 4h19 since the internal transfer.
  });
  it('accepts a single hospital assignment without requiring episode coincidence or a prior UEA end', () => {
    const uea = observed('BOX1', '2026-10-06T10:00:00-05:00');
    const first = observed('R1', '2026-10-07T18:00:00-05:00');
    expect(resolve([uea, first]).at).toBe(first.placement.sourceStartAt);
    expect(resolve([first]).at).toBe(first.placement.sourceStartAt);
    expect(resolve([uea, first], true).at).toBe(first.placement.sourceStartAt);
  });
  it('updates the first entry when an older hospital assignment is recovered', () => {
    const newer = observed('H6C2', '2026-10-07T20:00:00-05:00');
    const older = observed('R4', '2026-10-06T14:00:00-05:00');
    expect(resolve([newer]).at).toBe(newer.placement.sourceStartAt);
    expect(resolve([newer, older]).at).toBe(older.placement.sourceStartAt);
  });
  it.each(['BOX1', 'B2UEA', 'CMA R1 Hospitalizados', 'Cuna H1C1'])(
    'does not use %s as the hospital admission',
    bed => {
      const excluded = observed(bed, '2026-10-06T10:00:00-05:00');
      if (bed.startsWith('Cuna')) excluded.placement.modality = 'cuna';
      const first = observed('H1C1', '2026-10-07T12:00:00-05:00');
      expect(resolve([excluded, first]).at).toBe(first.placement.sourceStartAt);
    }
  );
  it('shows a newborn crib entry while keeping the case excluded from CUDYR', () => {
    const crib = observed('H2C2', '2026-10-06T17:22:10-05:00');
    crib.placement.modality = 'cuna';
    crib.placement.sourceBedLabel = 'CH2C2';
    expect(resolve([crib]).at).toBe(crib.placement.sourceStartAt);
    expect(resolve([crib]).source).toContain('cuna de Hospitalizados');
    expect(resolve([crib], true).at).toBe('');
    const day = resolveCudyrDailyPlacement({
      date: '2026-10-07',
      clinicalEpisodeId: episode,
      patientName: 'RN Sintético',
      placements: [{ bedId: 'H2C2', section: 'crib' }],
      sourcePlacements: [crib],
    });
    expect(day.eligibility).toBe('no_elegible');
    expect(day.modality).toBe('cuna');
  });
  it('preserves service entry in a crib but starts CUDYR hours at the later ordinary hospital bed', () => {
    const crib = observed('H2C2', '2026-10-06T17:22:10-05:00');
    crib.placement.modality = 'cuna';
    crib.placement.sourceBedLabel = 'CH2C2';
    const bed = observed('NEO1', '2026-10-07T20:00:00-05:00');
    expect(resolve([crib, bed]).at).toBe(crib.placement.sourceStartAt);
    expect(resolve([crib, bed], true).at).toBe(bed.placement.sourceStartAt);
  });
  it('does not use an Urgencias crib or a future crib entry as hospital service entry', () => {
    const crib = observed('H2C2', '2026-10-06T17:22:10-05:00');
    crib.placement.modality = 'cuna';
    crib.placement.sourceBedLabel = 'CH2C2';
    crib.placement.sourceDepartmentLabel = 'UEA';
    expect(resolve([crib]).at).toBe('');
    crib.placement.sourceVersion = 'eloisa-patient-flow-v1';
    expect(resolve([crib]).at).toBe('');
    crib.placement.sourceDepartmentLabel = 'Hospitalizados';
    crib.placement.sourceStartAt = '2026-10-08T10:00:00-05:00';
    expect(resolve([crib]).at).toBe('');
  });
  it('keeps the first entry visible while not counting a subsequent UEA stay toward eight hours', () => {
    const first = observed('R1', '2026-10-07T08:00:00-05:00', '2026-10-07T12:00:00-05:00');
    const uea = observed('BOX1', '2026-10-07T12:00:00-05:00', '2026-10-07T22:00:00-05:00');
    const back = observed('H1C1', '2026-10-07T22:00:00-05:00');
    expect(resolve([first, uea, back]).at).toBe(first.placement.sourceStartAt);
    expect(resolve([first, uea, back], true).at).toBe(back.placement.sourceStartAt);
  });
  it('does not bridge a documented gap for the eight-hour calculation', () => {
    const first = observed('R1', '2026-10-07T08:00:00-05:00', '2026-10-07T12:00:00-05:00');
    const back = observed('H1C1', '2026-10-07T22:00:00-05:00');
    expect(resolve([first, back], true).at).toBe(back.placement.sourceStartAt);
  });
  it('keeps the first entry visible but does not extend a closed final bed interval to the cutoff', () => {
    const closed = observed('R1', '2026-10-07T16:17:30-05:00', '2026-10-07T18:00:00-05:00');
    expect(resolve([closed]).at).toBe(closed.placement.sourceStartAt);
    expect(resolve([closed], true).at).toBe('');
    const day = resolveCudyrDailyPlacement({
      date: '2026-10-07',
      patientName: 'Sintético',
      clinicalEpisodeId: episode,
      admissionDate: '2026-10-06',
      admissionTime: '10:00',
      placements: [{ bedId: 'R1' }],
      sourcePlacements: [closed],
    });
    expect(day.eligibility).toBe('por_revisar');
  });
  it('does not project future assignments backwards or join another episode', () => {
    const future = observed('H1C1', '2026-10-08T10:00:00-05:00');
    const other = observed('R1', '2026-10-06T10:00:00-05:00');
    other.placement.clinicalEpisodeId = 'other';
    expect(resolve([future, other]).at).toBe('');
    expect(resolve([]).at).toBe('');
  });
  it('rejects annulled or contradictory entry timestamps and invalid captures', () => {
    const first = observed('R1', '2026-10-07T08:00:00-05:00');
    expect(
      resolve([first, { ...first, placement: { ...first.placement, isDeleted: true } }]).at
    ).toBe('');
    expect(
      resolve([
        first,
        { ...first, placement: { ...first.placement, sourceStartAt: '2026-10-07T09:00:00-05:00' } },
      ]).at
    ).toBe('');
    expect(resolve([{ ...first, observedAt: '2026-10-06T10:00:00Z' }]).at).toBe('');
  });
  it.each([
    ['17:00:00', 'elegible'],
    ['17:00:30', 'no_elegible'],
    ['17:00:00.001', 'no_elegible'],
  ] as const)(
    'preserves seconds and milliseconds at the eight-hour cutoff (%s)',
    (time, eligibility) => {
      const admission = observed('R1', '2026-10-07T' + time + '-05:00');
      const day = resolveCudyrDailyPlacement({
        date: '2026-10-07',
        patientName: 'Sintético',
        clinicalEpisodeId: episode,
        admissionDate: '2026-10-06',
        admissionTime: '10:00',
        placements: [{ bedId: 'R1' }],
        sourcePlacements: [admission],
      });
      expect(day.eligibility).toBe(eligibility);
    }
  );
  it('uses the 01:00 cutoff for stay evidence independently of an early evaluation', () => {
    const closed = observed('R1', '2026-10-07T16:17:30-05:00', '2026-10-07T22:00:00-05:00');
    const day = resolveCudyrDailyPlacement({
      date: '2026-10-07',
      evaluationAt: '2026-10-07T20:00:00-05:00',
      patientName: 'Sintético',
      clinicalEpisodeId: episode,
      admissionDate: '2026-10-06',
      admissionTime: '10:00',
      placements: [{ bedId: 'R1' }],
      sourcePlacements: [closed],
    });
    expect(day.eligibility).toBe('por_revisar');
  });
  it('does not reset the cutoff stay because of a bed change after 01:00', () => {
    const first = observed('R1', '2026-10-07T16:17:30-05:00', '2026-10-08T02:00:00-05:00');
    const later = observed('H1C1', '2026-10-08T02:00:00-05:00');
    later.observedAt = '2026-10-08T15:00:00Z';
    const day = resolveCudyrDailyPlacement({
      date: '2026-10-07',
      evaluationAt: '2026-10-08T03:00:00-05:00',
      patientName: 'Sintético',
      clinicalEpisodeId: episode,
      admissionDate: '2026-10-06',
      admissionTime: '10:00',
      placements: [{ bedId: 'H1C1' }],
      sourcePlacements: [first, later],
    });
    expect(day.hospitalStayAdmissionAt).toBe(first.placement.sourceStartAt);
    expect(day.eligibility).toBe('elegible');
  });
  it('accepts exactly eight hours through the cutoff, including an interval ending exactly there', () => {
    const complete = observed('R1', '2026-10-07T17:00:00-05:00', '2026-10-08T01:00:00-05:00');
    expect(resolve([complete], true).at).toBe(complete.placement.sourceStartAt);
  });
  it.each(['invalid', '2026-13-07T18:00:00-05:00', '0001-invalid'])(
    'keeps a valid first entry but reviews an invalid closure (%s)',
    end => {
      const invalid = observed('R1', '2026-10-07T16:17:30-05:00', end);
      expect(resolve([invalid]).at).toBe(invalid.placement.sourceStartAt);
      expect(resolve([invalid], true).at).toBe('');
    }
  );
  it('keeps generic episode time from substituting for a missing hospital assignment', () => {
    const day = resolveCudyrDailyPlacement({
      date: '2026-10-07',
      patientName: 'Sintético',
      clinicalEpisodeId: episode,
      admissionDate: '2026-10-06',
      admissionTime: '10:00',
      placements: [{ bedId: 'R1' }],
      sourcePlacements: [],
    });
    expect(day.eligibility).toBe('por_revisar');
  });
  it.each(['BOX1', 'BOX 2', 'B3UEA'])(
    'recognizes urgency in raw bed and department fields (%s)',
    label => {
      expect(cudyrModality({ bedId: 'R1', sourceBedId: label, modality: 'hospitalizacion' })).toBe(
        'uea'
      );
      expect(cudyrModality({ bedId: 'R1', location: label, modality: 'hospitalizacion' })).toBe(
        'uea'
      );
    }
  );
});
