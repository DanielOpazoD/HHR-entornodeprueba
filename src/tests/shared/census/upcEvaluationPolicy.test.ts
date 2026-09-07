import { describe, it, expect } from 'vitest';
import {
  resolveUpcReviewReason,
  assignedUpcNurses,
  resolveUpcEmailBlockReason,
} from '@/shared/census/upcEvaluationPolicy';
import { normalizePatientUpcForBed, resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';
import { preparePatientForCarryover } from '@/services/repositories/dailyRecordClinicalDomainService';
import { parsePatientDataWithDefaults } from '@/schemas/zodSchemas';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildMovePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { buildMoveOrCopyPatch } from '@/hooks/useBedOperationsController';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const checklist: UpcChecklistRecord = {
  uciCriteria: [],
  utiCriteria: [],
  classification: null,
  evaluatedAt: '2026-09-04T12:00:00Z',
  evaluatedForDate: '2026-09-04',
  evaluatedBedId: 'R1',
  evaluatedBy: { uid: 'test', displayName: 'Cuenta de prueba' },
  responsibleNurse: { name: 'Enfermera A', shift: 'day', source: 'assigned' },
};

describe('UPC daily and movement review policy', () => {
  it.each(['R1', 'R2', 'R3', 'R4', 'NEO1', 'NEO2'])(
    'deactivates UPC from %s in medium beds without losing audit or blocking email',
    bedId => {
      const original = {
        ...checklist,
        evaluatedBedId: bedId,
        classification: 'UPC_UTI' as const,
        utiCriteria: ['uti_mon_cardiaca' as const],
      };
      const patient = {
        bedId,
        patientName: 'Paciente de prueba',
        isUPC: true,
        upcChecklist: original,
      };
      const moved = normalizePatientUpcForBed(patient, 'H6C2');
      expect(moved.isUPC).toBe(false);
      expect(resolveEffectiveUpcState({ ...moved, checklist: moved.upcChecklist })).toEqual({
        classification: null,
        isUpc: false,
      });
      expect(moved.upcChecklist).toEqual({ ...original, reviewRequired: true });
      expect(resolveUpcReviewReason(moved.upcChecklist, 'H6C2', '2026-09-04')).toBeNull();
      expect(
        resolveUpcEmailBlockReason({ date: '2026-09-04', beds: { H6C2: moved } }, '2026-09-04')
      ).toBeNull();
      const returned = normalizePatientUpcForBed(moved, bedId);
      expect(resolveUpcReviewReason(returned.upcChecklist, bedId, '2026-09-04')).toMatch(
        /cambio de cama/
      );
      expect(patient.upcChecklist).toBe(original);
      expect(original.reviewRequired).toBeUndefined();
    }
  );
  it.each(['R1', 'R2', 'R3', 'R4', 'NEO1', 'NEO2'])('requires a review in %s', bed => {
    expect(resolveUpcReviewReason(undefined, bed, '2026-09-04')).toMatch(/pendiente/);
  });
  it.each(['H1C1', 'H5C1', 'EXTRA1'])('does not extend the scope to %s', bed => {
    expect(resolveUpcReviewReason(undefined, bed, '2026-09-04')).toBeNull();
  });
  it('accepts a completed No UPC evaluation, but not one copied to the following day', () => {
    expect(resolveUpcReviewReason(checklist, 'R1', '2026-09-04')).toBeNull();
    expect(resolveUpcReviewReason(checklist, 'R1', '2026-09-05')).toMatch(/diaria/);
  });
  it.each([
    { evaluatedBy: undefined },
    { evaluatedAt: 'bad' },
    { evaluatedBedId: undefined },
    { responsibleNurse: undefined },
    { evaluatedForDate: undefined },
  ])('keeps legacy or incomplete reviews pending: %j', patch => {
    expect(resolveUpcReviewReason({ ...checklist, ...patch }, 'R1', '2026-09-04')).not.toBeNull();
  });
  it('retains criteria and audit, but invalidates a move out AND back', () => {
    const patient = { bedId: 'R1', isUPC: false, upcChecklist: checklist };
    expect(normalizePatientUpcForBed(patient, 'R1')).toBe(patient);
    const moved = normalizePatientUpcForBed(patient, 'R2');
    const returned = normalizePatientUpcForBed(moved, 'R1');
    expect(returned.upcChecklist).toEqual({ ...checklist, reviewRequired: true });
    expect(resolveUpcReviewReason(returned.upcChecklist, 'R1', '2026-09-04')).toMatch(
      /cambio de cama/
    );
  });
  it('preserves metadata through storage parsing and daily carryover', () => {
    const patient = DataFactory.createMockPatient('R1', { upcChecklist: checklist });
    const reloaded = parsePatientDataWithDefaults(JSON.parse(JSON.stringify(patient)), 'R1');
    expect(reloaded.upcChecklist).toEqual(checklist);
    const carried = preparePatientForCarryover(reloaded);
    expect(carried.upcChecklist).toEqual(checklist);
    expect(resolveUpcReviewReason(carried.upcChecklist, 'R1', '2026-09-05')).not.toBeNull();
  });
  it('preserves valid UPC audit if an unrelated invalid field triggers patient recovery', () => {
    const patient = DataFactory.createMockPatient('R1', { upcChecklist: checklist });
    const recovered = parsePatientDataWithDefaults({ ...patient, bedMode: 'Adulto' }, 'R1');
    expect(recovered.upcChecklist).toEqual(checklist);
    expect(resolveUpcReviewReason(recovered.upcChecklist, 'R1', '2026-09-04')).toBeNull();
  });
  it('invalidates the attached crib review without overwriting the parent evaluation', () => {
    const patient = {
      bedId: 'R1',
      isUPC: false,
      upcChecklist: checklist,
      clinicalCrib: {
        bedId: 'R1',
        isUPC: false,
        upcChecklist: { ...checklist, evaluatedBy: { uid: 'crib-account', displayName: 'Prueba' } },
      },
    };
    const moved = normalizePatientUpcForBed(patient, 'R2');
    expect(moved.clinicalCrib.bedId).toBe('R2');
    expect(moved.clinicalCrib.upcChecklist.reviewRequired).toBe(true);
    expect(moved.clinicalCrib.upcChecklist.evaluatedBy.uid).toBe('crib-account');
    expect(moved.upcChecklist.evaluatedBy?.uid).toBe('test');
  });
  it.each([
    buildMovePatientPatches,
    (record: DailyRecord, from: string, to: string) =>
      buildMoveOrCopyPatch(record, 'move', from, to),
  ])('invalidates through each manual movement entry point', build => {
    const record = DataFactory.createMockDailyRecord('2026-09-04');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente de prueba',
      upcChecklist: checklist,
    });
    record.beds.R2 = DataFactory.createMockPatient('R2', { patientName: '' });
    const patch = build(record, 'R1', 'R2');
    expect(patch?.['beds.R2']).toMatchObject({
      bedId: 'R2',
      upcChecklist: { reviewRequired: true },
    });
  });
  it('normalizes assigned nurse options without inventing staff', () => {
    expect(assignedUpcNurses([' ', 'Vacante', ' Enfermera A ', 'Enfermera A'])).toEqual([
      'Enfermera A',
    ]);
  });
});
