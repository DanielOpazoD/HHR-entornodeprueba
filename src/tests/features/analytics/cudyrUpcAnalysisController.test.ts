import { describe, expect, it } from 'vitest';

import {
  buildCudyrUpcAnalysis,
  resolveAnalyticsUpcClassification,
} from '@/features/analytics/controllers/cudyrUpcAnalysisController';
import { resolveCudyrCareLevel } from '@/features/analytics/controllers/cudyrCareLevelController';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import type { PatientData } from '@/types/domain/patient';
import type { CudyrScore } from '@/types/domain/cudyr';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const createCudyrScore = (risk: 'A' | 'B' | 'C' | 'D', dependency: '1' | '2' | '3'): CudyrScore => {
  const distribute = (total: number, fields: number): number[] =>
    Array.from({ length: fields }, (_, index) => Math.max(0, Math.min(3, total - index * 3)));
  const dependencyValues = distribute(dependency === '1' ? 13 : dependency === '2' ? 7 : 1, 6);
  const riskValues = distribute(risk === 'A' ? 19 : risk === 'B' ? 12 : risk === 'C' ? 6 : 1, 8);

  return {
    changeClothes: dependencyValues[0],
    mobilization: dependencyValues[1],
    feeding: dependencyValues[2],
    elimination: dependencyValues[3],
    psychosocial: dependencyValues[4],
    surveillance: dependencyValues[5],
    vitalSigns: riskValues[0],
    fluidBalance: riskValues[1],
    oxygenTherapy: riskValues[2],
    airway: riskValues[3],
    proInterventions: riskValues[4],
    skinCare: riskValues[5],
    pharmacology: riskValues[6],
    invasiveElements: riskValues[7],
  };
};

const createPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: `Paciente ${bedId}`,
  rut: '',
  age: '50',
  pathology: 'Diagnóstico de prueba',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-03-09',
  admissionTime: '10:00',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const createRecord = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-03-10',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
});

