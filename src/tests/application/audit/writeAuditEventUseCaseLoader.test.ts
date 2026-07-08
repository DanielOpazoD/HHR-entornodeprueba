import { describe, expect, it } from 'vitest';
import { loadExecuteWriteAuditEventFrom } from '@/application/audit/writeAuditEventUseCaseLoader';
import { createApplicationSuccess } from '@/shared/contracts/applicationOutcomeFactories';

describe('loadExecuteWriteAuditEventFrom', () => {
  it('returns the loaded audit writer when the lazy module import succeeds', async () => {
    const writer = async () => createApplicationSuccess(null);

    const loadedWriter = await loadExecuteWriteAuditEventFrom(async () => ({
      executeWriteAuditEvent: writer,
    }));

    expect(loadedWriter).toBe(writer);
  });

  it('returns a failing audit writer instead of rejecting when the lazy module import fails', async () => {
    const loadedWriter = await loadExecuteWriteAuditEventFrom(async () => {
      throw new Error('audit chunk unavailable');
    });

    const outcome = await loadedWriter({
      userId: 'nurse@hospital.cl',
      action: 'PATIENT_TRANSFERRED',
      entityType: 'transfer',
      entityId: 'R1',
      details: { bedId: 'R1' },
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.issues[0]?.kind).toBe('unknown');
    expect(outcome.issues[0]?.message).toContain('audit chunk unavailable');
  });
});
