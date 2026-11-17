// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canAccessAuditSensitivePanelsForRole,
  canAccessAuditViewForRole,
  canExportAuditDataForRole,
} from '@/shared/access/operationalAccessPolicy';

describe('auditAccessPolicy', () => {
  it('allows audit view only for roles with explicit audit permission', () => {
    expect(canAccessAuditViewForRole('admin')).toBe(true);
    expect(canAccessAuditViewForRole('nurse_hospital')).toBe(false);
    expect(canAccessAuditViewForRole('viewer')).toBe(false);
    expect(canAccessAuditViewForRole(undefined)).toBe(false);
  });

  it('restricts sensitive audit panels to administrators', () => {
    expect(canAccessAuditSensitivePanelsForRole('admin')).toBe(true);
    expect(canAccessAuditSensitivePanelsForRole('editor')).toBe(false);
    expect(canAccessAuditSensitivePanelsForRole('nurse_hospital')).toBe(false);
  });

  it('keeps export permissions aligned with role actions', () => {
    expect(canExportAuditDataForRole('admin')).toBe(true);
    expect(canExportAuditDataForRole('nurse_hospital')).toBe(true);
    expect(canExportAuditDataForRole('viewer')).toBe(false);
  });
});