describe('cudyrUpcAnalysisController', () => {
  it('maps every CUDYR category to the requested care level', () => {
    expect(['A1', 'A2', 'A3', 'B1', 'B2'].map(resolveCudyrCareLevel)).toEqual(
      Array(5).fill('CRITICAL')
    );
    expect(['B3', 'C1', 'C2'].map(resolveCudyrCareLevel)).toEqual(Array(3).fill('MEDIUM'));
    expect(['C3', 'D1', 'D2', 'D3'].map(resolveCudyrCareLevel)).toEqual(Array(4).fill('BASIC'));
    expect(resolveCudyrCareLevel('')).toBeNull();
  });

  it('prefers structured UTI/UCI classification and preserves legacy UPC separately', () => {
    expect(
      resolveAnalyticsUpcClassification(
        createPatient('R1', {
          isUPC: true,
          upcChecklist: {
            uciCriteria: [],
            utiCriteria: ['uti_mon_cardiaca'],
            classification: 'UPC_UTI',
            evaluatedAt: '2026-03-10T02:00:00.000Z',
          },
        })
      )
    ).toBe('UPC_UTI');

    expect(resolveAnalyticsUpcClassification(createPatient('R2', { isUPC: true }))).toBe(
      'UPC_LEGACY'
    );
    expect(resolveAnalyticsUpcClassification(createPatient('R3'))).toBeNull();
  });

  it('separates physical bed use from clinical UPC criteria and CUDYR complexity', () => {
    const analysis = buildCudyrUpcAnalysis([
      createRecord({
        H1C1: createPatient('H1C1', { cudyr: createCudyrScore('A', '1') }),
        H1C2: createPatient('H1C2', {
          isUPC: true,
          cudyr: createCudyrScore('D', '3'),
          upcChecklist: {
            uciCriteria: ['uci_vmi'],
            utiCriteria: [],
            classification: 'UPC_UCI',
            evaluatedAt: '2026-03-10T02:00:00.000Z',
          },
        }),
        H2C1: createPatient('H2C1'),
        R1: createPatient('R1', { cudyr: createCudyrScore('B', '2') }),
        R2: createPatient('R2', {
          isUPC: true,
          cudyr: createCudyrScore('A', '2'),
          upcChecklist: {
            uciCriteria: [],
            utiCriteria: ['uti_mon_cardiaca'],
            classification: 'UPC_UTI',
            evaluatedAt: '2026-03-10T02:00:00.000Z',
          },
        }),
        R3: createPatient('R3', {
          isUPC: true,
          cudyr: createCudyrScore('A', '1'),
          upcChecklist: {
            uciCriteria: ['uci_vasoactivos'],
            utiCriteria: [],
            classification: 'UPC_UCI',
            evaluatedAt: '2026-03-10T02:00:00.000Z',
          },
        }),
        R4: createPatient('R4', {
          isUPC: true,
          cudyr: createCudyrScore('D', '3'),
        }),
        NEO1: createPatient('NEO1', {
          isUPC: true,
          cudyr: createCudyrScore('B', '1'),
          upcChecklist: {
            uciCriteria: [],
            utiCriteria: ['uti_mon_respiratoria'],
            classification: 'UPC_UTI',
            evaluatedAt: '2026-03-10T02:00:00.000Z',
          },
        }),
        NEO2: createPatient('NEO2', { cudyr: createCudyrScore('C', '3') }),
      }),
    ]);

    expect(analysis).toMatchObject({
      eligibleObservations: 9,
      categorizedObservations: 8,
      coveragePercent: 88.9,
      adultPotentialOccupied: 4,
      adultPotentialWithCriteria: 2,
      adultPotentialWithoutCriteria: 1,
      adultPotentialLegacy: 1,
      adultPotentialWithUpc: 3,
      adultCriteriaPercent: 50,
      adultUpcPercent: 75,
      neonatalOccupied: 2,
      neonatalWithCriteria: 1,
      neonatalWithoutCriteria: 1,
      basicOccupied: 3,
      upcWithCriteria: 3,
      upcObserved: 4,
      upcUti: 3,
      upcUci: 1,
      upcLegacy: 1,
      upcAssumedUti: 1,
      upcOutsideEligibleBeds: 1,
      nonUpcCareLevels: {
        eligibleObservations: 5,
        categorizedObservations: 4,
        missingCudyr: 1,
        critical: 2,
        medium: 0,
        basic: 2,
        criticalPercent: 50,
        mediumPercent: 0,
        basicPercent: 50,
      },
      upcCareLevelsByClinicalCriteria: [
        {
          key: 'upc_uci',
          eligibleObservations: 1,
          categorizedObservations: 1,
          critical: 1,
          medium: 0,
          basic: 0,
          criticalPercent: 100,
        },
        {
          key: 'upc_uti',
          eligibleObservations: 2,
          categorizedObservations: 2,
          critical: 2,
          medium: 0,
          basic: 0,
          criticalPercent: 100,
        },
        {
          key: 'upc_legacy',
          eligibleObservations: 1,
          categorizedObservations: 1,
          critical: 0,
          medium: 0,
          basic: 1,
          basicPercent: 100,
        },
      ],
    });

    expect(analysis.nonUpcCareLevelsByBedGroup).toMatchObject([
      {
        key: 'basic',
        eligibleObservations: 3,
        categorizedObservations: 2,
        missingCudyr: 1,
        criticalPercent: 50,
        basicPercent: 50,
      },
      {
        key: 'adult_potential',
        eligibleObservations: 1,
        categorizedObservations: 1,
        criticalPercent: 100,
      },
      {
        key: 'neonatal',
        eligibleObservations: 1,
        categorizedObservations: 1,
        basicPercent: 100,
      },
    ]);

    expect(
      analysis.cohorts.find(cohort => cohort.key === 'adult_potential_without_upc')
    ).toMatchObject({
      categorizedObservations: 1,
      critical: 1,
      medium: 0,
      basic: 0,
    });
    expect(analysis.cohorts.find(cohort => cohort.key === 'upc_uti')).toMatchObject({
      categorizedObservations: 2,
      critical: 2,
      medium: 0,
      basic: 0,
    });
    expect(analysis.daily[0]).toMatchObject({
      adultPotentialOccupied: 4,
      adultPotentialWithCriteria: 2,
      adultPotentialWithUpc: 3,
      adultPotentialWithoutCriteria: 1,
      neonatalOccupied: 2,
      neonatalWithCriteria: 1,
      upcUti: 3,
      upcUci: 1,
    });
  });

  it('excludes UPC observations with neither name nor document while retaining RUT-only records', () => {
    const analysis = buildCudyrUpcAnalysis([
      createRecord({
        R1: createPatient('R1', {
          patientName: '',
          rut: '',
          isUPC: true,
          cudyr: createCudyrScore('A', '1'),
        }),
        R2: createPatient('R2', {
          patientName: '',
          rut: '14.747.062-2',
          isUPC: true,
          cudyr: createCudyrScore('B', '3'),
        }),
        R3: createPatient('R3', {
          patientName: '',
          rut: '',
          isUPC: true,
          isBlocked: true,
        }),
        R4: createPatient('R4', {
          patientName: '',
          rut: '',
          isUPC: true,
          admissionDate: '',
        }),
      }),
    ]);

    expect(analysis).toMatchObject({
      excludedUnidentifiedObservations: 1,
      eligibleObservations: 1,
      adultPotentialOccupied: 1,
      adultPotentialLegacy: 1,
      adultPotentialWithUpc: 1,
      upcObserved: 1,
    });
  });

  it('includes post-cutoff historical UPC in the UPC total without inferring UTI', () => {
    const historicalRecord = createRecord({
      R1: createPatient('R1', { isUPC: true, cudyr: createCudyrScore('C', '1') }),
    });
    historicalRecord.date = '2026-06-01';

    const analysis = buildCudyrUpcAnalysis([historicalRecord]);

    expect(analysis).toMatchObject({
      adultPotentialOccupied: 1,
      adultPotentialWithCriteria: 0,
      adultPotentialLegacy: 1,
      adultPotentialWithUpc: 1,
      adultPotentialWithoutCriteria: 0,
      upcWithCriteria: 0,
      upcObserved: 1,
      upcUti: 0,
      upcLegacy: 1,
      upcAssumedUti: 0,
    });
  });

  it('excludes late admissions that were not eligible for the nightly CUDYR measurement', () => {
    const analysis = buildCudyrUpcAnalysis([
      createRecord({
        R1: createPatient('R1', {
          admissionDate: '2026-03-10',
          admissionTime: '23:30',
          cudyr: createCudyrScore('A', '1'),
        }),
      }),
    ]);

    expect(analysis.eligibleObservations).toBe(0);
    expect(analysis.categorizedObservations).toBe(0);
    expect(analysis.adultPotentialOccupied).toBe(0);
  });
});
