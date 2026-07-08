import { describe, expect, it } from 'vitest';

import { buildFallbackPatientData } from '@/schemas/zodFallbackBuilders';
import { hasStructuralRepairs } from '@/schemas/zodParseReports';
import { parseDailyRecordWithDefaultsReport, safeParseDailyRecord } from '@/schemas/zodSafeParsers';
import { validateAdmissionDate, validatePatientData } from '@/schemas/zodValidationHelpers';

describe('zod schema modules', () => {
  it('valida paciente correctamente desde helper modular', () => {
    const result = validatePatientData({
      bedId: 'a1',
      patientName: 'Juan',
      pathology: 'Dx',
      status: 'Estable',
    });
    expect(result.success).toBe(true);
  });

  it('construye fallback de paciente preservando cuna clinica', () => {
    const patient = buildFallbackPatientData(
      {
        patientName: 'RN',
        bedMode: 'Cuna',
        clinicalCrib: { patientName: 'Bebe' },
      },
      'a1'
    );
    expect(patient.patientName).toBe('RN');
    expect(patient.bedMode).toBe('Cuna');
    expect(patient.clinicalCrib?.patientName).toBe('Bebe');
  });

  it('construye fallback de paciente preservando CUDYR valido', () => {
    const patient = buildFallbackPatientData(
      {
        patientName: 'Paciente CUDYR',
        bedMode: 'Adulto',
        cudyr: {
          changeClothes: 2,
          mobilization: 3,
          feeding: 0,
          elimination: 0,
          psychosocial: 0,
          surveillance: 0,
          vitalSigns: 1,
          fluidBalance: 0,
          oxygenTherapy: 0,
          airway: 0,
          proInterventions: 0,
          skinCare: 0,
          pharmacology: 0,
          invasiveElements: 0,
        },
      },
      'R1'
    );

    expect(patient.cudyr).toMatchObject({
      changeClothes: 2,
      mobilization: 3,
      vitalSigns: 1,
    });
  });

  it('reporta reparaciones estructurales y recupera DailyRecord', () => {
    const parsed = parseDailyRecordWithDefaultsReport(
      {
        beds: {
          a1: { patientName: 'Juan', bedMode: 'Cama' },
        },
        discharges: [{ broken: true }],
      },
      '2026-03-10'
    );

    expect(parsed.record.date).toBe('2026-03-10');
    expect(hasStructuralRepairs(parsed.report)).toBe(true);
  });

  it('safeParseDailyRecord retorna null cuando la estructura es invalida', () => {
    expect(safeParseDailyRecord('invalid')).toBeNull();
  });

  it('valida fecha de ingreso futura como invalida', () => {
    const result = validateAdmissionDate('2999-01-01');
    expect(result.success).toBe(false);
  });
});
