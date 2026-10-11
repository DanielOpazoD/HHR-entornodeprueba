import { describe, expect, it } from 'vitest';
import {
  cudyrModality,
  cudyrStatisticalGroup,
  resolveCudyrDailyEligibility,
} from '@/domain/cudyr/cudyrStatisticalContext';

const day = (date: string, bedId: string, bedMode = 'Cama') => ({
  date,
  patientName: 'Paciente sintético',
  admissionDate: '2026-10-01',
  admissionTime: '09:00',
  placements: [{ bedId, bedMode }],
});

describe('daily statistical CUDYR context', () => {
  it.each([
    'NEO 1',
    'NEO2',
    ...Array.from({ length: 6 }, (_, index) => [`H${index + 1}C1`, `H${index + 1}C2`]).flat(),
  ])('keeps %s in medias', id => {
    expect(cudyrStatisticalGroup(id)).toBe('media');
  });
  it.each(['R1', 'R2', 'R3', 'R4'])('keeps %s in intermedias', id => {
    expect(cudyrStatisticalGroup(id)).toBe('intermedia');
  });
  it('does not infer a group from UPC or unknown physical beds', () => {
    expect(cudyrStatisticalGroup('UCI')).toBe('sin_grupo');
    expect(cudyrStatisticalGroup('E1')).toBe('sin_grupo');
  });
  it.each([
    'CMA R1',
    'CMAN1',
    'CMA Pabellón',
    'CMA Procedimientos',
    'Área quirúrgica indiferenciada / R2',
  ])('excludes any explicit CMA modality: %s', location => {
    expect(cudyrModality({ bedId: 'R2', location })).toBe('cma');
  });
  it('does not confuse the médico quirúrgica service or physical NEO bed with CMA/cuna', () => {
    expect(
      cudyrModality({ bedId: 'NEO1', location: 'Área Médico Quirúrgica Indiferenciada / NEO 1' })
    ).toBe('hospitalizacion');
  });
  it('preserves a newborn’s previous crib days after transfer to a media', () => {
    const first = resolveCudyrDailyEligibility(day('2026-10-01', 'H1C1', 'Cuna'));
    const second = resolveCudyrDailyEligibility(day('2026-10-02', 'H1C1', 'Cuna'));
    const third = resolveCudyrDailyEligibility(day('2026-10-03', 'NEO1'));
    expect([first.eligibility, second.eligibility, third.eligibility]).toEqual([
      'no_elegible',
      'no_elegible',
      'elegible',
    ]);
    expect(third.group).toBe('media');
  });
  it('requires review when simultaneous daily contexts imply different eligibility or grouping', () => {
    const input = day('2026-10-03', 'NEO1');
    expect(
      resolveCudyrDailyEligibility({
        ...input,
        placements: [...input.placements, { bedId: 'H1C1', bedMode: 'Cuna' }],
      }).eligibility
    ).toBe('por_revisar');
    expect(
      resolveCudyrDailyEligibility({ ...input, placements: [...input.placements, { bedId: 'R1' }] })
        .eligibility
    ).toBe('por_revisar');
  });
  it('requires review on an unresolved transition into hospitalization', () => {
    expect(
      resolveCudyrDailyEligibility({ ...day('2026-10-03', 'NEO1'), unresolvedTransition: true })
        .eligibility
    ).toBe('por_revisar');
  });
  it('retains the existing 8-hour rule without treating a missing admission time as known', () => {
    expect(
      resolveCudyrDailyEligibility({ ...day('2026-10-01', 'R1'), admissionTime: '17:01' })
        .eligibility
    ).toBe('no_elegible');
    expect(
      resolveCudyrDailyEligibility({ ...day('2026-10-01', 'R1'), admissionTime: '17:00' })
        .eligibility
    ).toBe('elegible');
    expect(
      resolveCudyrDailyEligibility({ ...day('2026-10-01', 'R1'), admissionTime: '' }).eligibility
    ).toBe('por_revisar');
  });
});
