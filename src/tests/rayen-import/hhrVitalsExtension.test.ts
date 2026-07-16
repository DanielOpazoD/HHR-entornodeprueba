/**
 * Guards the extension's vital-signs pipeline (extension/hhr-vitals.js): the VITAL_SIGNS
 * form parser (field ids, comma decimals, archived forms, timezone rendering) and the
 * screening thresholds ported from HHR's vitalSignsView.
 */
import { describe, expect, it } from 'vitest';

import '../../../extension/hhr-vitals.js';

type VitalsApi = {
  parseVitalSigns: (raw: unknown) => Array<Record<string, unknown>>;
  statusFor: (
    metric: string,
    value: number | null,
    cohort?: 'adult' | 'pediatric' | 'unknown'
  ) => 'normal' | 'warn' | 'alert' | 'ungraded';
  ageCohort: (birthDate?: string, referenceDate?: Date) => 'adult' | 'pediatric' | 'unknown';
  VITAL_METRICS: Array<{ key: string; label: string }>;
};

const vitals = (globalThis as { HhrVitals?: VitalsApi }).HhrVitals as VitalsApi;

const buildForm = (
  campos: Array<{ id: string; value: string }>,
  overrides: Record<string, unknown> = {}
) => ({
  formCodigo: 'VITAL_SIGNS',
  encounterEventId: 100,
  startDateTime: '15-07-2026 10:00:00 -06:00',
  authorHealthCarePractitionerName: 'Camila Leiva',
  authorHealthCarePractitionerRoleName: 'Enfermera(o)',
  metaCampList: campos,
  ...overrides,
});

