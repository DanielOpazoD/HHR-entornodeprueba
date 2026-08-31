import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import {
  computePreviousDayEdits,
  fileCrossDayCorrections,
} from '@/features/rayen-import/domain/previousDayCorrections';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  historicalRecord,
  motherAndNewbornDiff,
  repository,
  resetPreviousDayAdmissionFixtures,
} from './previousDayAdmissionCorrections.fixtures';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn().mockResolvedValue({
    outcome: 'clean',
    savedLocally: true,
    updatedRemotely: true,
  }),
}));

const mixedDiff = (): CensusImportDiff => ({
  ...motherAndNewbornDiff,
  discharges: [
    {
      bedId: 'H2C1',
      rut: '22.025.389-9',
      patientName: 'Paciente Egresado',
      kind: 'alta',
      status: 'Vivo',
      correctedDay: '2026-07-25',
      correctedTime: '22:15',
    } as CensusImportDiff['discharges'][number],
  ],
  summary: { ...motherAndNewbornDiff.summary, discharges: 1 },
});

describe('fileCrossDayCorrections · escrituras puras por día', () => {
  beforeEach(resetPreviousDayAdmissionFixtures);
  afterEach(() => vi.useRealTimers());

  it('separa movimientos y camas: ningún patch mezcla el árbol de camas con otros campos', async () => {
    // El separador clínico/estructural del servidor rechaza un patch mixto
    // («La edición mezcla cambios de cama con otros campos…»); ese patch mixto
    // dejaba TODAS las corridas marcadas «requiere una nueva captura».
    const diff = mixedDiff();
    const plan = await computePreviousDayEdits(repository, diff, '2026-07-26', false);
    expect(plan.edits.length).toBeGreaterThan(0);

    const result = await fileCrossDayCorrections(
      repository,
      {
        ...historicalRecord,
        date: '2026-07-26',
        beds: {
          H2C1: {
            ...EMPTY_PATIENT,
            bedId: 'H2C1',
            patientName: 'Paciente Egresado',
            rut: '22.025.389-9',
          },
        },
      },
      { ...diff, previousDayEdits: plan.edits },
      '2026-07-26',
      false,
      () => 'movement-id',
      { actor: 'Enfermera prueba', syncRunId: 'sync-run' }
    );

    const calls = vi.mocked(patchDailyRecordWithCompatibility).mock.calls;
    expect(calls.length).toBe(2);
    for (const [, day, patch] of calls) {
      expect(day).toBe('2026-07-25');
      const keys = Object.keys(patch as Record<string, unknown>).sort();
      const touchesBeds = keys.includes('beds');
      const touchesOtherFields = keys.some(key => key !== 'beds');
      expect(touchesBeds && touchesOtherFields).toBe(false);
      expect(keys).not.toContain('lastUpdated');
    }
    const movementsCall = calls.find(([, , patch]) => 'discharges' in (patch as object));
    expect(Object.keys(movementsCall![2] as Record<string, unknown>).sort()).toEqual([
      'cma',
      'discharges',
      'transfers',
    ]);
    expect(result).toEqual({ confirmed: 1, durablyQueued: 0 });
  });
});
