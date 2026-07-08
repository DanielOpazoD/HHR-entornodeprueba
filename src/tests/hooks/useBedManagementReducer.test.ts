import { describe, expect, it } from 'vitest';

import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { DataFactory } from '@/tests/factories/DataFactory';
import { Specialty } from '@/types/domain/patientClassification';

describe('bedManagementReducer firstSeenDate anchoring', () => {
  it('anchors firstSeenDate when an empty bed receives its first real patient name', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-11');

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'patientName',
      value: 'Paciente Demo',
    });

    expect(patch).toMatchObject({
      'beds.R1.patientName': 'Paciente Demo',
      'beds.R1.firstSeenDate': '2026-04-11',
    });
  });

  it('does not anchor firstSeenDate for the temporary blank placeholder name', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-11');

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'patientName',
      value: ' ',
    });

    expect(patch).toMatchObject({
      'beds.R1.patientName': ' ',
    });
    expect(patch).not.toHaveProperty('beds.R1.firstSeenDate');
  });

  it('anchors firstSeenDate on multi-field updates when identity appears for the first time', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-11');

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        patientName: 'Paciente Demo',
        rut: '11.111.111-1',
      },
    });

    expect(patch).toMatchObject({
      'beds.R1.patientName': 'Paciente Demo',
      'beds.R1.rut': '11.111.111-1',
      'beds.R1.firstSeenDate': '2026-04-11',
    });
  });

  it('does not send a diagnosis clear when an empty bed receives its first patient identity', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-11');

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        patientName: 'Paciente Demo',
        rut: '11.111.111-1',
        admissionDate: '2026-04-11',
      },
    });

    expect(patch).toMatchObject({
      'beds.R1.patientName': 'Paciente Demo',
      'beds.R1.rut': '11.111.111-1',
      'beds.R1.admissionDate': '2026-04-11',
      'beds.R1.firstSeenDate': '2026-04-11',
    });
    expect(patch).not.toHaveProperty('beds.R1.pathology');
    expect(patch).not.toHaveProperty('beds.R1.clinicalEvents');
    expect(patch).not.toHaveProperty('beds.R1.handoffNoteDayShift');
  });

  it('keeps an existing firstSeenDate when later edits update the identity', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Inicial',
      rut: '11.111.111-1',
      firstSeenDate: '2026-04-11',
    });

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'patientName',
      value: 'Paciente Corregido',
    });

    expect(patch).toMatchObject({
      'beds.R1.patientName': 'Paciente Corregido',
    });
    expect(patch).not.toHaveProperty('beds.R1.firstSeenDate');
  });

  it('re-anchors firstSeenDate when a stale cleared bed receives a new patient identity', () => {
    const record = DataFactory.createMockDailyRecord('2026-05-08');
    record.beds.R2 = DataFactory.createMockPatient('R2', {
      patientName: '',
      rut: '',
      admissionDate: '',
      firstSeenDate: '2026-05-03',
    });

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R2',
      fields: {
        patientName: 'Paciente Nuevo',
        rut: '22.222.222-2',
        admissionDate: '2026-05-08',
      },
    });

    expect(patch).toMatchObject({
      'beds.R2.patientName': 'Paciente Nuevo',
      'beds.R2.rut': '22.222.222-2',
      'beds.R2.firstSeenDate': '2026-05-08',
    });
  });

  it('clears clinical handoff data when identity changes through a single-field update', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Inicial',
      rut: '11.111.111-1',
      pathology: 'Neumonia',
      handoffNoteDayShift: 'Entregado',
      medicalHandoffNote: 'Nota medica',
    });

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'patientName',
      value: 'Paciente Corregido',
    });

    expect(patch).toMatchObject({
      'beds.R1.patientName': 'Paciente Corregido',
      'beds.R1.pathology': '',
      'beds.R1.handoffNoteDayShift': '',
      'beds.R1.medicalHandoffNote': '',
    });
  });

  it('clears gineco-obstetric fields on multi-field specialty updates away from ginecobstetricia', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      specialty: Specialty.GINECOBSTETRICIA,
      ginecobstetriciaType: 'Obstétrica',
      deliveryRoute: 'Cesárea',
      deliveryCesareanLabor: 'Con TdP',
    });

    const patch = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        specialty: Specialty.CIRUGIA,
      },
    });

    expect(patch).toMatchObject({
      'beds.R1.specialty': Specialty.CIRUGIA,
      'beds.R1.ginecobstetriciaType': undefined,
      'beds.R1.deliveryRoute': undefined,
      'beds.R1.deliveryCesareanLabor': undefined,
    });
  });

  it('normalizes UPC and target location when moving a patient to a non-UPC bed', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente UPC',
      rut: '11.111.111-1',
      firstSeenDate: '2026-04-10',
      isUPC: true,
    });

    const patch = bedManagementReducer(record, {
      type: 'MOVE_PATIENT',
      sourceBedId: 'R1',
      targetBedId: 'H1C1',
    });

    expect(patch).toMatchObject({
      'beds.H1C1': expect.objectContaining({
        patientName: 'Paciente UPC',
        bedId: 'H1C1',
        location: record.beds.H1C1.location,
        isUPC: false,
      }),
      'beds.R1': expect.objectContaining({
        bedId: 'R1',
        location: record.beds.R1.location,
        firstSeenDate: undefined,
      }),
    });
  });

  it('clears the episode anchor when manually clearing one bed', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Inicial',
      rut: '11.111.111-1',
      firstSeenDate: '2026-04-10',
      location: 'Box 1',
    });

    const patch = bedManagementReducer(record, {
      type: 'CLEAR_PATIENT',
      bedId: 'R1',
    });

    expect(patch).toMatchObject({
      'beds.R1': expect.objectContaining({
        bedId: 'R1',
        patientName: '',
        rut: '',
        firstSeenDate: undefined,
        admissionDate: '',
        location: 'Box 1',
      }),
    });
  });

  it('normalizes UPC and target location when copying a patient to a non-UPC bed', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente UPC',
      rut: '11.111.111-1',
      isUPC: true,
    });

    const patch = bedManagementReducer(record, {
      type: 'COPY_PATIENT',
      sourceBedId: 'R1',
      targetBedId: 'H1C1',
    });

    expect(patch).toMatchObject({
      'beds.H1C1': expect.objectContaining({
        patientName: 'Paciente UPC',
        bedId: 'H1C1',
        location: record.beds.H1C1.location,
        isUPC: false,
      }),
    });
  });

  it('clears every bed while preserving each original location', () => {
    const record = DataFactory.createMockDailyRecord('2026-04-12');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente 1',
      location: 'Box 1',
    });
    record.beds.H1C1 = DataFactory.createMockPatient('H1C1', {
      patientName: 'Paciente 2',
      location: 'Habitacion 1',
    });

    const patch = bedManagementReducer(record, {
      type: 'CLEAR_ALL_BEDS',
    });

    expect(patch).toMatchObject({
      'beds.R1': expect.objectContaining({
        bedId: 'R1',
        patientName: '',
        location: 'Box 1',
        firstSeenDate: undefined,
      }),
      'beds.H1C1': expect.objectContaining({
        bedId: 'H1C1',
        patientName: '',
        location: 'Habitacion 1',
        firstSeenDate: undefined,
      }),
    });
  });
});
