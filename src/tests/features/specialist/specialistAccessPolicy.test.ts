// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  resolveSpecialistCapabilities,
  resolveSpecialistCensusAccessProfile,
  SPECIALIST_EDITABLE_MODULES,
  SPECIALIST_VISIBLE_MODULES,
} from '@/shared/access/specialistAccessPolicy';

describe('specialistAccessPolicy', () => {
  it('recognizes the specialist role and resolves its census profile', () => {
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

  it('opens clinical documents read/edit draft capabilities for specialists', () => {
    expect(resolveSpecialistCapabilities('doctor_specialist')).toMatchObject({
      canReadClinicalDocuments: true,
      canEditClinicalDocumentDrafts: true,
    });
    expect(resolveSpecialistCapabilities('doctor_urgency')).toMatchObject({
      canReadClinicalDocuments: false,
      canEditClinicalDocumentDrafts: false,
    });
  });
});
