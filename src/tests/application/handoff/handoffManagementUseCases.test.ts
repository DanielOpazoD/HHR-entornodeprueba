import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  executeConfirmMedicalSpecialtyNoChanges,
  executeEnsureMedicalHandoffSignatureLink,
  executeMarkMedicalHandoffAsSent,
} from '@/application/handoff';

const createRecord = (): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-03-15', {
    beds: {},
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    medicalHandoffDoctor: 'Dr. Handoff',
    medicalHandoffBySpecialty: {
      cirugia: {
        note: 'Paciente estable',
        createdAt: '2026-03-10T10:00:00.000Z',
        updatedAt: '2026-03-14T10:00:00.000Z',
        author: {
          uid: 'doctor-1',
          displayName: 'Dr. Cirugía',
          email: 'cirugia@hospital.cl',
        },
        version: 1,
      },
    },
    lastUpdated: '2026-03-15T08:00:00.000Z',
  });

describe('handoffManagementUseCases', () => {
  it('returns a validation outcome when continuity confirmation has no base note', async () => {
    const record = createRecord();
    delete record.medicalHandoffBySpecialty?.cirugia;

    const outcome = await executeConfirmMedicalSpecialtyNoChanges({
      actor: { displayName: 'Admin' },
      record,
      saveRecord: vi.fn().mockResolvedValue(undefined),
      specialty: 'cirugia',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('missing_base_note');
    expect(outcome.userSafeMessage).toContain('Primero debe existir');
  });

  it('returns a validation outcome when specialty was already updated today', async () => {
    const record = createRecord();
    record.medicalHandoffBySpecialty!.cirugia!.updatedAt = '2026-03-15T07:00:00.000Z';

    const outcome = await executeConfirmMedicalSpecialtyNoChanges({
      actor: { displayName: 'Admin' },
      record,
      saveRecord: vi.fn().mockResolvedValue(undefined),
      specialty: 'cirugia',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('already_updated_today');
    expect(outcome.userSafeMessage).toContain('ya fue actualizada hoy');
  });

  it('creates and persists a scoped signature token when none exists', async () => {
    const patchRecord = vi.fn().mockResolvedValue(undefined);

    const outcome = await executeEnsureMedicalHandoffSignatureLink({
      patchRecord,
      record: createRecord(),
      scope: 'upc',
    });

    expect(outcome.status).toBe('success');
    expect(outcome.data?.tokenStatus).toBe('created');
    expect(outcome.data?.handoffUrl).toContain('mode=signature');
    expect(outcome.data?.handoffUrl).toContain('scope=upc');
    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        medicalSignatureLinkTokenByScope: expect.objectContaining({
          upc: expect.any(String),
        }),
      })
    );
  });

  it('reuses an existing signature token without patching', async () => {
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const record = createRecord();
    record.medicalSignatureLinkTokenByScope = { all: 'token-existente' };

    const outcome = await executeEnsureMedicalHandoffSignatureLink({
      patchRecord,
      record,
      scope: 'all',
    });

    expect(outcome.status).toBe('success');
    expect(outcome.data?.tokenStatus).toBe('existing');
    expect(outcome.data?.handoffUrl).toContain('token=token-existente');
    expect(patchRecord).not.toHaveBeenCalled();
  });

  it('marks the medical handoff as sent through a patch outcome', async () => {
    const patchRecord = vi.fn().mockResolvedValue(undefined);

    const outcome = await executeMarkMedicalHandoffAsSent({
      doctorName: 'Dra. Turno',
      patchRecord,
      record: createRecord(),
      scope: 'no-upc',
    });

    expect(outcome.status).toBe('success');
    expect(outcome.data?.doctorName).toBe('Dra. Turno');
    expect(outcome.data?.patch.medicalHandoffSentAtByScope?.['no-upc']).toBeDefined();
    expect(outcome.data?.nextRecord.medicalHandoffDoctor).toBe('Dra. Turno');
    expect(patchRecord).toHaveBeenCalled();
  });
});
