import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import {
  acknowledgeDailyRecordClinicalFieldPause,
  clearDailyRecordClinicalFieldPausesForTests,
  DAILY_RECORD_CONTEXT_RESET_MESSAGE,
  DAILY_RECORD_FIELD_PAUSE_MESSAGE,
  registerDailyRecordClinicalFieldPauses,
  resolveDailyRecordClinicalPatchLockDecision,
  resolveDailyRecordClinicalPatchPauseDecision,
} from '@/hooks/controllers/dailyRecordClinicalFieldAcknowledgementController';

describe('dailyRecordClinicalFieldAcknowledgementController', () => {
  const date = '2026-05-17';
  const buildRecordWithEmptyBed = (bedId: string): DailyRecord => ({
    date,
    beds: {
      [bedId]: createEmptyPatient(bedId),
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T00:00:00.000Z`,
    activeExtraBeds: [],
  });

  beforeEach(() => {
    clearDailyRecordClinicalFieldPausesForTests();
  });

  it('allows same-group edits after successful remote confirmation without a soft pause', () => {
    registerDailyRecordClinicalFieldPauses(date, { R1: { diagnosis: true } }, 1_000);

    const diagnosisPatch = { 'beds.R1.cie10Code': 'I10' } satisfies DailyRecordPatch;

    expect(resolveDailyRecordClinicalPatchPauseDecision(date, diagnosisPatch, 1_100)).toEqual({
      kind: 'allowed',
    });
    expect(acknowledgeDailyRecordClinicalFieldPause(date, 'R1', 'diagnosis')).toBe('none');
  });

  it('allows independent clinical fields without acknowledgement', () => {
    registerDailyRecordClinicalFieldPauses(date, { R1: { diagnosis: true } }, 1_000);

    expect(
      resolveDailyRecordClinicalPatchPauseDecision(date, { 'beds.R1.status': 'Estable' }, 1_100)
    ).toEqual({ kind: 'allowed' });
  });

  it('allows first patient creation in an empty bed without consuming a recent-field pause', () => {
    registerDailyRecordClinicalFieldPauses(
      date,
      { R3: { diagnosis: true, status: true, specialty: true } },
      1_000
    );

    const admissionPatch = {
      'beds.R3.patientName': 'Paciente Nuevo',
      'beds.R3.rut': '17.752.753-K',
      'beds.R3.admissionDate': date,
      'beds.R3.pathology': 'Diagnóstico inicial',
      'beds.R3.specialty': 'Med Interna',
      'beds.R3.status': 'Estable',
    } satisfies DailyRecordPatch;

    expect(
      resolveDailyRecordClinicalPatchLockDecision(
        date,
        admissionPatch,
        { R3: { diagnosis: true, status: true, specialty: true } },
        1_100,
        { previousRecord: buildRecordWithEmptyBed('R3') }
      )
    ).toEqual({ kind: 'allowed' });
  });

  it('allows editing a newly created clinical crib without consuming a recent diagnosis pause', () => {
    registerDailyRecordClinicalFieldPauses(date, { R1: { diagnosis: true } }, 1_000);
    const previousRecord = buildRecordWithEmptyBed('R1');
    previousRecord.beds.R1.patientName = 'Madre';

    expect(
      resolveDailyRecordClinicalPatchLockDecision(
        date,
        { 'beds.R1.clinicalCrib.patientName': 'RN actualizado' },
        { R1: { diagnosis: true } },
        1_100,
        { previousRecord }
      )
    ).toEqual({ kind: 'allowed' });
  });

  it('allows clinical crib status and specialty edits when only diagnosis is paused', () => {
    registerDailyRecordClinicalFieldPauses(date, { R1: { diagnosis: true } }, 1_000);
    const previousRecord = buildRecordWithEmptyBed('R1');
    previousRecord.beds.R1.patientName = 'Madre';
    previousRecord.beds.R1.clinicalCrib = {
      ...createEmptyPatient('R1'),
      patientName: 'RN de Madre',
      bedMode: 'Cuna',
    };

    expect(
      resolveDailyRecordClinicalPatchLockDecision(
        date,
        { 'beds.R1.clinicalCrib.status': 'Estable' },
        { R1: { diagnosis: true } },
        1_100,
        { previousRecord }
      )
    ).toEqual({ kind: 'allowed' });

    expect(
      resolveDailyRecordClinicalPatchLockDecision(
        date,
        { 'beds.R1.clinicalCrib.specialty': 'Neonatología' },
        { R1: { diagnosis: true } },
        1_100,
        { previousRecord }
      )
    ).toEqual({ kind: 'allowed' });
  });

  it('does not keep an episode-level hard lock after successful remote confirmation', () => {
    registerDailyRecordClinicalFieldPauses(
      date,
      { R1: { allClinical: true, diagnosis: true } },
      1_000
    );

    expect(
      resolveDailyRecordClinicalPatchPauseDecision(date, { 'beds.R1.pathology': 'Usuario' }, 1_100)
    ).toEqual({
      kind: 'allowed',
    });
    expect(acknowledgeDailyRecordClinicalFieldPause(date, 'R1', 'diagnosis')).toBe('none');
  });

  it('keeps fallback copy free of technical sync wording', () => {
    const forbiddenTechnicalWording = [/firebase/i, /remot[oa]/i, /stale/i, /cache/i, /concurr/i];

    for (const message of [DAILY_RECORD_FIELD_PAUSE_MESSAGE, DAILY_RECORD_CONTEXT_RESET_MESSAGE]) {
      for (const pattern of forbiddenTechnicalWording) {
        expect(message).not.toMatch(pattern);
      }
    }
  });
});
