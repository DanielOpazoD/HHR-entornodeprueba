import { describe, expect, it } from 'vitest';

import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType } from '@/types/domain/beds';

describe('bedManagementReducer bed state controls', () => {
  it('creates a provisional clinical crib using the mother label fallback', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      firstName: 'Ana',
      lastName: 'Perez',
      secondLastName: 'Soto',
      patientName: 'Ana Perez Soto',
    });

    const patch = bedManagementReducer(record, {
      type: 'CREATE_CLINICAL_CRIB',
      bedId: 'R1',
    });

    expect(patch).toMatchObject({
      'beds.R1.clinicalCrib': expect.objectContaining({
        bedMode: 'Cuna',
        identityStatus: 'provisional',
        patientName: 'RN de Ana Perez Soto',
        documentType: 'RUT',
        clinicalEpisodeId: expect.stringMatching(/^ep_/),
      }),
      'beds.R1.hasCompanionCrib': false,
    });
  });

  it('toggles blocked bed state preserving the provided reason only while blocked', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');

    const blockedPatch = bedManagementReducer(record, {
      type: 'TOGGLE_BLOCK_BED',
      bedId: 'R1',
      reason: 'Aislamiento',
    });

    expect(blockedPatch).toMatchObject({
      'beds.R1.isBlocked': true,
      'beds.R1.blockedReason': 'Aislamiento',
    });
  });

  it('toggles active extra beds without duplicating existing entries', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.activeExtraBeds = ['R1'];

    const patch = bedManagementReducer(record, {
      type: 'TOGGLE_EXTRA_BED',
      bedId: 'R2',
    });

    expect(patch).toMatchObject({
      activeExtraBeds: ['R1', 'R2'],
    });
  });

  it('toggles bed type overrides between UTI and UCI', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');

    const patch = bedManagementReducer(record, {
      type: 'TOGGLE_BED_TYPE',
      bedId: 'R1',
    });

    expect(patch).toHaveProperty('bedTypeOverrides.R1');
  });

  it('forces the bed type to UCI when the patient is classified as UPC_UCI', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        isUPC: true,
        upcChecklist: {
          uciCriteria: ['uci_vmi'],
          utiCriteria: ['uti_mon_cardiaca'],
          classification: 'UPC_UCI',
          evaluatedAt: '2026-04-18T00:00:00Z',
        },
      },
    });

    expect(patch).toMatchObject({
      'beds.R1.isUPC': true,
      'beds.R1.upcChecklist': expect.objectContaining({
        classification: 'UPC_UCI',
      }),
      'bedTypeOverrides.R1': BedType.UCI,
    });
  });

  it('returns the bed type override to default UTI when UCI criteria are removed', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.bedTypeOverrides = { R1: BedType.UCI };
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      isUPC: true,
      upcChecklist: {
        uciCriteria: ['uci_vmi'],
        utiCriteria: ['uti_mon_cardiaca'],
        classification: 'UPC_UCI',
        evaluatedAt: '2026-04-18T00:00:00Z',
      },
    });

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        isUPC: true,
        upcChecklist: {
          uciCriteria: [],
          utiCriteria: ['uti_mon_cardiaca'],
          classification: 'UPC_UTI',
          evaluatedAt: '2026-04-18T00:05:00Z',
        },
      },
    });

    expect(patch).toMatchObject({
      'beds.R1.upcChecklist': expect.objectContaining({
        classification: 'UPC_UTI',
      }),
      'bedTypeOverrides.R1': undefined,
    });
  });

  it('resets inherited UPC state and bed type override when a bed receives a new patient identity', () => {
    const record = DataFactory.createMockDailyRecord('2026-05-09');
    record.bedTypeOverrides = { R1: BedType.UCI };
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente previo',
      rut: '11.111.111-1',
      isUPC: true,
      upcChecklist: {
        uciCriteria: ['uci_vmi'],
        utiCriteria: [],
        classification: 'UPC_UCI',
        evaluatedAt: '2026-05-08T00:00:00Z',
      },
    });

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        patientName: 'Paciente nuevo',
        rut: '22.222.222-2',
      },
    });

    expect(patch).toMatchObject({
      'beds.R1.patientName': 'Paciente nuevo',
      'beds.R1.rut': '22.222.222-2',
      'beds.R1.isUPC': false,
      'beds.R1.upcChecklist': undefined,
      'bedTypeOverrides.R1': undefined,
    });
  });

  it('updates multiple clinical crib fields in a single patch', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_CLINICAL_CRIB_MULTIPLE',
      bedId: 'R1',
      fields: {
        patientName: 'RN Temporal',
        pathology: 'Observación',
      },
    });

    expect(patch).toEqual({
      'beds.R1.clinicalCrib.patientName': 'RN Temporal',
      'beds.R1.clinicalCrib.pathology': 'Observación',
    });
  });

  it('updates blocked reason and single clinical crib fields through dedicated patches', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');

    const blockedReasonPatch = bedManagementReducer(record, {
      type: 'UPDATE_BLOCKED_REASON',
      bedId: 'R1',
      reason: 'Mantenimiento',
    });
    const cribFieldPatch = bedManagementReducer(record, {
      type: 'UPDATE_CLINICAL_CRIB',
      bedId: 'R1',
      field: 'patientName',
      value: 'RN Ajustado',
    });

    expect(blockedReasonPatch).toEqual({
      'beds.R1.blockedReason': 'Mantenimiento',
    });
    expect(cribFieldPatch).toEqual({
      'beds.R1.clinicalCrib.patientName': 'RN Ajustado',
    });
  });

  it('ignores clinical crib CUDYR updates when the crib has not been created yet', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_CLINICAL_CRIB_CUDYR',
      bedId: 'R1',
      field: 'changeClothes',
      value: 2,
    });

    expect(patch).toBeNull();
  });

  it('updates clinical crib CUDYR fields while refreshing the shared timestamp', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      clinicalCrib: DataFactory.createMockPatient('R1-crib', {
        patientName: 'RN Temporal',
      }),
    });

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_CLINICAL_CRIB_CUDYR',
      bedId: 'R1',
      field: 'changeClothes',
      value: 2,
    });

    expect(patch).toMatchObject({
      'beds.R1.clinicalCrib.cudyr.changeClothes': 2,
    });
    expect(patch).toHaveProperty('cudyrUpdatedAt');
  });

  it('toggles extra beds by adding and removing the same bed id predictably', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.activeExtraBeds = ['H1C1'];

    const removePatch = bedManagementReducer(record, {
      type: 'TOGGLE_EXTRA_BED',
      bedId: 'H1C1',
    });

    const addPatch = bedManagementReducer(record, {
      type: 'TOGGLE_EXTRA_BED',
      bedId: 'H2C1',
    });

    expect(removePatch).toEqual({ activeExtraBeds: [] });
    expect(addPatch).toEqual({ activeExtraBeds: ['H1C1', 'H2C1'] });
  });
});
