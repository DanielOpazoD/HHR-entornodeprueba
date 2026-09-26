import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import {
  historicalMonthRange, summarizeCurrentDiagnoses, summarizeHistoricalAssociations,
} from '@/features/census/components/specialty-round/specialtyRulesHistoryModel';

const patient = (overrides: Partial<PatientData>): PatientData => ({
  patientName: 'Paciente sintético', isBlocked: false, cie10Code: 'J18.9',
  cie10Description: 'Neumonía', specialty: 'Med Interna', ...overrides,
} as PatientData);
const record = (date: string, beds: Record<string, PatientData>): DailyRecord =>
  ({ date, beds } as DailyRecord);

describe('specialty rule diagnosis sources', () => {
  it('groups current hospitalised mother and clinical crib diagnoses, excluding empty beds', () => {
    const result = summarizeCurrentDiagnoses({
      R1: patient({ clinicalCrib: patient({ cie10Code: 'F23', specialty: '' }) }),
      R2: patient({ patientName: '', cie10Code: 'A00' }),
      R3: patient({ cie10Code: 'j18.9', specialty: 'Pediatría' }),
    });
    expect(result).toEqual([
      expect.objectContaining({ code: 'F23', patients: 1, suggestedSpecialty: '' }),
      expect.objectContaining({ code: 'J18.9', patients: 2, suggestedSpecialty: '' }),
    ]);
  });

  it('keeps conflicting historical pairings separate without exposing patient identity', () => {
    const result = summarizeHistoricalAssociations([
      record('2026-09-10', { R1: patient({ specialty: 'Med Interna' }) }),
      record('2026-09-11', { R1: patient({ specialty: 'Pediatría' }),
        R2: patient({ specialty: 'Med Interna' }) }),
    ]);
    expect(result).toEqual([
      { code: 'J18.9', specialty: 'Med Interna', observations: 2, lastDate: '2026-09-11' },
      { code: 'J18.9', specialty: 'Pediatría', observations: 1, lastDate: '2026-09-11' },
    ]);
    expect(JSON.stringify(result)).not.toContain('Paciente sintético');
  });

  it('reads at most one completed month and excludes the current clinical day', () => {
    expect(historicalMonthRange('2026-09', '2026-09-24')).toEqual({
      start: '2026-09-01', end: '2026-09-23',
    });
    expect(historicalMonthRange('2026-08', '2026-09-24')).toEqual({
      start: '2026-08-01', end: '2026-08-31',
    });
    expect(historicalMonthRange('2026-09', '2026-09-01')).toBeNull();
    expect(historicalMonthRange('2026-10', '2026-09-24')).toBeNull();
  });
});
