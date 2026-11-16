// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canEditSpecialistTodayBoundRecord,
  canSpecialistEditClinicalDocumentDrafts,
  canSpecialistReadClinicalDocuments,
  hasSpecialistRestrictedMedicalAccess,
  isDoctorSpecialistRole,
  resolveSpecialistCapabilities,
  resolveSpecialistCensusAccessProfile,
  SPECIALIST_EDITABLE_MODULES,
  SPECIALIST_VISIBLE_MODULES,
} from '@/shared/access/specialistAccessPolicy';

describe('specialistAccessPolicy', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recognizes the specialist role and resolves its census profile', () => {
    expect(isDoctorSpecialistRole('doctor_specialist')).toBe(true);
    expect(isDoctorSpecialistRole('doctor_urgency')).toBe(false);
    expect(resolveSpecialistCensusAccessProfile('doctor_specialist')).toBe('specialist');
    expect(resolveSpecialistCensusAccessProfile('admin')).toBe('default');
  });

  it('defines the expected module scope for specialists', () => {
    expect(SPECIALIST_VISIBLE_MODULES).toEqual(['CENSUS', 'MEDICAL_HANDOFF']);
    expect(SPECIALIST_EDITABLE_MODULES).toEqual(['MEDICAL_HANDOFF']);
    expect(resolveSpecialistCapabilities('doctor_specialist')).toMatchObject({
      isSpecialist: true,
      visibleModules: ['CENSUS', 'MEDICAL_HANDOFF'],
      editableModules: ['MEDICAL_HANDOFF'],
      censusAccessProfile: 'specialist',
      hasRestrictedMedicalAccess: true,
      canReadClinicalDocuments: true,
      canEditClinicalDocumentDrafts: true,
    });
    expect(resolveSpecialistCapabilities('doctor_urgency')).toMatchObject({
      isSpecialist: false,
      visibleModules: [],
      editableModules: [],
      censusAccessProfile: 'default',
      hasRestrictedMedicalAccess: false,
      canReadClinicalDocuments: false,
      canEditClinicalDocumentDrafts: false,
    });
  });

  it('treats only the specialist role as restricted medical access', () => {
    expect(hasSpecialistRestrictedMedicalAccess('doctor_specialist')).toBe(true);
    expect(hasSpecialistRestrictedMedicalAccess('doctor_urgency')).toBe(false);
    expect(hasSpecialistRestrictedMedicalAccess('viewer')).toBe(false);
  });

  it('allows specialist editing only for current-day restricted records', () => {
    expect(
      canEditSpecialistTodayBoundRecord({
        role: 'doctor_specialist',
        readOnly: false,
        recordDate: '2026-03-14',
        todayISO: '2026-03-14',
      })
    ).toBe(true);

    expect(
      canEditSpecialistTodayBoundRecord({
        role: 'doctor_specialist',
        readOnly: false,
        recordDate: '2026-03-14T00:00:00.000Z',
        todayISO: '2026-03-14',
      })
    ).toBe(true);

    expect(
      canEditSpecialistTodayBoundRecord({
        role: 'doctor_specialist',
        readOnly: false,
        recordDate: '2026-03-13',
        todayISO: '2026-03-14',
      })
    ).toBe(false);

    expect(
      canEditSpecialistTodayBoundRecord({
        role: 'doctor_urgency',
        readOnly: false,
        recordDate: '2026-03-13',
        todayISO: '2026-03-14',
      })
    ).toBe(true);
  });

  it('treats the active overnight clinical day as editable for specialists before the day cutoff', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 6, 59, 0));

    expect(
      canEditSpecialistTodayBoundRecord({
        role: 'doctor_specialist',
        readOnly: false,
        recordDate: '2026-04-21',
      })
    ).toBe(true);

    expect(
      canEditSpecialistTodayBoundRecord({
        role: 'doctor_specialist',
        readOnly: false,
        recordDate: '2026-04-22',
      })
    ).toBe(false);
  });

  it('opens clinical documents read/edit draft capabilities for specialists', () => {
    expect(canSpecialistReadClinicalDocuments('doctor_specialist')).toBe(true);
    expect(canSpecialistEditClinicalDocumentDrafts('doctor_specialist')).toBe(true);
    expect(canSpecialistReadClinicalDocuments('doctor_urgency')).toBe(false);
    expect(canSpecialistEditClinicalDocumentDrafts('doctor_urgency')).toBe(false);
  });
});
