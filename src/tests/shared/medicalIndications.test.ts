import { describe, expect, it } from 'vitest';
import {
  buildMedicalIndicationRecordId,
  buildMedicalIndicationsEpisodeId,
  calculateMedicalIndicationsStayDays,
  formatMedicalIndicationsDate,
  normalizeMedicalIndicationsDateKey,
  type MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';

describe('medicalIndications contracts', () => {
  const buildPatient = (
    overrides: Partial<MedicalIndicationsPatientOption> = {}
  ): MedicalIndicationsPatientOption => ({
    bedId: 'R1',
    label: 'R1 - Ana',
    patientName: 'Ana Test',
    rut: '11.111.111-1',
    diagnosis: '',
    age: '',
    birthDate: '',
    allergies: '',
    admissionDate: '2026-05-27',
    daysOfStay: '3',
    treatingDoctor: '',
    ...overrides,
  });

  it('normalizes clinical target dates without leaking UI date formats', () => {
    expect(normalizeMedicalIndicationsDateKey('29-05-2026')).toBe('2026-05-29');
    expect(normalizeMedicalIndicationsDateKey('29/05/2026')).toBe('2026-05-29');
    expect(formatMedicalIndicationsDate('2026-05-29')).toBe('29-05-2026');
  });

  it('calculates stay days against the target clinical date, including future days', () => {
    expect(calculateMedicalIndicationsStayDays('2026-05-27', '2026-05-29')).toBe('3');
    expect(calculateMedicalIndicationsStayDays('27-05-2026', '31-05-2026')).toBe('5');
  });

  it('prefers canonical episode ids and falls back to rut plus admission date', () => {
    expect(
      buildMedicalIndicationsEpisodeId({
        clinicalEpisodeId: 'ep_abc123',
        ...buildPatient(),
      })
    ).toBe('ep_abc123');

    expect(buildMedicalIndicationsEpisodeId(buildPatient())).toBe('11111111-1__2026-05-27');
  });

  it('builds deterministic legal record ids by episode and target day', () => {
    expect(
      buildMedicalIndicationRecordId({
        episodeId: 'ep_abc123',
        targetDate: '2026-05-31',
        generatedAt: '2026-05-29T10:42:00.000Z',
      })
    ).toBe('ep_abc123__2026-05-31__2026-05-29T10-42-00-000Z');
  });
});
