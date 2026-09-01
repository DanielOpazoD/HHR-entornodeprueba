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

  it('los objetos de autoridad clínica viajan atómicos, sin aplanarse en sub-rutas', () => {
    // Verificado en vivo (31-08): aplanar upcChecklist en rutas de 4 segmentos
    // hacía que dejaran de clasificar como clínicas y la separación de
    // autoridades rechazaba la clasificación UPC completa.
    const checklist = {
      uciCriteria: ['uci_vmi'],
      utiCriteria: [],
      classification: 'UPC_UCI',
      evaluatedAt: '2026-08-31T00:00:00Z',
      evaluatedBy: { uid: 'u1', displayName: 'Dra. Prueba' },
    };
    const result = prepareFirestorePartialData({
      partialData: {
        'beds.R3.upcChecklist': checklist,
        'beds.R3.isUPC': true,
        'bedTypeOverrides.R3': 'UCI',
        dateTimestamp: 123,
      },
      specialistScopedPatch: false,
      intentionalBedClear: undefined,
    });

    expect(result['beds.R3.upcChecklist']).toEqual(checklist);
    expect(result['beds.R3.isUPC']).toBe(true);
    expect(result['bedTypeOverrides.R3']).toBe('UCI');
    expect(Object.keys(result).filter(path => path.startsWith('beds.R3.upcChecklist.'))).toEqual(
      []
    );
  });

  it('la forma anidada del mismo parche clínico también conserva el objeto atómico', () => {
    const result = prepareFirestorePartialData({
      partialData: {
        beds: { R3: { upcChecklist: { classification: 'UPC_UTI' }, isUPC: true } },
      },
      specialistScopedPatch: false,
      intentionalBedClear: undefined,
    });

    expect(result['beds.R3.upcChecklist']).toEqual({ classification: 'UPC_UTI' });
    expect(result['beds.R3.isUPC']).toBe(true);
  });

  it('los objetos NO clínicos (deviceDetails) se siguen aplanando como siempre', () => {
    const result = prepareFirestorePartialData({
      partialData: {
        'beds.R3.deviceDetails': { LA: { installationDate: '2026-08-31' } },
      },
      specialistScopedPatch: false,
      intentionalBedClear: undefined,
    });

    expect(result['beds.R3.deviceDetails.LA.installationDate']).toBe('2026-08-31');
    expect(result).not.toHaveProperty(['beds.R3.deviceDetails']);
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
