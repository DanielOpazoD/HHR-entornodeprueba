import { describe, expect, it } from 'vitest';
import { reconcileCensus } from '@/features/rayen-import/domain/reconcileCensus';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { assertAdmissionDatePersistencePolicy } from '@/services/repositories/dailyRecordAdmissionDateWritePolicy';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';

describe('reviewed bed turnover preserves each episode admission', () => {
  it('reconciles, applies and validates two occupied beds exchanging patients', () => {
    const reference = new Date('2026-10-21T18:00:00Z');
    const moving: RayenEncounter = {
      encounterId: 'episode-moving',
      run: '123456785',
      firstGivenName: 'Paciente',
      firstFamilyName: 'Sintético',
      birthDate: '1980-01-01',
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'Recuperacion 2',
      bed: 'R2',
      admissionDatetime: '2026-10-07T16:17:00-05:00',
      diagnosis: 'Diagnóstico sintético',
    };
    const other: RayenEncounter = {
      ...moving,
      encounterId: 'episode-other',
      run: '111111111',
      firstFamilyName: 'Diferente',
      room: 'H4',
      bed: 'C2',
      admissionDatetime: '2026-10-17T19:38:00-05:00',
    };
    const movedPatient = rayenToPatientData(moving, reference).patient;
    const otherPatient = rayenToPatientData(other, reference).patient;
    const current = DataFactory.createMockDailyRecord('2026-10-21', {
      beds: {
        H4C2: { ...movedPatient, bedId: 'H4C2', location: 'H4C2', handoffNote: 'Conservar' },
        R2: { ...otherPatient, bedId: 'R2', location: 'R2', firstSeenDate: '2026-10-17' },
      },
    });
    const diff = reconcileCensus(
      current,
      {
        capturedAt: reference.toISOString(),
        facilityId: 1342,
        isComplete: true,
        encounters: [moving, other],
      },
      { reference }
    );
    expect(diff.summary.moves).toBe(2);
    const applied = applyCensusImportDiff(current, diff, {
      now: reference,
      idFactory: () => 'synthetic-movement',
      syncRunId: 'synthetic-run',
    });
    expect(applied.skipped).toEqual([]);
    expect(applied.record.beds.R2).toMatchObject({
      clinicalEpisodeId: 'episode-moving',
      admissionDate: '2026-10-07',
      admissionTime: '16:17',
      handoffNote: 'Conservar',
    });
    expect(applied.record.beds.H4C2).toMatchObject({
      clinicalEpisodeId: 'episode-other',
      admissionDate: '2026-10-17',
      admissionTime: '19:38',
      firstSeenDate: '2026-10-17',
    });
    expect(() =>
      assertAdmissionDatePersistencePolicy(current.date, applied.record, current)
    ).not.toThrow();
  });
});
