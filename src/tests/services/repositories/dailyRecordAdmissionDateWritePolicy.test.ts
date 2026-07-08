import { describe, expect, it } from 'vitest';

import { assertAdmissionDatePersistencePolicy } from '@/services/repositories/dailyRecordAdmissionDateWritePolicy';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData =>
  DataFactory.createMockPatient(bedId, {
    patientName: 'Nayeli Hereveri Martinez',
    rut: '24.029.332-3',
    firstSeenDate: '2026-05-08',
    admissionDate: '2026-05-01',
    location: bedId,
    ...overrides,
  });

const buildRecord = (date: string, beds: Record<string, PatientData>): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: '',
        rut: '',
        firstSeenDate: undefined,
        admissionDate: '',
        location: 'R1',
      }),
      R2: DataFactory.createMockPatient('R2', {
        patientName: '',
        rut: '',
        firstSeenDate: undefined,
        admissionDate: '',
        location: 'R2',
      }),
      ...beds,
    },
  });

describe('dailyRecordAdmissionDateWritePolicy carryover episodes', () => {
  it('allows saving an older episode on a later daily record', () => {
    const record = buildRecord('2026-05-09', {
      R1: buildPatient('R1'),
    });

    expect(() => assertAdmissionDatePersistencePolicy('2026-05-09', record)).not.toThrow();
  });

  it('allows moving an existing episode when admissionDate did not change', () => {
    const previous = buildRecord('2026-05-09', {
      R2: buildPatient('R2'),
    });
    const next = buildRecord('2026-05-09', {
      R1: buildPatient('R1'),
    });

    expect(() => assertAdmissionDatePersistencePolicy('2026-05-09', next, previous)).not.toThrow();
  });

  it('allows clearing one duplicated bed without invalidating the remaining episode', () => {
    const patient = buildPatient('R1');
    const previous = buildRecord('2026-05-09', {
      R1: patient,
      R2: { ...patient, bedId: 'R2', location: 'R2' },
    });
    const next = buildRecord('2026-05-09', {
      R1: patient,
    });

    expect(() => assertAdmissionDatePersistencePolicy('2026-05-09', next, previous)).not.toThrow();
  });

  it('does not let a pre-existing invalid episode block unrelated bed edits on its first seen day', () => {
    const contaminatedPatient = buildPatient('NEO1');
    const previous = buildRecord('2026-05-08', {
      NEO1: contaminatedPatient,
    });
    const next = buildRecord('2026-05-08', {
      NEO1: contaminatedPatient,
      R4: buildPatient('R4', {
        patientName: 'Paciente Nuevo',
        rut: '22.222.222-2',
        firstSeenDate: '2026-05-08',
        admissionDate: '2026-05-08',
      }),
    });

    expect(() => assertAdmissionDatePersistencePolicy('2026-05-08', next, previous)).not.toThrow();
  });

  it('still blocks changing admissionDate for the contaminated existing episode itself', () => {
    const previous = buildRecord('2026-05-08', {
      NEO1: buildPatient('NEO1'),
    });
    const next = buildRecord('2026-05-08', {
      NEO1: buildPatient('NEO1', {
        admissionDate: '2026-05-02',
      }),
    });

    expect(() => assertAdmissionDatePersistencePolicy('2026-05-08', next, previous)).toThrow(
      'La fecha no coincide con la primera aparición observada.'
    );
  });

  it('does not compare a diagnosis patch against another bed with the same RUT', () => {
    const mariaH5C2 = buildPatient('H5C2', {
      patientName: 'Maria Nahoe Calderon',
      rut: '12.957.666-9',
      firstSeenDate: '2026-07-01',
      admissionDate: '2026-07-01',
    });
    const mariaR3 = buildPatient('R3', {
      patientName: 'Maria Nahoe Calderon',
      rut: '12.957.666-9',
      firstSeenDate: '2026-07-01',
      admissionDate: '2026-07-02',
      pathology: 'Diagnostico anterior',
    });
    const previous = buildRecord('2026-07-03', {
      H5C2: mariaH5C2,
      R3: mariaR3,
    });
    const next = buildRecord('2026-07-03', {
      H5C2: mariaH5C2,
      R3: {
        ...mariaR3,
        pathology: 'Diagnostico actualizado',
      },
    });

    expect(() =>
      assertAdmissionDatePersistencePolicy('2026-07-03', next, previous, {
        changedPaths: ['beds.R3.pathology'],
      })
    ).not.toThrow();
  });

  it('does not let a non-bed handoff patch surface unrelated admission-date debt', () => {
    const mariaH5C2 = buildPatient('H5C2', {
      patientName: 'Maria Nahoe Calderon',
      rut: '12.957.666-9',
      firstSeenDate: '2026-07-01',
      admissionDate: '2026-07-01',
    });
    const mariaR3 = buildPatient('R3', {
      patientName: 'Maria Nahoe Calderon',
      rut: '12.957.666-9',
      firstSeenDate: '2026-07-01',
      admissionDate: '2026-07-02',
    });
    const previous = buildRecord('2026-07-03', {
      H5C2: mariaH5C2,
      R3: mariaR3,
    });
    const next = {
      ...previous,
      handoffNoteDayShift: 'Entrega actualizada',
    };

    expect(() =>
      assertAdmissionDatePersistencePolicy('2026-07-03', next, previous, {
        changedPaths: ['handoffNoteDayShift'],
      })
    ).not.toThrow();
  });
});
