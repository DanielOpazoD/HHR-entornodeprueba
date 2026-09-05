import { describe, expect, it } from 'vitest';
import {
  resolveUpcEmailBlockReason,
  resolveUpcReviewReason,
} from '@/shared/census/upcEvaluationPolicy';
import { DataFactory } from '@/tests/factories/DataFactory';
import { parsePatientDataWithDefaults } from '@/schemas/zodSchemas';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';

const date = '2026-09-04';
const evaluation = (bedId = 'R1'): UpcChecklistRecord => ({
  uciCriteria: [],
  utiCriteria: [],
  classification: null,
  evaluatedAt: '2026-09-04T09:00:00Z',
  evaluatedForDate: date,
  evaluatedBedId: bedId,
  evaluatedBy: { uid: 'test', displayName: 'Cuenta de prueba' },
  responsibleNurse: { name: 'Enfermera de prueba', source: 'assigned' },
});
const patient = (bedId: string, completed = false) =>
  DataFactory.createMockPatient(bedId, {
    patientName: 'Paciente sintético',
    upcChecklist: completed ? evaluation(bedId) : undefined,
  });

describe('UPC email gate', () => {
  it.each(['R1', 'R2', 'R3', 'R4', 'NEO1', 'NEO2'])(
    'blocks an occupied %s with no daily review',
    bedId => {
      expect(
        resolveUpcEmailBlockReason({ date, beds: { [bedId]: patient(bedId) } }, date)
      ).toContain(bedId);
    }
  );
  it('ignores empty beds and occupied beds outside the UPC scope', () => {
    expect(
      resolveUpcEmailBlockReason(
        {
          date,
          beds: {
            R1: DataFactory.createMockPatient('R1', { patientName: '', isBlocked: true }),
            H1C1: patient('H1C1'),
          },
        },
        date
      )
    ).toBeNull();
  });
  it('accepts No UPC without a shift and preserves it through storage parsing', () => {
    const reloaded = parsePatientDataWithDefaults(patient('R1', true), 'R1');
    expect(reloaded.upcChecklist).toEqual(evaluation());
    expect(resolveUpcEmailBlockReason({ date, beds: { R1: reloaded } }, date)).toBeNull();
    expect(resolveUpcReviewReason(reloaded.upcChecklist, 'R1', date)).toBeNull();
    expect(resolveUpcReviewReason(reloaded.upcChecklist, 'R1', '2026-09-05')).toContain('diaria');
  });
  it.each([
    { evaluatedForDate: '2026-09-03' },
    { reviewRequired: true },
    { evaluatedBedId: 'R2' },
    { responsibleNurse: undefined },
  ])('blocks stale, moved or incomplete evaluations: %j', patch => {
    const current = { ...patient('R1', true), upcChecklist: { ...evaluation(), ...patch } };
    expect(resolveUpcEmailBlockReason({ date, beds: { R1: current } }, date)).toContain('R1');
  });
  it('requires the clinical crib independently without exposing patient identifiers', () => {
    const mother = { ...patient('R1', true), clinicalCrib: patient('R1') };
    const reason = resolveUpcEmailBlockReason({ date, beds: { R1: mother } }, date);
    expect(reason).toContain('R1 (cuna clínica)');
    expect(reason).not.toContain('Paciente sintético');
    mother.clinicalCrib = patient('R1', true);
    expect(resolveUpcEmailBlockReason({ date, beds: { R1: mother } }, date)).toBeNull();
  });
  it('rejects a different selected day', () => {
    expect(resolveUpcEmailBlockReason({ date, beds: {} }, '2026-09-05')).toContain('fecha');
  });
});
