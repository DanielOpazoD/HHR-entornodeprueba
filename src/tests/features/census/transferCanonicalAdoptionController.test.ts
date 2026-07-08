import { describe, expect, it, vi } from 'vitest';
import {
  dispatchCanonicalTransfer,
  type TransferCanonicalAuditEntry,
  type TransferCanonicalDispatchInput,
} from '@/features/census/controllers/transferCanonicalAdoptionController';

const validEntry = (): TransferCanonicalAuditEntry => ({
  bedId: 'H5C1',
  patientName: 'Paciente Demo',
  rut: '11.111.111-1',
  destination: 'Hospital Base de Valdivia',
});

const validInput = (
  overrides: Partial<TransferCanonicalDispatchInput> = {}
): TransferCanonicalDispatchInput => ({
  actor: 'doctor@hospital.cl',
  recordDate: '2026-05-03',
  entry: validEntry(),
  performLegacyPersist: vi.fn(async () => undefined),
  ...overrides,
});

describe('dispatchCanonicalTransfer', () => {
  it('blocks anonymous actors and never invokes the legacy persist', async () => {
    const performLegacyPersist = vi.fn();
    const writeAuditEvent = vi.fn();

    const outcome = await dispatchCanonicalTransfer(
      validInput({ actor: 'anon', performLegacyPersist }),
      { writeAuditEvent }
    );

    expect(outcome.status.status).toBe('blocked');
    expect(outcome.applicationOutcome.issues[0]?.kind).toBe('permission');
    expect(performLegacyPersist).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it('blocks when destination is missing', async () => {
    const performLegacyPersist = vi.fn();
    const outcome = await dispatchCanonicalTransfer(
      validInput({ entry: { ...validEntry(), destination: '   ' }, performLegacyPersist }),
      { writeAuditEvent: vi.fn() }
    );

    expect(outcome.status.status).toBe('blocked');
    expect(outcome.applicationOutcome.issues[0]?.kind).toBe('validation');
    expect(performLegacyPersist).not.toHaveBeenCalled();
  });

  it('persists, audits, and returns ready on the happy path', async () => {
    const performLegacyPersist = vi.fn(async () => undefined);
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });

    const outcome = await dispatchCanonicalTransfer(validInput({ performLegacyPersist }), {
      writeAuditEvent,
    });

    expect(performLegacyPersist).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PATIENT_TRANSFERRED',
        entityType: 'transfer',
        entityId: 'H5C1',
        details: expect.objectContaining({ destination: 'Hospital Base de Valdivia' }),
      })
    );
    expect(outcome.status.status).toBe('ready');
  });

  it('reports failed when persistence throws and never emits audit', async () => {
    const performLegacyPersist = vi.fn().mockRejectedValue(new Error('network down'));
    const writeAuditEvent = vi.fn();

    const outcome = await dispatchCanonicalTransfer(validInput({ performLegacyPersist }), {
      writeAuditEvent,
    });

    expect(outcome.status.status).toBe('failed');
    expect(outcome.applicationOutcome.issues[0]?.message).toBe('network down');
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it('reports degraded when persistence succeeds but audit emission is rejected', async () => {
    const writeAuditEvent = vi.fn().mockResolvedValue({
      status: 'failed',
      data: null,
      issues: [{ kind: 'permission', message: 'Audit rejected by policy' }],
    });

    const outcome = await dispatchCanonicalTransfer(validInput(), { writeAuditEvent });

    expect(outcome.status.status).toBe('degraded');
    expect(outcome.applicationOutcome.userSafeMessage).toMatch(/auditoría/i);
  });
});
