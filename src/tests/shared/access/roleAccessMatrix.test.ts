// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  GENERAL_LOGIN_ROLES,
  getManagedRoleOptions,
  isGeneralLoginRole,
  isManagedUserRole,
  isUserRole,
  resolveRoleAccess,
} from '@/shared/access/roleAccessMatrix';

describe('roleAccessMatrix', () => {
  it('allows doctor_specialist as a general login role', () => {
    expect(isGeneralLoginRole('doctor_specialist')).toBe(true);
    expect(GENERAL_LOGIN_ROLES).toContain('doctor_specialist');
  });

  it('keeps viewer as a general login role', () => {
    expect(isGeneralLoginRole('viewer')).toBe(true);
  });

  it('exposes only managed roles in role management options', () => {
    expect(getManagedRoleOptions().map(option => option.role)).toEqual([
      'admin',
      'nurse_hospital',
      'doctor_urgency',
      'doctor_specialist',
      'viewer',
    ]);
    expect(isManagedUserRole('doctor_specialist')).toBe(true);
    expect(isManagedUserRole('viewer')).toBe(true);
  });

  it('resolves specialist role with restricted census and medical capabilities', () => {
    expect(resolveRoleAccess('doctor_specialist')).toMatchObject({
      modules: ['CENSUS', 'MEDICAL_HANDOFF'],
      canEdit: ['MEDICAL_HANDOFF'],
      censusAccessProfile: 'specialist',
      specialistRestrictedMedicalAccess: true,
      canEditClinicalDocumentDrafts: true,
    });
  });

  it('keeps admin system modules visible in the app shell', () => {
    expect(resolveRoleAccess('admin').modules).toEqual(
      expect.arrayContaining(['PATIENT_MASTER_INDEX', 'DATA_MAINTENANCE', 'DIAGNOSTICS'])
    );
    expect(resolveRoleAccess('admin').canEdit).toEqual(
      expect.arrayContaining(['PATIENT_MASTER_INDEX', 'DATA_MAINTENANCE', 'DIAGNOSTICS'])
    );
  });

  it('keeps nurse_hospital with medical handoff visibility but without edit permission', () => {
    expect(resolveRoleAccess('nurse_hospital')).toMatchObject({
      modules: expect.arrayContaining(['CENSUS', 'MEDICAL_HANDOFF']),
    });
    expect(resolveRoleAccess('nurse_hospital').canEdit).toEqual(expect.arrayContaining(['CENSUS']));
    expect(resolveRoleAccess('nurse_hospital').canEdit).not.toContain('MEDICAL_HANDOFF');
  });

  it('accepts only the domain roles as a role, never free text or object keys', () => {
    for (const role of [
      'admin',
      'nurse_hospital',
      'doctor_urgency',
      'doctor_specialist',
      'viewer',
      'editor',
    ]) {
      expect(isUserRole(role)).toBe(true);
    }
    // A prototype key used to reach the permission tables as a function and break them.
    for (const value of [
      'hacker',
      '',
      'ADMIN',
      ' admin',
      'constructor',
      'toString',
      undefined,
      null,
      1,
    ]) {
      expect(isUserRole(value)).toBe(false);
    }
  });
});
