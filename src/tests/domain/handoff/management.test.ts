// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildChecklistUpdateRecord,
  buildMedicalNoChangesRecord,
  buildMedicalSentPatch,
  buildMedicalSignatureRecord,
  buildMedicalSpecialtyNoteRecord,
  buildNovedadesUpdateRecord,
  buildResetMedicalHandoffRecord,
} from '@/domain/handoff/management';

const createRecord = (): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-03-03', {
    beds: {},
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    lastUpdated: '',
  });

describe('handoff management domain', () => {
  it('builds checklist and novedades updates immutably', () => {
    const record = createRecord();

    const checklistRecord = buildChecklistUpdateRecord(record, 'day', 'escalaBraden', true);
    const novedadesRecord = buildNovedadesUpdateRecord(record, 'night', 'Sin novedades');

    expect(checklistRecord.handoffDayChecklist?.escalaBraden).toBe(true);
    expect(novedadesRecord.handoffNovedadesNightShift).toBe('Sin novedades');
    expect(record.handoffDayChecklist?.escalaBraden).toBeUndefined();
  });

  it('builds specialty updates, no-changes confirmation, signatures and reset state', () => {
    const record = createRecord();

    const specialtyRecord = buildMedicalSpecialtyNoteRecord(record, 'cirugia', 'Paciente estable', {
      uid: 'doctor-1',
      displayName: 'Dr. Cirugía',
      email: 'cirugia@hospitalhangaroa.cl',
    });
    expect(specialtyRecord.medicalHandoffBySpecialty?.cirugia?.note).toBe('Paciente estable');

    const noChangesRecord = buildMedicalNoChangesRecord(
      specialtyRecord,
      'cirugia',
      {
        uid: 'admin-1',
        displayName: 'Admin',
        email: 'admin@hospitalhangaroa.cl',
      },
      'Condición actual sin cambios'
    );
    expect(
      noChangesRecord.medicalHandoffBySpecialty?.cirugia?.dailyContinuity?.['2026-03-03']?.status
    ).toBe('confirmed_no_changes');

    const signedRecord = buildMedicalSignatureRecord(noChangesRecord, 'Dr. Firma', 'upc');
    expect(signedRecord.medicalSignatureByScope?.upc?.doctorName).toBe('Dr. Firma');

    const sentPatch = buildMedicalSentPatch(signedRecord, 'Dr. Firma', 'upc');
    expect(sentPatch.medicalHandoffDoctor).toBe('Dr. Firma');
    expect(sentPatch.medicalHandoffSentAtByScope?.upc).toBeDefined();

    const resetRecord = buildResetMedicalHandoffRecord({
      ...signedRecord,
      medicalHandoffSentAt: '2026-03-03T10:00:00.000Z',
      medicalSignature: {
        doctorName: 'Dr. Firma',
        signedAt: '2026-03-03T10:00:00.000Z',
      },
    });
    expect(resetRecord.medicalHandoffSentAt).toBeUndefined();
    expect(resetRecord.medicalSignature).toBeUndefined();
    expect(resetRecord.medicalSignatureByScope).toEqual({});
  });
});