describe('extension vital signs parser', () => {
  it('parses a full VITAL_SIGNS form using the Rayen field ids', () => {
    const [record] = vitals.parseVitalSigns([
      buildForm([
        { id: 'global_PASSent', value: '130' },
        { id: 'global_PADSent', value: '82' },
        { id: 'global_Pulso', value: '84' },
        { id: 'exa_Fisic_G_SaturacionO2', value: '98' },
        { id: 'global_TempAxilar', value: '36,4' },
        { id: 'exa_Fisic_Frecuencia_Respiratoria', value: '18' },
        { id: 'global_EscalaDolorEVA', value: '3' },
        { id: 'global_Rexa_Hemoglucotest', value: '103' },
        { id: 'global_Observaciones', value: 'PAM 98' },
      ]),
    ]);
    expect(record).toMatchObject({
      systolic: 130,
      diastolic: 82,
      heartRate: 84,
      spo2: 98,
      temperature: 36.4,
      respiratoryRate: 18,
      painEva: 3,
      hgt: 103,
      observations: 'PAM 98',
      author: 'Camila Leiva',
    });
    expect(record.recordedDate).toBe('2026-07-15');
  });

  it('skips archived forms, non-vitals forms and forms without readings', () => {
    const records = vitals.parseVitalSigns([
      buildForm([{ id: 'global_PASSent', value: '120' }], { archived: true }),
      buildForm([{ id: 'global_PASSent', value: '118' }], { formCodigo: 'INSTRUMENTO' }),
      buildForm([{ id: 'global_Observaciones', value: 'solo texto' }]),
      buildForm([{ id: 'global_PASSent', value: '111' }], { encounterEventId: 7 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].systolic).toBe(111);
  });

  it('keeps glucose-only and insulin-only forms as history rows', () => {
    const records = vitals.parseVitalSigns([
      buildForm([{ id: 'global_Rexa_Hemoglucotest', value: '181' }], { encounterEventId: 2 }),
      buildForm(
        [
          { id: 'exam_Fis_Adm_InsulinaUIC', value: '4' },
          { id: 'exam_Fis_Adm_InsulinaSentCUAD', value: 'CSI' },
        ],
        { encounterEventId: 1 }
      ),
    ]);
    expect(records).toHaveLength(2);
    expect(records[0].hgt).toBe(181);
    expect(records[1].insulinUnits).toBe(4);
    expect(records[1].insulinQuadrant).toBe('CSI');
  });

  it('orders records most-recent-first by encounter event id and blanks stay null', () => {
    const records = vitals.parseVitalSigns([
      buildForm(
        [
          { id: 'global_PASSent', value: '100' },
          { id: 'global_Pulso', value: '' },
        ],
        {
          encounterEventId: 5,
        }
      ),
      buildForm([{ id: 'global_PASSent', value: '120' }], { encounterEventId: 9 }),
    ]);
    expect(records.map(record => record.systolic)).toEqual([120, 100]);
    expect(records[1].heartRate).toBeNull();
  });

  it('renders the clinical stamp in Rapa Nui local time (UTC naive stamp)', () => {
    const [record] = vitals.parseVitalSigns([
      buildForm([
        { id: 'global_PASSent', value: '120' },
        { id: 'SIGNS_FechaHora', value: '16-07-2026 13:00' },
      ]),
    ]);
    // 13:00 UTC → 07:00 Rapa Nui (−06:00 in July).
    expect(record.recordedAt).toBe('16-07-2026 07:00');
    expect(record.recordedDate).toBe('2026-07-16');
  });
});

describe('extension vital signs thresholds (HHR parity)', () => {
  it('grades systolic pressure', () => {
    expect(vitals.statusFor('systolic', 120)).toBe('normal');
    expect(vitals.statusFor('systolic', 95)).toBe('warn');
    expect(vitals.statusFor('systolic', 161)).toBe('warn');
    expect(vitals.statusFor('systolic', 90)).toBe('alert');
    expect(vitals.statusFor('systolic', 181)).toBe('alert');
  });

  it('grades heart rate, SpO2, temperature and respiratory rate', () => {
    expect(vitals.statusFor('heartRate', 101)).toBe('warn');
    expect(vitals.statusFor('heartRate', 130)).toBe('alert');
    expect(vitals.statusFor('spo2', 93)).toBe('warn');
    expect(vitals.statusFor('spo2', 89)).toBe('alert');
    expect(vitals.statusFor('temperature', 37.8)).toBe('warn');
    expect(vitals.statusFor('temperature', 39)).toBe('alert');
    expect(vitals.statusFor('respiratoryRate', 21)).toBe('warn');
    expect(vitals.statusFor('respiratoryRate', 8)).toBe('alert');
  });

  it('grades pain and glucose, and treats blanks/unknown metrics as normal', () => {
    expect(vitals.statusFor('painEva', 4)).toBe('warn');
    expect(vitals.statusFor('painEva', 7)).toBe('alert');
    expect(vitals.statusFor('hgt', 181)).toBe('warn');
    expect(vitals.statusFor('hgt', 54)).toBe('alert');
    expect(vitals.statusFor('hgt', 400)).toBe('alert');
    expect(vitals.statusFor('hgt', null)).toBe('normal');
    expect(vitals.statusFor('insulin', 99)).toBe('normal');
  });

  it('never applies adult thresholds to pediatric or unknown-age patients', () => {
    expect(vitals.statusFor('heartRate', 130, 'pediatric')).toBe('ungraded');
    expect(vitals.statusFor('spo2', 89, 'unknown')).toBe('ungraded');
    expect(vitals.ageCohort('2000-07-16', new Date(2026, 6, 16))).toBe('adult');
    expect(vitals.ageCohort('16-07-2000', new Date(2026, 6, 16))).toBe('adult');
    expect(vitals.ageCohort('2012-07-16', new Date(2026, 6, 16))).toBe('pediatric');
    expect(vitals.ageCohort('2008-07-16', new Date(2026, 6, 15))).toBe('pediatric');
    expect(vitals.ageCohort('2008-07-16', new Date(2026, 6, 16))).toBe('adult');
    expect(vitals.ageCohort('2012-02-30', new Date(2026, 6, 16))).toBe('unknown');
  });

  it('exposes the eight census metrics in HHR order', () => {
    expect(vitals.VITAL_METRICS.map(metric => metric.label)).toEqual([
      'PA',
      'FC',
      'SatO₂',
      'T°',
      'FR',
      'EVA',
      'HGT',
      'Ins/Cuad',
    ]);
  });
});
