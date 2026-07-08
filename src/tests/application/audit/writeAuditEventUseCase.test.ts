import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeWriteAuditEvent } from '@/application/audit/writeAuditEventUseCase';
import * as auditService from '@/services/admin/auditService';

vi.mock('@/services/admin/auditService', () => ({
  logAuditEvent: vi.fn(),
}));

describe('executeWriteAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success when the audit service resolves', async () => {
    vi.mocked(auditService.logAuditEvent).mockResolvedValueOnce(undefined);

    const result = await executeWriteAuditEvent({
      userId: 'user-1',
      action: 'PATIENT_ADMITTED',
      entityType: 'patient',
      entityId: 'R1',
      details: { patientName: 'John' },
      patientRut: '11.111.111-1',
      recordDate: '2026-03-06',
    });

    expect(result.status).toBe('success');
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(
      'user-1',
      'PATIENT_ADMITTED',
      'patient',
      'R1',
      { patientName: 'John' },
      '11.111.111-1',
      '2026-03-06',
      undefined
    );
  });

  it('returns failed when the audit service throws', async () => {
    vi.mocked(auditService.logAuditEvent).mockRejectedValueOnce(new Error('audit failed'));

    const result = await executeWriteAuditEvent({
      userId: 'user-1',
      action: 'PATIENT_ADMITTED',
      entityType: 'patient',
      entityId: 'R1',
      details: { patientName: 'John' },
    });

    expect(result.status).toBe('failed');
    expect(result.issues[0]?.message).toBe('audit failed');
  });

  it('rejects clinical actions when the actor is anonymous and never reaches the audit service', async () => {
    const result = await executeWriteAuditEvent({
      userId: 'anon',
      action: 'PATIENT_ADMITTED',
      entityType: 'patient',
      entityId: 'R1',
      details: { patientName: 'John' },
    });

    expect(result.status).toBe('failed');
    expect(result.issues[0]?.kind).toBe('permission');
    expect(result.issues[0]?.message).toMatch(/PATIENT_ADMITTED/);
    expect(auditService.logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects clinical actions when the actor is empty / whitespace / a known anonymous alias', async () => {
    for (const userId of ['', '   ', 'anonymous', 'anonymous_user', 'ANON']) {
      const result = await executeWriteAuditEvent({
        userId,
        action: 'CUDYR_MODIFIED',
        entityType: 'patient',
        entityId: 'R1',
        details: { field: 'severity' },
      });
      expect(result.status).toBe('failed');
      expect(result.issues[0]?.kind).toBe('permission');
    }
    expect(auditService.logAuditEvent).not.toHaveBeenCalled();
  });

  it('still allows non-clinical actions with an anonymous actor (e.g. SYSTEM_ERROR before login)', async () => {
    vi.mocked(auditService.logAuditEvent).mockResolvedValueOnce(undefined);

    const result = await executeWriteAuditEvent({
      userId: 'anon',
      action: 'SYSTEM_ERROR',
      entityType: 'system',
      entityId: 'boot-failure',
      details: { reason: 'auth-init-timeout' },
    });

    expect(result.status).toBe('success');
    expect(auditService.logAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('allows clinical actions when the actor is an authenticated email', async () => {
    vi.mocked(auditService.logAuditEvent).mockResolvedValueOnce(undefined);

    const result = await executeWriteAuditEvent({
      userId: 'nurse@hospital.cl',
      action: 'HANDOFF_NOVEDADES_MODIFIED',
      entityType: 'system',
      entityId: '2026-03-06::nurse',
      details: { content: 'novedad' },
    });

    expect(result.status).toBe('success');
    expect(auditService.logAuditEvent).toHaveBeenCalledTimes(1);
    expect(auditService.logAuditEvent).toHaveBeenCalledWith(
      'nurse@hospital.cl',
      'HANDOFF_NOVEDADES_MODIFIED',
      'system',
      '2026-03-06::nurse',
      { content: 'novedad' },
      undefined,
      undefined,
      undefined
    );
  });
});
