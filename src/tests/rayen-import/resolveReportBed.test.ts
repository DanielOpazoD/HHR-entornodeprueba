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
