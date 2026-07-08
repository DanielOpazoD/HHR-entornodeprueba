import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClinicalAuditPackageKey } from '@/services/admin/clinicalAuditPatientPackageKey';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const buildPresentationSpy = vi.hoisted(() => vi.fn());

vi.mock('@/services/admin/clinicalAuditPresentation', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/admin/clinicalAuditPresentation')>();

  return {
    ...actual,
    buildClinicalAuditPresentation: (log: AuditLogEntry) => {
      buildPresentationSpy(log.id);
      return actual.buildClinicalAuditPresentation(log);
    },
  };
});

const baseLog = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'audit-identity-1',
  timestamp: '2026-07-01T19:36:29.000Z',
  userId: 'user@hospital.cl',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'H1C1',
  recordDate: '2026-07-01',
  details: {},
  ...overrides,
});

describe('clinicalAuditPatientPackageKey', () => {
  beforeEach(() => {
    buildPresentationSpy.mockClear();
  });

  it('does not build clinical presentation when a strong patient identity is already available', () => {
    const key = resolveClinicalAuditPackageKey(
      baseLog({
        details: {
          rut: '11.111.111-1',
          bedId: 'H1C1',
        },
      })
    );

    expect(key).toBe('2026-07-01|rut:11111111-1');
    expect(buildPresentationSpy).not.toHaveBeenCalled();
  });
});
