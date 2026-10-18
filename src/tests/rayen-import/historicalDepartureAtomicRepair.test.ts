// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  computePreviousDayEdits,
  fileCrossDayCorrections,
} from '@/features/rayen-import/domain/previousDayCorrections';
import {
  patchDailyRecordWithCompatibility,
  saveDailyRecordWithCompatibility,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { createSaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

const { evaluateDailyRecordClinicalAuthority } = createRequire(import.meta.url)(
  '../../../functions/lib/dailyRecordClinicalAuthorityPolicy.js'
);
vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn(),
  saveDailyRecordWithCompatibility: vi.fn(),
}));
const setup = (recoverChild: boolean) => {
  const mother = DataFactory.createMockPatient('R4', {
    patientName: 'Madre Sintética',
    rut: '8.260.364-6',
    clinicalEpisodeId: '1001',
    admissionDate: '2026-10-14',
    admissionTime: '10:00',
    clinicalCrib: DataFactory.createMockPatient('R4', {
      patientName: 'RN de Madre Sintética',
      rut: '',
      clinicalEpisodeId: '1002',
      bedMode: 'Cuna',
      admissionDate: '2026-10-15',
      admissionTime: '04:34',
      handoffNoteNightShift: 'Nota neonatal conservada',
    }),
  });
  const historical = DataFactory.createMockDailyRecord('2026-10-16', {
    beds: { R4: mother },
    lastUpdated: '2026-10-17T10:00:00Z',
    handoffNovedadesNightShift: 'Novedades conservadas',
    discharges: [
      DataFactory.createMockDischarge({
        bedId: 'R4',
        bedName: 'R4',
        patientName: mother.patientName,
        rut: mother.rut,
        clinicalEpisodeId: '1001',
        admissionDate: mother.admissionDate,
        movementDate: '2026-10-17',
        time: '00:19',
        originalData: { ...mother, clinicalCrib: undefined },
      }),
    ],
  });
  const repository = {
    getAuthoritativeForDate: vi.fn().mockResolvedValue(historical),
    getLocalForDateWithMeta: vi
      .fn()
      .mockResolvedValue({ record: null, writeState: 'none', hasPendingWrites: false }),
  } as unknown as DailyRecordRepositoryPort;
  const diff: CensusImportDiff = {
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    conflicts: [],
    pendingAdministrativeDischarges: [],
    unchangedCount: 0,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      conflicts: 0,
      pendingAdministrativeDischarges: 0,
      unchanged: 0,
    },
    reportEgresos: [
      {
        run: recoverChild ? '' : mother.rut,
        encounterId: recoverChild ? '1002' : '1001',
        patientName: recoverChild ? mother.clinicalCrib!.patientName : mother.patientName,
        bedLabel: 'R4',
        destino: 'Domicilio',
        fechaEgreso: '17-10-2026 00:19',
        correctedDay: '2026-10-16',
        correctedTime: '00:19',
        kind: 'alta',
        status: 'Vivo',
        ...(recoverChild ? { fromClinicalCrib: true } : {}),
      },
    ],
  };
  return { repository, diff, historical };
};

describe('historical departure repair before the previous-night CUDYR batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveDailyRecordWithCompatibility).mockImplementation(async (_port, record) =>
      createSaveDailyRecordResult({
        date: record.date,
        outcome: 'clean',
        savedLocally: true,
        savedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        confirmedRecord: record,
      })
    );
  });
  it.each([true, false])(
    'commits a consistent historical census atomically; own RN departure known: %s',
    async recoverChild => {
      const { repository, diff, historical } = setup(recoverChild);
      const before = structuredClone(historical);
      const plan = await computePreviousDayEdits(repository, diff, '2026-10-17', true);
      expect(plan.edits).toHaveLength(1);
      expect(plan.reportEgresos).toHaveLength(1);
      const result = await fileCrossDayCorrections(
        repository,
        DataFactory.createMockDailyRecord('2026-10-17'),
        { ...diff, reportEgresos: plan.reportEgresos, previousDayEdits: plan.edits },
        '2026-10-17',
        true,
        () => 'unused',
        { actor: 'Operador sintético', syncRunId: 'run-1' }
      );
      expect(patchDailyRecordWithCompatibility).not.toHaveBeenCalled();
      expect(saveDailyRecordWithCompatibility).toHaveBeenCalledTimes(1);
      const [, saved, version, options] = vi.mocked(saveDailyRecordWithCompatibility).mock.calls[0];
      expect(version).toBe(historical.lastUpdated);
      expect(options).toMatchObject({
        rayenStructuralWriteGuard: true,
        requireConfirmedRecord: true,
      });
      expect(evaluateDailyRecordClinicalAuthority(saved).status).toBe('ok');
      expect(saved.beds.R4.patientName).toBe('');
      expect(saved.handoffNovedadesNightShift).toBe(historical.handoffNovedadesNightShift);
      expect(saved.discharges[0]).toEqual(historical.discharges[0]);
      if (recoverChild) {
        expect(saved.beds.R4.clinicalCrib).toBeUndefined();
        expect(saved.discharges[1]).toMatchObject({
          clinicalEpisodeId: '1002',
          isNested: true,
          originalData: { handoffNoteNightShift: 'Nota neonatal conservada' },
        });
      } else {
        expect(saved.discharges).toHaveLength(1);
        expect(saved.beds.R4.clinicalCrib).toEqual(historical.beds.R4.clinicalCrib);
      }
      expect(historical).toEqual(before);
      expect(result.confirmed).toBe(1);
    }
  );
});
