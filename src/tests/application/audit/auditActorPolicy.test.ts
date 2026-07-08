import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_AUDIT_ACTOR,
  CLINICAL_AUDIT_ACTIONS,
  isAnonymousActor,
  isClinicalAuditAction,
} from '@/application/audit/auditActorPolicy';
import type { AuditAction } from '@/types/auditActionTypes';

describe('isAnonymousActor', () => {
  it('treats null and undefined as anonymous', () => {
    expect(isAnonymousActor(null)).toBe(true);
    expect(isAnonymousActor(undefined)).toBe(true);
  });

  it('treats empty and whitespace-only strings as anonymous', () => {
    expect(isAnonymousActor('')).toBe(true);
    expect(isAnonymousActor('   ')).toBe(true);
    expect(isAnonymousActor('\t\n')).toBe(true);
  });

  it('treats the explicit sentinel and known aliases as anonymous, case-insensitive', () => {
    expect(isAnonymousActor(ANONYMOUS_AUDIT_ACTOR)).toBe(true);
    expect(isAnonymousActor('ANON')).toBe(true);
    expect(isAnonymousActor('anonymous')).toBe(true);
    expect(isAnonymousActor('Anonymous_User')).toBe(true);
  });

  it('does not treat real identifiers as anonymous', () => {
    expect(isAnonymousActor('nurse@hospital.cl')).toBe(false);
    expect(isAnonymousActor('uid-abc123')).toBe(false);
    expect(isAnonymousActor('Dr. Anon')).toBe(false); // contains the substring but is not the sentinel
  });
});

describe('isClinicalAuditAction', () => {
  const clinicalSamples: AuditAction[] = [
    'PATIENT_ADMITTED',
    'PATIENT_DISCHARGED',
    'PATIENT_TRANSFERRED',
    'PATIENT_BED_CHANGED',
    'PATIENT_DIAGNOSIS_CHANGED',
    'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED',
    'DAILY_RECORD_CREATED',
    'DAILY_RECORD_DELETED',
    'NURSE_HANDOFF_MODIFIED',
    'MEDICAL_HANDOFF_MODIFIED',
    'HANDOFF_NOVEDADES_MODIFIED',
    'MEDICAL_HANDOFF_SIGNED',
    'CUDYR_MODIFIED',
    'BED_BLOCKED',
    'CLINICAL_DOCUMENT_EDITED',
    'CLINICAL_DOCUMENT_EXPORTED',
    'CLINICAL_DOCUMENT_PRINTED',
    'PRESCRIPTION_MANUAL_DELETED',
    'WOUND_CARE_PHOTO_UPLOADED',
    'CONFLICT_AUTO_MERGED',
  ];

  const nonClinicalSamples: AuditAction[] = [
    'PATIENT_VIEWED',
    'VIEW_PATIENT',
    'VIEW_CUDYR',
    'VIEW_NURSING_HANDOFF',
    'VIEW_MEDICAL_HANDOFF',
    'USER_LOGIN',
    'USER_LOGOUT',
    'PRESCRIPTION_RETENTION_DELETED',
    'SYSTEM_ERROR',
  ];

  it.each(clinicalSamples)('classifies %s as clinical', action => {
    expect(isClinicalAuditAction(action)).toBe(true);
  });

  it.each(nonClinicalSamples)('classifies %s as non-clinical', action => {
    expect(isClinicalAuditAction(action)).toBe(false);
  });

  it('does not include any view or login action by mistake', () => {
    for (const action of CLINICAL_AUDIT_ACTIONS) {
      expect(action.startsWith('VIEW_')).toBe(false);
      expect(action).not.toBe('PATIENT_VIEWED');
      expect(action).not.toBe('USER_LOGIN');
      expect(action).not.toBe('USER_LOGOUT');
      expect(action).not.toBe('SYSTEM_ERROR');
    }
  });
});
