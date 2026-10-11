// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildHandoffNovedadesAuditEvent,
  buildHandoffNovedadesAuditPayload,
  buildMedicalNoChangesAuditEvent,
  buildMedicalSignatureAuditEvent,
  buildMedicalNoChangesAuditPayload,
  buildMedicalSignatureAuditPayload,
  buildMedicalSpecialtyAuditEvent,
  buildMedicalSpecialtyNoteAuditPayload,
  buildResetMedicalHandoffAuditEvent,
  buildResetMedicalHandoffAuditPayload,
} from '@/hooks/controllers/handoffManagementPersistenceController';
import { buildUpdatedHandoffStaffRecord } from '@/domain/handoff/management';
import {
  executeUpdateMedicalHandoffDoctor,
  executeUpdateHandoffStaff,
  executeUpdateMedicalSpecialtyNote,
  executeConfirmMedicalSpecialtyNoChanges,
} from '@/application/handoff/handoffManagementUseCases';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const baseRecord = (): DailyRecord =>
  ({
    date: '2026-03-07',
    handoffNovedadesDayShift: 'Antes día',
    handoffNovedadesNightShift: 'Antes noche',
    medicalHandoffNovedades: 'Antes medica',
    medicalHandoffBySpecialty: {
      cirugia: {
        note: 'Nota previa',
        version: 2,
        updatedAt: '2026-03-06T10:00:00.000Z',
        author: {
          uid: 'doctor-1',
          displayName: 'Dr. Cirugía',
          email: 'cirugia@hospital.cl',
        },
      },
    },
    nursesDayShift: ['Dia 1'],
    nursesNightShift: ['Noche 1'],
    tensDayShift: ['Tens Día'],
    tensNightShift: ['Tens Noche'],
    handoffNightReceives: ['Recibe Noche'],
    medicalHandoffDoctor: 'Dr. Test',
    medicalSignature: 'Dr. Legacy',
    medicalSignatureByScope: {
      all: { doctorName: 'Dr. Test', signedAt: '2026-03-07T09:00:00.000Z' },
    },
    medicalHandoffSentAt: '2026-03-07T09:05:00.000Z',
    medicalHandoffSentAtByScope: { all: '2026-03-07T09:05:00.000Z' },
  }) as unknown as DailyRecord;

