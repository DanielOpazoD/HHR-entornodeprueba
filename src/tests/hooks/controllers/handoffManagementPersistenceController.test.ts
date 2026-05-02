import { describe, expect, it } from 'vitest';
import {
  buildHandoffNovedadesAuditEvent,
  buildHandoffNovedadesAuditPayload,
  buildMedicalNoChangesAuditEvent,
  buildMedicalHandoffDoctorPersistencePayload,
  buildMedicalSignatureAuditEvent,
  buildMedicalNoChangesAuditPayload,
  buildMedicalNoChangesPersistencePayload,
  buildMedicalSignatureAuditPayload,
  buildMedicalSpecialtyAuditEvent,
  buildMedicalSpecialtyNoteAuditPayload,
  buildMedicalSpecialtyPersistencePayload,
  buildResetMedicalHandoffAuditEvent,
  buildResetMedicalHandoffAuditPayload,
  buildUpdatedHandoffStaffPersistencePayload,
  buildUpdatedMedicalHandoffDoctorRecord,
  buildUpdatedHandoffStaffRecord,
} from '@/hooks/controllers/handoffManagementPersistenceController';
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

  it('updates the handoff doctor through a pure record builder', () => {
    const updated = buildUpdatedMedicalHandoffDoctorRecord(baseRecord(), 'Dr. Nuevo');

    expect(updated.medicalHandoffDoctor).toBe('Dr. Nuevo');
    expect(updated.lastUpdated).toBeTypeOf('string');
  });

  it('builds persistence payload helpers for staff and doctor updates', () => {
    const staffPayload = buildUpdatedHandoffStaffPersistencePayload(
      baseRecord(),
      'day',
      'receives',
      ['Recibe Día']
    );
    expect(staffPayload.updatedRecord.nursesNightShift).toEqual(['Recibe Día']);

    const doctorPayload = buildMedicalHandoffDoctorPersistencePayload(baseRecord(), 'Dr. Nuevo');
    expect(doctorPayload.updatedRecord.medicalHandoffDoctor).toBe('Dr. Nuevo');
    expect(doctorPayload.updatedRecord.lastUpdated).toBeTypeOf('string');
  });

  it('builds specialty persistence payload with updated record and audit details', () => {
    const payload = buildMedicalSpecialtyPersistencePayload(baseRecord(), 'cirugia', 'Nueva nota', {
      displayName: 'Dr. Test',
      email: 'dr@test.cl',
    });

    expect(payload.updatedRecord.medicalHandoffBySpecialty?.cirugia?.note).toBe('Nueva nota');
    expect(payload.auditDetails).toEqual(
      expect.objectContaining({
        specialty: 'cirugia',
        operation: 'specialty_note_update',
      })
    );
  });

  it('builds no-changes persistence payload with effective date and continuity update', () => {
    const payload = buildMedicalNoChangesPersistencePayload(baseRecord(), {
      specialty: 'cirugia',
      actor: { displayName: 'Dra. Test', email: 'dra@test.cl' },
      comment: 'Sin cambios',
      dateKey: '2026-03-08',
    });

    expect(payload.effectiveDateKey).toBe('2026-03-08');
    expect(
      payload.updatedRecord.medicalHandoffBySpecialty?.cirugia?.dailyContinuity?.['2026-03-08']
        ?.status
    ).toBe('confirmed_no_changes');
    expect(payload.auditDetails).toEqual(
      expect.objectContaining({
        specialty: 'cirugia',
        operation: 'confirm_no_changes',
      })
    );
  });
});
