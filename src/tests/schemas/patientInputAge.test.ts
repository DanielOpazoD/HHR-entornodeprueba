import { describe, expect, it } from 'vitest';
import { PatientInputSchema } from '@/schemas/inputSchemas';

const patient = (age: string) => ({
  patientName: 'Paciente prueba',
  rut: '',
  age,
  birthDate: '',
});

describe('PatientInputSchema pediatric age', () => {
  it.each(['0d', '20d', '2m 5d', '6m', '23m', '24m', '1560m', '2a 3m', '3a 11m', '4', '130a'])(
    'accepts the clinical age format %s',
    age => {
      expect(PatientInputSchema.safeParse(patient(age)).success).toBe(true);
    }
  );

  it.each([
    '2 meses',
    '2m + 5d',
    '2a 3m 1d',
    '0m',
    '1561m',
    '0m 5d',
    '6m 2d',
    '3m 32d',
    '1a 2m',
    '2a 12m',
    '2a 99m',
    '4a 2m',
    '131',
    '131a',
    '99999999',
  ])('rejects unsupported or out-of-range age %s', age => {
    expect(PatientInputSchema.safeParse(patient(age)).success).toBe(false);
  });
});
