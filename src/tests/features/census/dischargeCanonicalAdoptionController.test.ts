import { describe, expect, it, vi } from 'vitest';
import {
  buildDischargeCanonicalAuditEntries,
  dispatchCanonicalDischarge,
  type DischargeCanonicalAuditEntry,
  type DischargeCanonicalDispatchInput,
} from '@/features/census/controllers/dischargeCanonicalAdoptionController';

const validEntry = (): DischargeCanonicalAuditEntry => ({
  bedId: 'H5C1',
  patientName: 'Paciente Demo',
  rut: '11.111.111-1',
  status: 'Vivo',
});

const validInput = (
  overrides: Partial<DischargeCanonicalDispatchInput> = {}
): DischargeCanonicalDispatchInput => ({
  actor: 'doctor@hospital.cl',
  recordDate: '2026-05-03',
  entries: [validEntry()],
  performLegacyPersist: vi.fn(async () => undefined),
  ...overrides,
});

describe('dispatchCanonicalDischarge', () => {
  it('builds discharge audit entries with clinicalEpisodeId as the episode key for new patients', () => {
    const entries = buildDischargeCanonicalAuditEntries({
      record: {
        date: '2026-05-13',
        beds: {
          R1: {
            bedId: 'R1',
            patientName: 'Paciente Reingreso Tarde',
            rut: '11.111.111-1',
            admissionDate: '2026-05-13',
            admissionTime: '18:30',
            clinicalEpisodeId: 'ep-afternoon',
          },
        },
      },
      bedId: 'R1',
      status: 'Vivo',
      movementDate: '2026-05-13',
      time: '13:24',
      dischargeType: 'Domicilio (Habitual)',
      dischargeTarget: 'mother',
      diagnosis: 'Diagnóstico de egreso',
    });

    expect(entries).toEqual([
      expect.objectContaining({
        bedId: 'R1',
        patientName: 'Paciente Reingreso Tarde',
        rut: '11.111.111-1',
        status: 'Vivo',
        episodeKey: 'ep-afternoon',
        movementDate: '2026-05-13',
        time: '13:24',
        dischargeType: 'Domicilio (Habitual)',
        dischargeTarget: 'mother',
        diagnosis: 'Diagnóstico de egreso',
      }),
    ]);
  });

  it('separates same-RUT same-day discharge document locks by clinicalEpisodeId', async () => {
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });
    const lockDocumentsByEpisodeKey = vi.fn().mockResolvedValue([]);

    await dispatchCanonicalDischarge(
      validInput({
        entries: [
          {
            bedId: 'R1',
            patientName: 'Paciente Mañana',
            rut: '11.111.111-1',
            status: 'Vivo',
            episodeKey: 'ep-morning',
          },
          {
            bedId: 'R2',
            patientName: 'Paciente Tarde',
            rut: '11.111.111-1',
            status: 'Vivo',
            episodeKey: 'ep-afternoon',
          },
        ],
      }),
      { writeAuditEvent, lockDocumentsByEpisodeKey }
    );

    expect(lockDocumentsByEpisodeKey).toHaveBeenNthCalledWith(
      1,
      'ep-morning',
      undefined,
      expect.objectContaining({ lockedAt: expect.any(String) })
    );
    expect(lockDocumentsByEpisodeKey).toHaveBeenNthCalledWith(
      2,
      'ep-afternoon',
      undefined,
      expect.objectContaining({ lockedAt: expect.any(String) })
    );
  });

  it('blocks anonymous actors and never invokes the legacy persist', async () => {
    const performLegacyPersist = vi.fn();
    const writeAuditEvent = vi.fn();

    const outcome = await dispatchCanonicalDischarge(
      validInput({ actor: 'anon', performLegacyPersist }),
      { writeAuditEvent }
    );

    expect(outcome.status.status).toBe('blocked');
    expect(outcome.applicationOutcome.issues[0]?.kind).toBe('permission');
    expect(performLegacyPersist).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it('blocks empty entry batches', async () => {
    const performLegacyPersist = vi.fn();
    const outcome = await dispatchCanonicalDischarge(
      validInput({ entries: [], performLegacyPersist }),
      { writeAuditEvent: vi.fn() }
    );

    expect(outcome.status.status).toBe('blocked');
    expect(outcome.applicationOutcome.issues[0]?.kind).toBe('validation');
    expect(performLegacyPersist).not.toHaveBeenCalled();
  });

  it('persists, audits each entry, and returns ready on the happy path', async () => {
    const performLegacyPersist = vi.fn(async () => undefined);
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });

    const outcome = await dispatchCanonicalDischarge(
      validInput({
        performLegacyPersist,
        entries: [
          { bedId: 'R1', patientName: 'A', rut: 'R-A', status: 'Vivo' },
          { bedId: 'R1', patientName: 'B', rut: 'R-B', status: 'Fallecido' },
        ],
      }),
      { writeAuditEvent }
    );

    expect(performLegacyPersist).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).toHaveBeenCalledTimes(2);
    expect(writeAuditEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'PATIENT_DISCHARGED',
        entityType: 'discharge',
        entityId: 'R1',
        details: expect.objectContaining({
          status: 'Vivo',
          bedId: 'R1',
          rut: 'R-A',
        }),
      })
    );
    expect(outcome.status.status).toBe('ready');
    expect(outcome.applicationOutcome.status).toBe('success');
  });

  it('writes enriched discharge audit details when movement metadata is available', async () => {
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });

    await dispatchCanonicalDischarge(
      validInput({
        entries: [
          {
            bedId: 'H2C2',
            patientName: 'Bernardo Orrego Llanos',
            rut: '17.274.300-5',
            status: 'Vivo',
            episodeKey: 'episode-bernardo',
            movementDate: '2026-07-01',
            time: '13:24',
            diagnosis: 'Neumonía adquirida en la comunidad',
            dischargeType: 'Domicilio (Habitual)',
            dischargeTarget: 'mother',
          },
        ],
      }),
      { writeAuditEvent, lockDocumentsByEpisodeKey: vi.fn().mockResolvedValue([]) }
    );

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PATIENT_DISCHARGED',
        entityType: 'discharge',
        entityId: 'H2C2',
        details: expect.objectContaining({
          patientName: 'Bernardo Orrego Llanos',
          rut: '17.274.300-5',
          status: 'Vivo',
          bedId: 'H2C2',
          episodeKey: 'episode-bernardo',
          movementDate: '2026-07-01',
          time: '13:24',
          diagnosis: 'Neumonía adquirida en la comunidad',
          dischargeType: 'Domicilio (Habitual)',
          dischargeTarget: 'mother',
        }),
      })
    );
  });

  it('reports failed when the legacy persist throws and never emits audit', async () => {
    const performLegacyPersist = vi.fn().mockRejectedValue(new Error('Firestore offline'));
    const writeAuditEvent = vi.fn();

    const outcome = await dispatchCanonicalDischarge(validInput({ performLegacyPersist }), {
      writeAuditEvent,
    });

    expect(outcome.status.status).toBe('failed');
    expect(outcome.applicationOutcome.issues[0]?.message).toBe('Firestore offline');
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it('reports degraded when persistence succeeds but audit emission is rejected', async () => {
    const writeAuditEvent = vi.fn().mockResolvedValue({
      status: 'failed',
      data: null,
      issues: [{ kind: 'permission', message: 'Audit rejected by policy' }],
    });

    const outcome = await dispatchCanonicalDischarge(validInput(), { writeAuditEvent });

    expect(outcome.status.status).toBe('degraded');
    expect(outcome.applicationOutcome.userSafeMessage).toMatch(/auditoría/i);
  });

  it('locks clinical documents of every closed episode and audits each newly-locked doc', async () => {
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });
    const lockDocumentsByEpisodeKey = vi
      .fn()
      .mockResolvedValueOnce(['doc-a-1', 'doc-a-2'])
      .mockResolvedValueOnce(['doc-b-1']);

    const outcome = await dispatchCanonicalDischarge(
      validInput({
        entries: [
          {
            bedId: 'R1',
            patientName: 'A',
            rut: '11.111.111-1',
            status: 'Vivo',
            episodeKey: '11.111.111-1__2026-04-01',
          },
          {
            bedId: 'R2',
            patientName: 'B',
            rut: '22.222.222-2',
            status: 'Fallecido',
            episodeKey: '22.222.222-2__2026-04-15',
            hospitalId: 'hhr',
          },
        ],
      }),
      { writeAuditEvent, lockDocumentsByEpisodeKey }
    );

    expect(outcome.status.status).toBe('ready');
    expect(lockDocumentsByEpisodeKey).toHaveBeenCalledTimes(2);
    expect(lockDocumentsByEpisodeKey).toHaveBeenNthCalledWith(
      1,
      '11.111.111-1__2026-04-01',
      undefined,
      expect.objectContaining({ lockedAt: expect.any(String) })
    );
    expect(lockDocumentsByEpisodeKey).toHaveBeenNthCalledWith(
      2,
      '22.222.222-2__2026-04-15',
      'hhr',
      expect.objectContaining({ lockedAt: expect.any(String) })
    );

    // 3 lock audit events (2 + 1 locked docs) + 2 discharge audit events = 5
    expect(writeAuditEvent).toHaveBeenCalledTimes(5);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLINICAL_DOCUMENT_LOCKED',
        entityType: 'clinicalDocument',
        entityId: 'doc-a-1',
        details: expect.objectContaining({
          reason: 'episode_closed',
          dischargeStatus: 'Vivo',
          episodeKey: '11.111.111-1__2026-04-01',
        }),
      })
    );
  });

  it('skips lock for entries without an episodeKey', async () => {
    const lockDocumentsByEpisodeKey = vi.fn();
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });

    await dispatchCanonicalDischarge(validInput(), {
      writeAuditEvent,
      lockDocumentsByEpisodeKey,
    });

    expect(lockDocumentsByEpisodeKey).not.toHaveBeenCalled();
    // Only the discharge audit event remains
    expect(writeAuditEvent).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_DISCHARGED' })
    );
  });

  it('reports degraded when document locking fails but the discharge persisted', async () => {
    const lockDocumentsByEpisodeKey = vi
      .fn()
      .mockRejectedValue(new Error('Firestore lock batch rejected'));
    const writeAuditEvent = vi
      .fn()
      .mockResolvedValue({ status: 'success', data: null, issues: [] });

    const outcome = await dispatchCanonicalDischarge(
      validInput({
        entries: [
          {
            bedId: 'R1',
            patientName: 'A',
            rut: '11.111.111-1',
            status: 'Vivo',
            episodeKey: '11.111.111-1__2026-04-01',
          },
        ],
      }),
      { writeAuditEvent, lockDocumentsByEpisodeKey }
    );

    expect(outcome.status.status).toBe('degraded');
    expect(outcome.applicationOutcome.userSafeMessage).toMatch(/bloquearse/i);
    expect(outcome.applicationOutcome.issues[0]?.message).toMatch(/lock batch rejected/i);
    // Discharge audit still fires even though lock failed
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_DISCHARGED' })
    );
  });
});
