// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveNameInputState } from '@/features/census/components/patient-row/nameInputController';

describe('nameInputController', () => {
  it('builds the full name from split identity fields when legacy name is empty', () => {
    const data = DataFactory.createMockPatient('R1', {
      patientName: '',
      firstName: 'Juan Carlos',
      lastName: 'Perez',
      secondLastName: 'Soto',
    });

    expect(resolveNameInputState({ data })).toEqual({
      fullName: 'Juan Carlos Perez Soto',
      canEditInlineName: false,
    });
  });

  it('prefers the legacy patient name when split fields are inconsistent', () => {
    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Nuevo',
      firstName: 'Paciente',
      lastName: 'Antiguo',
      secondLastName: 'Persistente',
    });

    expect(resolveNameInputState({ data })).toEqual({
      fullName: 'Paciente Nuevo',
      canEditInlineName: false,
    });
  });

  it('keeps main-row names read-only', () => {
    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Principal',
      identityStatus: 'official',
      rut: '12.345.678-9',
    });

    expect(resolveNameInputState({ data, isSubRow: false })).toEqual({
      fullName: 'Paciente Principal',
      canEditInlineName: false,
    });
  });

  it('keeps official clinical crib identities read-only', () => {
    const data = DataFactory.createMockPatient('R1-cuna', {
      patientName: 'Jose Tuki',
      firstName: 'Jose',
      lastName: 'Tuki',
      secondLastName: '',
      identityStatus: 'official',
      rut: '12.345.678-9',
    });

    expect(resolveNameInputState({ data, isSubRow: true })).toEqual({
      fullName: 'Jose Tuki',
      canEditInlineName: false,
    });
  });

  it('allows inline editing only for provisional clinical crib rows', () => {
    const data = DataFactory.createMockPatient('R1-cuna', {
      patientName: 'RN de Madre',
      identityStatus: 'provisional',
      rut: '',
    });

    expect(resolveNameInputState({ data, isSubRow: true })).toEqual({
      fullName: 'RN de Madre',
      canEditInlineName: true,
    });
  });
});
