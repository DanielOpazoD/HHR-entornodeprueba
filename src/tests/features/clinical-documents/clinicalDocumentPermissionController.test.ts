import { describe, expect, it } from 'vitest';

import {
  canArchiveClinicalDocuments,
  canDeleteClinicalDocuments,
  canEditClinicalDocuments,
  canReadClinicalDocuments,
} from '@/features/clinical-documents/controllers/clinicalDocumentPermissionController';

describe('clinicalDocumentPermissionController', () => {
  it('allows read access for admin, doctor and nurse hospital', () => {
    expect(canReadClinicalDocuments('admin')).toBe(true);
    expect(canReadClinicalDocuments('doctor_urgency')).toBe(true);
    expect(canReadClinicalDocuments('doctor_specialist')).toBe(true);
    expect(canReadClinicalDocuments('nurse_hospital')).toBe(true);
    expect(canReadClinicalDocuments('editor')).toBe(true);
    expect(canReadClinicalDocuments('viewer')).toBe(false);
  });

  it('allows specialists to edit drafts while keeping nurses in read-only mode', () => {
    expect(canEditClinicalDocuments('admin')).toBe(true);
    expect(canEditClinicalDocuments('doctor_urgency')).toBe(true);
    expect(canEditClinicalDocuments('doctor_specialist')).toBe(true);
    expect(canEditClinicalDocuments('nurse_hospital')).toBe(false);
  });

  it('keeps document delete globally restricted to admin', () => {
    expect(canDeleteClinicalDocuments('admin')).toBe(true);
    expect(canDeleteClinicalDocuments('doctor_urgency')).toBe(false);
    expect(canDeleteClinicalDocuments('doctor_specialist')).toBe(false);
    expect(canDeleteClinicalDocuments('nurse_hospital')).toBe(false);
    expect(canDeleteClinicalDocuments('editor')).toBe(false);
    expect(canDeleteClinicalDocuments('viewer')).toBe(false);
    expect(canDeleteClinicalDocuments(undefined)).toBe(false);
  });

  it('keeps archive permission restricted to admin only', () => {
    expect(canArchiveClinicalDocuments('admin')).toBe(true);
    expect(canArchiveClinicalDocuments('doctor_urgency')).toBe(false);
    expect(canArchiveClinicalDocuments('doctor_specialist')).toBe(false);
    expect(canArchiveClinicalDocuments('nurse_hospital')).toBe(false);
    expect(canArchiveClinicalDocuments(undefined)).toBe(false);
  });
});
