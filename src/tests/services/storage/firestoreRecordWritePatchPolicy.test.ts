import { describe, expect, it } from 'vitest';
import { prepareFirestorePartialData } from '@/services/storage/firestore/firestoreRecordWritePatchPolicy';

describe('firestoreRecordWritePatchPolicy', () => {
  it('omits Rayen-owned fields from a manual clinical crib creation', () => {
    const result = prepareFirestorePartialData({
      partialData: {
        'beds.R1.clinicalCrib': {
          bedId: 'R1',
          bedMode: 'Cuna',
          patientName: 'RN de Paciente',
          devices: [],
          deviceDetails: { VVP: { installationDate: '2026-08-29' } },
          deviceInstanceHistory: [],
          evaluationScores: { braden: { total: 12 } },
          vitalSigns: { heartRate: 80 },
          vitalSignsHistory: [],
          clinicalSyncCheckpoint: { version: 1, sources: {} },
        },
        'beds.R1.hasCompanionCrib': false,
      },
      specialistScopedPatch: false,
      intentionalBedClear: undefined,
      clinicalCribCreate: true,
    });

    expect(result).toMatchObject({
      'beds.R1.clinicalCrib.bedId': 'R1',
      'beds.R1.clinicalCrib.bedMode': 'Cuna',
      'beds.R1.clinicalCrib.patientName': 'RN de Paciente',
      'beds.R1.hasCompanionCrib': false,
    });
    expect(
      Object.keys(result).filter(path =>
        [
          'devices',
          'deviceDetails',
          'deviceInstanceHistory',
          'evaluationScores',
          'vitalSigns',
          'vitalSignsHistory',
          'clinicalSyncCheckpoint',
        ].some(
          field =>
            path === `beds.R1.clinicalCrib.${field}` ||
            path.startsWith(`beds.R1.clinicalCrib.${field}.`)
        )
      )
    ).toEqual([]);
  });

  it('does not strip Rayen fields from unrelated patches', () => {
    const result = prepareFirestorePartialData({
      partialData: { 'beds.R1.devices': ['VVP'] },
      specialistScopedPatch: false,
      intentionalBedClear: undefined,
    });

    expect(result).toEqual({ 'beds.R1.devices': ['VVP'] });
  });

  it('also strips owned fields from object-shaped clinical crib creation patches', () => {
    const result = prepareFirestorePartialData({
      partialData: {
        beds: {
          R1: {
            clinicalCrib: {
              bedMode: 'Cuna',
              patientName: 'RN de Paciente',
              devices: [],
              deviceDetails: { VVP: { installationDate: '2026-08-29' } },
              vitalSigns: { heartRate: 80 },
            },
          },
        },
      },
      specialistScopedPatch: false,
      intentionalBedClear: undefined,
      clinicalCribCreate: true,
    });

    expect(result).toMatchObject({
      'beds.R1.clinicalCrib.bedMode': 'Cuna',
      'beds.R1.clinicalCrib.patientName': 'RN de Paciente',
    });
    expect(Object.keys(result).some(path => path.includes('clinicalCrib.devices'))).toBe(false);
    expect(Object.keys(result).some(path => path.includes('clinicalCrib.deviceDetails'))).toBe(
      false
    );
    expect(Object.keys(result).some(path => path.includes('clinicalCrib.vitalSigns'))).toBe(false);
  });

  it('preserves clinical fields when updating an existing crib root object', () => {
    const result = prepareFirestorePartialData({
      partialData: {
        'beds.R1.clinicalCrib': {
          bedMode: 'Cuna',
          patientName: 'RN vigente',
          devices: ['VVP'],
          vitalSigns: { heartRate: 80 },
        },
      },
      specialistScopedPatch: false,
      intentionalBedClear: undefined,
    });

    expect(result).toMatchObject({
      'beds.R1.clinicalCrib.devices': ['VVP'],
      'beds.R1.clinicalCrib.vitalSigns.heartRate': 80,
    });
  });
});
