import { describe, expect, it, vi, beforeEach } from 'vitest';

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock('@/services/utils/loggerScope', () => ({
  createScopedLogger: () => ({
    warn: warnSpy,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { reportAuditOutcome } from '@/hooks/controllers/auditEventRejectionLogger';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';

describe('reportAuditOutcome', () => {
  beforeEach(() => {
    warnSpy.mockReset();
  });

  it('does not log on a successful audit outcome', () => {
    reportAuditOutcome(createApplicationSuccess(null), {
      userId: 'nurse@hospital.cl',
      action: 'PATIENT_ADMITTED',
      entityType: 'patient',
      entityId: 'R1',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('emits a structured warn including the rejection issues when the outcome is failed', () => {
    const outcome = createApplicationFailed(null, [
      {
        kind: 'permission',
        message: 'No se persistió evento clínico PATIENT_ADMITTED (entidad R1)',
      },
    ]);

    reportAuditOutcome(outcome, {
      userId: 'anon',
      action: 'PATIENT_ADMITTED',
      entityType: 'patient',
      entityId: 'R1',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('Audit event rejected', {
      userId: 'anon',
      action: 'PATIENT_ADMITTED',
      entityType: 'patient',
      entityId: 'R1',
      issues: outcome.issues,
    });
  });
});
