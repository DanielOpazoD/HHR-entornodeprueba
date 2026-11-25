import { describe, expect, it } from 'vitest';
import {
  canAccessMmradRole,
  canRenderClinicalDocumentPdfRole,
  canWriteDailyRecordRole,
  isAdminOrHospitalNurseRole,
  isAdminRole,
  isClinicalStaffRole,
  isHospitalNurseRole,
} from '../../../functions/lib/auth/rolePredicates';

const ALL_ROLES = [
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
  'viewer',
  'unauthorized',
  '',
  null,
  undefined,
] as const;

const matchingRoles = (predicate: (role: unknown) => boolean) =>
  ALL_ROLES.filter(role => predicate(role));

describe('functions/lib/auth/rolePredicates', () => {
  it('matches exact server role sets for each named capability predicate', () => {
    expect(matchingRoles(isAdminRole)).toEqual(['admin']);
    expect(matchingRoles(isHospitalNurseRole)).toEqual(['nurse_hospital']);
    expect(matchingRoles(isAdminOrHospitalNurseRole)).toEqual(['admin', 'nurse_hospital']);
    expect(matchingRoles(isClinicalStaffRole)).toEqual([
      'admin',
      'nurse_hospital',
      'doctor_urgency',
      'doctor_specialist',
    ]);
    expect(matchingRoles(canWriteDailyRecordRole)).toEqual([
      'admin',
      'nurse_hospital',
      'doctor_urgency',
      'doctor_specialist',
      'editor',
    ]);
    expect(matchingRoles(canRenderClinicalDocumentPdfRole)).toEqual([
      'admin',
      'nurse_hospital',
      'doctor_urgency',
      'doctor_specialist',
      'editor',
    ]);
    expect(matchingRoles(canAccessMmradRole)).toEqual([
      'admin',
      'nurse_hospital',
      'doctor_urgency',
      'doctor_specialist',
      'editor',
      'viewer',
    ]);
  });
});