describe('handoffManagementPersistenceController', () => {
  it('builds novedades payloads using the previous content', () => {
    const payload = buildHandoffNovedadesAuditPayload(baseRecord(), 'day', 'Texto nuevo', 'u1');
    const auditEvent = buildHandoffNovedadesAuditEvent(baseRecord(), 'day', 'Texto nuevo', 'u1');

    expect(payload.details).toEqual(
      expect.objectContaining({
        shift: 'day',
        content: 'Texto nuevo',
        changes: {
          novedades: { old: 'Antes día', new: 'Texto nuevo' },
        },
      })
    );
    expect(auditEvent).toEqual(
      expect.objectContaining({
        action: 'HANDOFF_NOVEDADES_MODIFIED',
        entityId: '2026-03-07',
        authors: expect.any(String),
      })
    );
  });

  it('builds specialty note payloads from the current record', () => {
    expect(buildMedicalSpecialtyNoteAuditPayload(baseRecord(), 'cirugia', 'Nueva nota')).toEqual(
      expect.objectContaining({
        specialty: 'cirugia',
        operation: 'specialty_note_update',
        changes: {
          novedades: { old: 'Nota previa', new: 'Nueva nota' },
        },
      })
    );
    expect(buildMedicalSpecialtyAuditEvent(baseRecord(), 'cirugia', 'Nueva nota')).toEqual(
      expect.objectContaining({
        action: 'HANDOFF_NOVEDADES_MODIFIED',
        entityId: '2026-03-07',
      })
    );
  });

  it('updates staff using canonical shift fields', () => {
    const updated = buildUpdatedHandoffStaffRecord(baseRecord(), 'night', 'receives', [
      'Recibe A',
      'Recibe B',
    ]);

    expect(updated.handoffNightReceives).toEqual(['Recibe A', 'Recibe B']);
    expect(updated.lastUpdated).toBeTypeOf('string');
  });

  it('builds no changes, signature and reset payloads consistently', () => {
    const updatedRecord = {
      ...baseRecord(),
      medicalHandoffBySpecialty: {
        cirugia: {
          ...baseRecord().medicalHandoffBySpecialty!.cirugia,
          dailyContinuity: {
            '2026-03-07': { status: 'confirmed_no_changes', comment: 'Sin cambios' },
          },
        },
      },
    } as DailyRecord;

    expect(
      buildMedicalNoChangesAuditPayload(
        updatedRecord,
        'cirugia',
        { displayName: 'Admin', specialty: 'cirugia' },
        '2026-03-07',
        '2026-03-07T10:00:00.000Z'
      )
    ).toEqual(
      expect.objectContaining({
        operation: 'confirm_no_changes',
        comment: 'Sin cambios',
      })
    );
    expect(
      buildMedicalNoChangesAuditEvent(baseRecord(), { operation: 'confirm_no_changes' })
    ).toEqual(
      expect.objectContaining({
        action: 'HANDOFF_NOVEDADES_MODIFIED',
        entityId: '2026-03-07',
      })
    );

    expect(buildMedicalSignatureAuditPayload(updatedRecord, 'Dr. Test', 'all')).toEqual({
      doctorName: 'Dr. Test',
      signedAt: '2026-03-07T09:00:00.000Z',
      scope: 'all',
    });
    expect(buildMedicalSignatureAuditEvent(baseRecord(), updatedRecord, 'Dr. Test', 'all')).toEqual(
      expect.objectContaining({
        action: 'MEDICAL_HANDOFF_SIGNED',
        entityId: '2026-03-07',
      })
    );

    expect(buildResetMedicalHandoffAuditPayload(baseRecord())).toEqual(
      expect.objectContaining({
        clearedFields: ['entrega', 'firma'],
        hadMedicalHandoffSentAt: true,
        hadMedicalSignature: true,
      })
    );
    expect(buildResetMedicalHandoffAuditEvent(baseRecord())).toEqual(
      expect.objectContaining({
        action: 'MEDICAL_HANDOFF_RESTORED',
        entityId: '2026-03-07',
      })
    );
  });

  it('persists the handoff doctor through the canonical use case', async () => {
    const saveRecord = vi.fn();
    const outcome = await executeUpdateMedicalHandoffDoctor({
      record: baseRecord(),
      doctorName: 'Dr. Nuevo',
      saveRecord,
    });
    expect(outcome.data?.updatedRecord.medicalHandoffDoctor).toBe('Dr. Nuevo');
    expect(outcome.data?.updatedRecord.lastUpdated).toBeTypeOf('string');
    expect(saveRecord).toHaveBeenCalledWith(outcome.data?.updatedRecord);
  });

  it('persists the canonical staff shift fields', async () => {
    const saveRecord = vi.fn();
    const outcome = await executeUpdateHandoffStaff({
      record: baseRecord(),
      shift: 'day',
      type: 'receives',
      staffList: ['Recibe Día'],
      saveRecord,
    });
    expect(outcome.data?.updatedRecord.nursesNightShift).toEqual(['Recibe Día']);
    expect(saveRecord).toHaveBeenCalledWith(outcome.data?.updatedRecord);
  });

  it('persists specialty notes and preserves their audit details', async () => {
    const saveRecord = vi.fn();
    const record = baseRecord();
    const outcome = await executeUpdateMedicalSpecialtyNote({
      record,
      specialty: 'cirugia',
      value: 'Nueva nota',
      actor: { displayName: 'Dr. Test', email: 'dr@test.cl' },
      saveRecord,
    });
    expect(outcome.data?.updatedRecord.medicalHandoffBySpecialty?.cirugia?.note).toBe('Nueva nota');
    expect(saveRecord).toHaveBeenCalledWith(outcome.data?.updatedRecord);
    expect(buildMedicalSpecialtyAuditEvent(record, 'cirugia', 'Nueva nota').details).toEqual(
      expect.objectContaining({ specialty: 'cirugia', operation: 'specialty_note_update' })
    );
  });

  it('persists continuity with its effective date and audit details', async () => {
    const saveRecord = vi.fn();
    const actor = { displayName: 'Dra. Test', email: 'dra@test.cl' };
    const outcome = await executeConfirmMedicalSpecialtyNoChanges({
      record: baseRecord(),
      specialty: 'cirugia',
      actor,
      comment: 'Sin cambios',
      dateKey: '2026-03-08',
      saveRecord,
    });
    const data = outcome.data!;
    expect(data.effectiveDateKey).toBe('2026-03-08');
    expect(
      data.updatedRecord.medicalHandoffBySpecialty?.cirugia?.dailyContinuity?.['2026-03-08']?.status
    ).toBe('confirmed_no_changes');
    expect(saveRecord).toHaveBeenCalledWith(data.updatedRecord);
    expect(
      buildMedicalNoChangesAuditPayload(
        data.updatedRecord,
        'cirugia',
        actor,
        data.effectiveDateKey,
        data.confirmedAt
      )
    ).toEqual(expect.objectContaining({ specialty: 'cirugia', operation: 'confirm_no_changes' }));
  });
});
