import { describe, expect, it } from 'vitest';
import { formatClinicalAntecedentDate } from '@/features/census/components/patient-row/clinicalAntecedentDate';

describe('formatClinicalAntecedentDate', () => {
  it.each([
    ['20260926 15:53', '26-09-2026 15:53'],
    ['2026-09-26T15:53:20', '26-09-2026 15:53'],
    ['20260926', '26-09-2026'],
    ['2024-02-29', '29-02-2024'],
  ])('muestra %s como %s sin cambiar la hora local de origen', (raw, expected) => {
    expect(formatClinicalAntecedentDate(raw)).toBe(expected);
  });

  it.each(['20260230 15:53', '20260926 25:53', 'sin fecha', ''])(
    'conserva valores no interpretables: %s',
    raw => {
      expect(formatClinicalAntecedentDate(raw)).toBe(raw);
    }
  );
});
