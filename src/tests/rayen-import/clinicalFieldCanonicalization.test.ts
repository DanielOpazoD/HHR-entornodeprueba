import { describe, expect, it } from 'vitest';
import { buildClinicalPatientPatch } from '@/features/rayen-import/domain/clinicalPatientPatch';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const vital = (sourceEventId: string, heartRate: number): PatientVitalSigns => ({
  sourceEventId,
  recordedDate: '2026-07-10',
  recordedAt: `2026-07-10 0${sourceEventId}:00`,
  systolic: null,
  diastolic: null,
  heartRate,
  spo2: null,
  temperature: null,
  respiratoryRate: null,
  painEva: null,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: null,
  author: '',
  authorRole: '',
});

const score = (encounterEventId: number) => ({
  code: 'BRADEN' as const,
  name: 'Braden',
  encounterEventId,
  total: 17,
  severity: 'Riesgo bajo',
  recordedDate: '2026-07-10',
  recordedAt: `2026-07-10T08:00:0${encounterEventId}`,
});

describe('clinical field canonicalization', () => {
  it('ignores collection ordering without hiding a real clinical correction', () => {
    const olderVital = vital('1', 70);
    const newerVital = vital('2', 80);
    const patient = {
      devices: ['VVP', 'CUP'],
      vitalSigns: newerVital,
      vitalSignsHistory: [newerVital, olderVital],
      evaluationScores: { history: [score(2), score(1)] },
    } as unknown as PatientData;
    const reordered = {
      ...patient,
      devices: ['CUP', 'VVP'],
      vitalSignsHistory: [olderVital, newerVital],
      evaluationScores: { history: [score(1), score(2)] },
    } as unknown as PatientData;

    expect(buildClinicalPatientPatch(patient, reordered, 'H1C2', false).patch).toEqual({});

    const corrected = {
      ...reordered,
      vitalSigns: { ...newerVital, heartRate: 84 },
    } as PatientData;
    expect(buildClinicalPatientPatch(patient, corrected, 'H1C2', false).patch).toHaveProperty(
      'beds.H1C2.vitalSigns'
    );
  });
});
