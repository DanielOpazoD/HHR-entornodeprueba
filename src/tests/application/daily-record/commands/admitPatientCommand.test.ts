import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  executeAdmitPatientCommand,
  validateAdmitPatientInput,
  type AdmitPatientInput,
  type AdmitPatientPort,
  type AdmittedPatientSnapshot,
} from '@/application/daily-record/commands/admitPatientCommand';
import { createApplicationSuccess } from '@/shared/contracts/applicationOutcomeFactories';
import type { executeWriteAuditEvent as ExecuteWriteAuditEventType } from '@/application/audit/writeAuditEventUseCase';

type WriteAuditEventFn = typeof ExecuteWriteAuditEventType;

const validInput = (overrides: Partial<AdmitPatientInput> = {}): AdmitPatientInput => ({
  bedId: 'H5C1',
  patientName: 'Paciente Demo',
  rut: '11.111.111-1',
  pathology: 'Diagnóstico demo',
  admissionDate: '2026-05-03',
  recordDate: '2026-05-03',
  actor: 'nurse@hospital.cl',
  ...overrides,
});

const buildPort = (override?: Partial<AdmitPatientPort>): AdmitPatientPort => ({
  persistAdmission: vi.fn(
    async (input: AdmitPatientInput): Promise<AdmittedPatientSnapshot> => ({
      bedId: input.bedId,
      patientName: input.patientName,
      rut: input.rut,
      admissionDate: input.admissionDate,
      recordDate: input.recordDate,
      clinicalEpisodeId: input.clinicalEpisodeId ?? '',
    })
  ),
  ...override,
});

describe('validateAdmitPatientInput', () => {
  it('accepts a fully populated valid input', () => {
    expect(validateAdmitPatientInput(validInput())).toEqual({ ok: true });
  });

  it.each([
    ['bedId', { bedId: '' }],
    ['patientName', { patientName: '   ' }],
    ['rut', { rut: '' }],
    ['admissionDate', { admissionDate: '' }],
    ['recordDate', { recordDate: '' }],
  ] as const)('flags missing %s with the field name', (field, override) => {
    const result = validateAdmitPatientInput(validInput(override));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe(field);
    }
  });
});

describe('executeAdmitPatientCommand', () => {
  let writeAuditEvent: WriteAuditEventFn;

  beforeEach(() => {
    writeAuditEvent = vi
      .fn()
      .mockResolvedValue(createApplicationSuccess(null)) as unknown as WriteAuditEventFn;
  });

  it('blocks the admission when the actor is anonymous and never persists or audits', async () => {
    const port = buildPort();

    const outcome = await executeAdmitPatientCommand(validInput({ actor: 'anon' }), {
      port,
      writeAuditEvent,
    });

    expect(outcome.status.status).toBe('blocked');
    expect(outcome.status.severity).toBe('warning');
    expect(outcome.status.blocking).toBe(true);
    expect(outcome.applicationOutcome.status).toBe('failed');
    expect(outcome.applicationOutcome.issues[0]?.kind).toBe('permission');
    expect(port.persistAdmission).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it('blocks the admission when validation fails (e.g. empty bedId) and never persists', async () => {
    const port = buildPort();

    const outcome = await executeAdmitPatientCommand(validInput({ bedId: '' }), {
      port,
      writeAuditEvent,
    });

    expect(outcome.status.status).toBe('blocked');
    expect(outcome.applicationOutcome.status).toBe('failed');
    expect(outcome.applicationOutcome.issues[0]?.kind).toBe('validation');
    expect(outcome.applicationOutcome.issues[0]?.technicalContext).toMatchObject({
      field: 'bedId',
    });
    expect(port.persistAdmission).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it('returns failed when the persistence port throws and does not write the audit event', async () => {
    const port = buildPort({
      persistAdmission: vi.fn().mockRejectedValueOnce(new Error('Firestore offline')),
    });

    const outcome = await executeAdmitPatientCommand(validInput(), {
      port,
      writeAuditEvent,
    });

    expect(outcome.status.status).toBe('failed');
    expect(outcome.status.severity).toBe('error');
    expect(outcome.applicationOutcome.status).toBe('failed');
    expect(outcome.applicationOutcome.issues[0]?.kind).toBe('unknown');
    expect(outcome.applicationOutcome.issues[0]?.message).toBe('Firestore offline');
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it('returns ready with the persisted snapshot and writes the audit event with the actor', async () => {
    const port = buildPort();

    const outcome = await executeAdmitPatientCommand(validInput(), {
      port,
      writeAuditEvent,
    });

    expect(outcome.status.status).toBe('ready');
    expect(outcome.status.terminal).toBe(true);
    expect(outcome.status.severity).toBe('ok');
    expect(outcome.patient).toMatchObject({
      bedId: 'H5C1',
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
    });
    expect(outcome.applicationOutcome.status).toBe('success');
    expect(port.persistAdmission).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'nurse@hospital.cl',
        action: 'PATIENT_ADMITTED',
        entityType: 'patient',
        entityId: 'H5C1',
        patientRut: '11.111.111-1',
        recordDate: '2026-05-03',
        details: expect.objectContaining({
          patientName: 'Paciente Demo',
          bedId: 'H5C1',
          rut: '11.111.111-1',
          clinicalEpisodeId: expect.stringMatching(/^ep_/),
        }),
      })
    );
  });

  it('generates a clinicalEpisodeId before persistence and audit', async () => {
    const port = buildPort();

    const outcome = await executeAdmitPatientCommand(validInput(), {
      port,
      writeAuditEvent,
      createClinicalEpisodeId: () => 'admission-id',
    });

    expect(port.persistAdmission).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicalEpisodeId: 'ep_admission-id',
      })
    );
    expect(outcome.patient?.clinicalEpisodeId).toBe('ep_admission-id');
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          clinicalEpisodeId: 'ep_admission-id',
        }),
      })
    );
  });

  it('returns degraded when persistence succeeds but the audit event is rejected', async () => {
    const port = buildPort();
    writeAuditEvent = vi.fn().mockResolvedValue({
      status: 'failed',
      data: null,
      issues: [{ kind: 'permission', message: 'Audit rejected' }],
    }) as unknown as WriteAuditEventFn;

    const outcome = await executeAdmitPatientCommand(validInput(), {
      port,
      writeAuditEvent,
    });

    expect(outcome.status.status).toBe('degraded');
    expect(outcome.status.severity).toBe('warning');
    expect(outcome.patient).not.toBeNull();
    expect(outcome.applicationOutcome.status).toBe('degraded');
    expect(outcome.applicationOutcome.issues[0]?.message).toBe('Audit rejected');
    expect(outcome.applicationOutcome.userSafeMessage).toMatch(/auditoría/i);
  });
});
