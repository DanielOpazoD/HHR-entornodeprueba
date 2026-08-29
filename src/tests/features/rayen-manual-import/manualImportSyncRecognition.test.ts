import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  reconcileCensus,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('automatic sync after an Eloísa code import', () => {
  it('recognizes the episode, enriches it and preserves its original provenance', () => {
    const reference = new Date(2026, 6, 8);
    const encounter: RayenEncounter = {
      encounterId: '98765',
      run: '123456785',
      firstGivenName: 'José',
      firstFamilyName: 'Muñoz',
      birthDate: '1980-05-04',
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'H1',
      bed: 'C2',
      admissionDatetime: '2026-07-08T06:35:00-06:00',
      diagnosis: 'Diagnóstico actualizado',
    };
    const mapped = rayenToPatientData(encounter, reference);
    const imported = {
      ...mapped.patient,
      pathology: 'Diagnóstico inicial',
      eloisaManualImportAudit: {
        method: 'eloisa_manual_code' as const,
        importedBy: 'nurse@hospital.cl',
        importedAt: '2026-07-08T12:00:00.000Z',
        capturedAt: '2026-07-08T11:55:00.000Z',
        formatVersion: 1 as const,
        encounterId: '98765',
        integrity: 'sha256_checksum' as const,
        sourceTrust: 'user_confirmed_unverified' as const,
      },
    };
    const current: DailyRecord = {
      date: '2026-07-08',
      beds: { H1C2: imported },
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '',
    };
    const snapshot: RayenCensusSnapshot = {
      capturedAt: '2026-07-08T20:00:00-06:00',
      facilityId: 1342,
      encounters: [encounter],
      isComplete: true,
    };

    const diff = reconcileCensus(current, snapshot, { reference });
    expect(diff.admissions).toHaveLength(0);
    expect(diff.moves).toHaveLength(0);
    expect(diff.updates).toHaveLength(1);

    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'movement-id',
      now: reference,
      syncRunId: 'sync-run',
    });
    expect(applied.record.beds.H1C2.pathology).toBe('Diagnóstico actualizado');
    expect(applied.record.beds.H1C2.eloisaManualImportAudit).toEqual(
      imported.eloisaManualImportAudit
    );
  });
});
