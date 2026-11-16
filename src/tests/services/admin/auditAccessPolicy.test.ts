// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canAccessAuditSensitivePanels,
  canAccessAuditView,
  canExportAuditData,
} from '@/services/admin/auditAccessPolicy';

describe('auditAccessPolicy', () => {
  it('allows audit view only for roles with explicit audit permission', () => {
    expect(canAccessAuditView('admin')).toBe(true);
    expect(canAccessAuditView('nurse_hospital')).toBe(false);
    expect(canAccessAuditView('viewer')).toBe(false);
    expect(canAccessAuditView(undefined)).toBe(false);
  });

  it('restricts sensitive audit panels to administrators', () => {
    expect(canAccessAuditSensitivePanels('admin')).toBe(true);
    expect(canAccessAuditSensitivePanels('editor')).toBe(false);
    expect(canAccessAuditSensitivePanels('nurse_hospital')).toBe(false);
  });

  it('keeps export permissions aligned with role actions', () => {
    expect(canExportAuditData('admin')).toBe(true);
    expect(canExportAuditData('nurse_hospital')).toBe(true);
    expect(canExportAuditData('viewer')).toBe(false);
  });
});
