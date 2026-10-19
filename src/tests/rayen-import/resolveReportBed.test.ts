import { describe, expect, it } from 'vitest';
import { resolveReportBedId } from '@/features/rayen-import/mapping/resolveReportBed';

describe('resolveReportBedId Urgencias boxes', () => {
  it.each([
    ['B3UEA', 'BOX3'],
    ['BOX 3 UEA', 'BOX3'],
  ])('maps %s to %s', (label, expected) => {
    expect(resolveReportBedId(label)).toBe(expected);
  });
});

describe('report crib labels', () => {
  it.each(['Cuna H2C2', 'C-H2C2', 'CH2C2'])('resolves %s to its parent bed', label => {
    expect(resolveReportBedId(label)).toBe('H2C2');
  });
  it('preserves unknown crib labels', () => {
    expect(resolveReportBedId('Cuna desconocida')).toBe('Cuna desconocida');
  });
});
