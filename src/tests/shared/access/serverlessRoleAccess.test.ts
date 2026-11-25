// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GENERAL_LOGIN_ROLES, resolveRoleAccess } from '@/shared/access/roleAccessMatrix';
import {
  SERVERLESS_ADMIN_AND_NURSE_ROLES,
  SERVERLESS_ADMIN_ONLY_ROLES,
  SERVERLESS_ALL_LOGIN_ROLES,
  SERVERLESS_CLINICAL_DOCUMENT_ROLES,
  isServerlessAdminRole,
} from '@/shared/access/serverlessRoleAccess';

const SAMPLE_ROLES = [
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
  'viewer',
  'unauthorized',
  '',
  'ADMIN',
  ' admin',
] as const;

const rolesIn = (allowed: ReadonlySet<string>): string[] =>
  SAMPLE_ROLES.filter(role => allowed.has(role));

describe('serverlessRoleAccess', () => {
  it('exposes exact allowed role sets for every Netlify serverless gate', () => {
    expect(rolesIn(SERVERLESS_ALL_LOGIN_ROLES)).toEqual([
      'admin',
      'nurse_hospital',
      'doctor_urgency',
      'doctor_specialist',
      'editor',
      'viewer',
    ]);
    expect(rolesIn(SERVERLESS_CLINICAL_DOCUMENT_ROLES)).toEqual([
      'admin',
      'nurse_hospital',
      'doctor_urgency',
      'doctor_specialist',
      'editor',
    ]);
    expect(rolesIn(SERVERLESS_ADMIN_AND_NURSE_ROLES)).toEqual(['admin', 'nurse_hospital']);
    expect(rolesIn(SERVERLESS_ADMIN_ONLY_ROLES)).toEqual(['admin']);
  });

  it('derives general-login and clinical-document sets directly from roleAccessMatrix', () => {
    expect([...SERVERLESS_ALL_LOGIN_ROLES].sort()).toEqual([...GENERAL_LOGIN_ROLES].sort());
    expect([...SERVERLESS_CLINICAL_DOCUMENT_ROLES].sort()).toEqual(
      GENERAL_LOGIN_ROLES.filter(role => resolveRoleAccess(role).canReadClinicalDocuments).sort()
    );
  });

  it('checks admin-only privilege strictly in isServerlessAdminRole', () => {
    expect(SAMPLE_ROLES.filter(role => isServerlessAdminRole(role))).toEqual(['admin']);
    expect(isServerlessAdminRole(undefined)).toBe(false);
  });
});
