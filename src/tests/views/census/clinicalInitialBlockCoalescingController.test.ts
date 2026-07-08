import { describe, expect, it } from 'vitest';
import {
  isClinicalInitialBlockField,
  splitClinicalInitialBlockPatch,
} from '@/features/census/controllers/clinicalInitialBlockCoalescingController';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

describe('clinicalInitialBlockCoalescingController', () => {
  it('recognizes the initial clinical block fields', () => {
    expect(isClinicalInitialBlockField('pathology')).toBe(true);
    expect(isClinicalInitialBlockField('specialty')).toBe(true);
    expect(isClinicalInitialBlockField('secondarySpecialty')).toBe(true);
    expect(isClinicalInitialBlockField('status')).toBe(true);
    expect(isClinicalInitialBlockField('patientName')).toBe(false);
  });

  it('splits clinical fields from immediate patient fields without dropping undefined values', () => {
    expect(
      splitClinicalInitialBlockPatch({
        patientName: 'Paciente X',
        pathology: 'Neumonia',
        specialty: Specialty.MEDICINA,
        secondarySpecialty: undefined,
        status: PatientStatus.ESTABLE,
      })
    ).toEqual({
      clinicalFields: {
        pathology: 'Neumonia',
        specialty: Specialty.MEDICINA,
        secondarySpecialty: undefined,
        status: PatientStatus.ESTABLE,
      },
      immediateFields: {
        patientName: 'Paciente X',
      },
    });
  });
});
