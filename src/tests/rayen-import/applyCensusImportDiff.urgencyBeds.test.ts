import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  planRayenCensusImport,
  type ApplyContext,
  type CensusImportDiff,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 8);
const NOW = new Date(2026, 6, 8, 15, 30, 0);

const makeCtx = (): ApplyContext => ({
  idFactory: () => 'movement-id',
  now: NOW,
  actor: 'Enfermera Rayen',
  syncRunId: 'sync-run-urgency-box',
});

const makeRecord = (beds: Record<string, PatientData> = {}): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeDiff = (overrides: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...overrides,
});

const boxSnapshot = (): RayenCensusSnapshot => ({
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters: [
    {
      encounterId: 'BOX-EPISODE',
      run: '144700554',
      firstGivenName: 'Paciente',
      firstFamilyName: 'Prueba',
      birthDate: '1980-01-01',
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'B3UEA',
      bed: 'B3UEA',
      admissionDatetime: '2026-07-08T10:00:00-06:00',
      diagnosis: 'Diagnóstico de prueba',
    } satisfies RayenEncounter,
  ],
});

describe('applyCensusImportDiff Urgencias occupancy-only beds', () => {
  it('shows an Urgencias box only while its synchronized encounter occupies it', () => {
    const current = makeRecord();
    const { diff } = planRayenCensusImport({
      current,
      snapshot: boxSnapshot(),
      reference: REFERENCE,
    });
    const admitted = applyCensusImportDiff(current, diff, makeCtx());

    expect(admitted.record.beds.BOX3?.patientName).toBe('Paciente Prueba');
    expect(admitted.record.activeExtraBeds).toEqual(['BOX3']);

    const discharged = applyCensusImportDiff(
      admitted.record,
      makeDiff({
        discharges: [
          {
            bedId: 'BOX3',
            rut: admitted.record.beds.BOX3.rut,
            patientName: admitted.record.beds.BOX3.patientName,
            encounterId: 'BOX-EPISODE',
            kind: 'alta',
            status: 'Vivo',
            reason: 'administrative-discharge',
          },
        ],
      }),
      makeCtx()
    );

    expect(discharged.record.beds.BOX3).toBeUndefined();
    expect(discharged.record.activeExtraBeds).not.toContain('BOX3');
  });

  it('does not expose an empty Urgencias box and preserves manually enabled extra beds', () => {
    const current = { ...makeRecord(), activeExtraBeds: ['E1', 'BOX2'] };
    const result = applyCensusImportDiff(current, makeDiff(), makeCtx());

    expect(result.record.activeExtraBeds).toEqual(['E1']);
  });
});
