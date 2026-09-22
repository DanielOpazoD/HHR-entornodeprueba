import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  CensusImportDiff,
  HistoricalRecoveryDay,
} from '@/features/rayen-import/contracts/censusImportDiff';
import {
  findHistoricalRecoveryStart,
  planHistoricalRecovery,
  isHistoricalRecoveryGap,
  removeCorrectionsCoveredByRecovery,
} from '@/features/rayen-import/domain/historicalRecovery';
import { applyHistoricalRecoveryDays } from '@/features/rayen-import/domain/applyHistoricalRecovery';
import { applyPatches } from '@/utils/patchUtils';
import { hasSkippedPreviousDayCorrections } from '@/features/rayen-import/hooks/confirmRayenImport';
import { hasNoApplicableRayenStructuralChanges } from '@/features/rayen-import/hooks/rayenSnapshotPlanningDecision';

const empty = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: 'base',
  }) as DailyRecord;
const patient = {
  ...EMPTY_PATIENT,
  bedId: 'H1C1',
  patientName: 'Paciente ficticio',
  rut: '11111111-1',
  clinicalEpisodeId: '123',
  admissionDate: '2026-09-17',
  pathology: 'No proyectar diagnóstico actual',
  devices: ['VVP#1'],
};
const plan = (day = '2026-09-19'): HistoricalRecoveryDay => ({
  day,
  recordExists: false,
  isSigned: false,
  withinEditingWindow: true,
  admissions: [{ bedId: 'H1C1', patient } as CensusImportDiff['admissions'][number]],
  reportEgresos: [],
  conflicts: [],
});
const diff = (overrides: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
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
const repository = (initial: DailyRecord[] = []) => {
  const records = new Map(initial.map(record => [record.date, record]));
  const port = {
    getAuthoritativeForDate: vi.fn(async (date: string) => records.get(date) ?? null),
    getLocalForDateWithMeta: vi.fn(async () => ({
      record: null,
      writeState: 'none',
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
    })),
    initializeDay: vi.fn(async (date: string) => {
      const record = empty(date);
      records.set(date, record);
      return record;
    }),
    updatePartialDetailed: vi.fn(
      async (
        date: string,
        patch: Parameters<DailyRecordRepositoryPort['updatePartialDetailed']>[1]
      ) => {
        const record = applyPatches(records.get(date)!, patch);
        records.set(date, record);
        return {
          outcome: 'clean',
          updatedRemotely: true,
          savedLocally: true,
          confirmedRecord: record,
        };
      }
    ),
  };
  return { records, mocks: port, port: port as unknown as DailyRecordRepositoryPort };
};
const provenance = { actor: 'Prueba', syncRunId: 'recovery-test' };

describe('recuperación de días faltantes', () => {
  it('detecta intervalo ausente hasta el último censo con datos, con límite de siete días', async () => {
    const { port } = repository([
      { ...empty('2026-09-20'), beds: { H1C1: patient } },
      { ...empty('2026-09-16'), beds: { H1C1: patient } },
    ]);
    expect(
      await findHistoricalRecoveryStart('2026-09-21', port, new Date('2026-09-21T18:00:00Z'))
    ).toBe('2026-09-17');
    expect(
      await findHistoricalRecoveryStart(
        '2026-09-21',
        repository().port,
        new Date('2026-09-21T18:00:00Z')
      )
    ).toBe('2026-09-14');
  });
  it('no interpreta un censo firmado, bloqueado o sincronizado vacío como un hueco', () => {
    expect(
      isHistoricalRecoveryGap({
        ...empty('2026-09-20'),
        rayenSync: { runId: 'done' },
      } as DailyRecord)
    ).toBe(false);
    expect(
      isHistoricalRecoveryGap({
        ...empty('2026-09-20'),
        medicalSignatureByScope: { test: {} },
      } as DailyRecord)
    ).toBe(false);
    expect(
      isHistoricalRecoveryGap({
        ...empty('2026-09-20'),
        beds: { H1C1: { ...patient, patientName: '', isBlocked: true } },
      })
    ).toBe(false);
    expect(
      isHistoricalRecoveryGap({
        ...empty('2026-09-20'),
        beds: {
          H1C1: {
            ...patient,
            patientName: '',
            clinicalCrib: { ...patient, patientName: '', isBlocked: true },
          },
        },
      })
    ).toBe(false);
  });
  it('reconstruye cada fecha por evidencia propia y filtra los egresos de otras fechas', async () => {
    const { port } = repository();
    const reconstruct = vi.fn(async (record: DailyRecord) =>
      diff({
        admissions: plan().admissions,
        reportEgresos: [
          { ...plan().reportEgresos[0], correctedDay: record.date },
          { correctedDay: '2026-09-21' },
        ] as CensusImportDiff['reportEgresos'],
      })
    );
    const result = await planHistoricalRecovery({
      dateStart: '2026-09-18',
      selectedDate: '2026-09-21',
      port,
      buildEmpty: empty,
      reconstruct,
      canWrite: () => true,
    });
    expect(result.map(row => row.day)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);
    expect(
      result.every(
        row => row.reportEgresos.length === 1 && row.reportEgresos[0].correctedDay === row.day
      )
    ).toBe(true);
  });
  it('crea en orden, conserva identidad y no copia observaciones actuales; reintentar no duplica', async () => {
    const { port, mocks, records } = repository();
    const plans = [plan('2026-09-20'), plan('2026-09-19')];
    await applyHistoricalRecoveryDays(port, plans, '2026-09-21', () => true, provenance);
    expect(mocks.initializeDay.mock.calls.map(([date]) => date)).toEqual([
      '2026-09-19',
      '2026-09-20',
    ]);
    const saved = records.get('2026-09-19')!.beds.H1C1;
    expect(saved.clinicalEpisodeId).toBe('123');
    expect(saved.pathology).toBeUndefined();
    expect(saved.devices).toBeUndefined();
    const writes = mocks.updatePartialDetailed.mock.calls.length;
    await applyHistoricalRecoveryDays(port, plans, '2026-09-21', () => true, provenance);
    expect(mocks.initializeDay).toHaveBeenCalledTimes(2);
    expect(mocks.updatePartialDetailed).toHaveBeenCalledTimes(writes);
  });
  it('se detiene antes de crear si una fecha adquirió un ocupante distinto', async () => {
    const { port, mocks } = repository([
      { ...empty('2026-09-20'), beds: { H1C1: { ...patient, clinicalEpisodeId: '999' } } },
    ]);
    await expect(
      applyHistoricalRecoveryDays(
        port,
        [plan('2026-09-19'), plan('2026-09-20')],
        '2026-09-21',
        () => true,
        provenance
      )
    ).rejects.toThrow('ocupación');
    expect(mocks.initializeDay).not.toHaveBeenCalled();
    expect(mocks.updatePartialDetailed).not.toHaveBeenCalled();
  });
  it('no continúa si la creación no tiene lectura autoritativa o la escritura fue rechazada', async () => {
    const { port, mocks } = repository();
    mocks.initializeDay.mockImplementation(async date => empty(date));
    await expect(
      applyHistoricalRecoveryDays(port, [plan()], '2026-09-21', () => true, provenance)
    ).rejects.toThrow('creación');
    expect(mocks.updatePartialDetailed).not.toHaveBeenCalled();
    const second = repository([empty('2026-09-19')]);
    second.mocks.updatePartialDetailed.mockResolvedValueOnce({
      outcome: 'blocked',
      updatedRemotely: false,
    } as never);
    await expect(
      applyHistoricalRecoveryDays(second.port, [plan()], '2026-09-21', () => true, provenance)
    ).rejects.toThrow('No se confirmó');
  });
  it('respeta permisos y hace visibles recuperación y omisiones aunque el día actual no cambie', async () => {
    const { port, mocks } = repository();
    const blocked = { ...plan(), withinEditingWindow: false };
    expect(
      await applyHistoricalRecoveryDays(port, [blocked], '2026-09-21', () => false, provenance)
    ).toBe(0);
    expect(mocks.initializeDay).not.toHaveBeenCalled();
    const pending = diff({ historicalRecovery: [blocked] });
    expect(hasNoApplicableRayenStructuralChanges(pending)).toBe(false);
    expect(hasSkippedPreviousDayCorrections(pending, true)).toBe(true);
    expect(hasSkippedPreviousDayCorrections(diff({ historicalRecovery: [plan()] }), false)).toBe(
      true
    );
  });
});

it('ubica los egresos en su fecha y deduplica por episodio al reanudar', async () => {
  const { port, records, mocks } = repository();
  const day = plan('2026-09-19');
  day.admissions = [];
  day.reportEgresos = [
    {
      run: '11111111-1',
      encounterId: '321',
      patientName: 'Paciente ficticio egresado',
      bedLabel: 'H1C1',
      destino: 'Domicilio',
      fechaEgreso: '19-09-2026 15:00',
      kind: 'alta',
      status: 'Vivo',
      correctedDay: '2026-09-19',
      correctedTime: '15:00',
    },
  ];
  await applyHistoricalRecoveryDays(port, [day], '2026-09-21', () => true, provenance);
  await applyHistoricalRecoveryDays(port, [day], '2026-09-21', () => true, provenance);
  expect([...records.keys()]).toEqual(['2026-09-19']);
  expect(records.get(day.day)!.discharges).toHaveLength(1);
  expect(records.get(day.day)!.discharges[0].clinicalEpisodeId).toBe('321');
  expect(mocks.updatePartialDetailed).toHaveBeenCalledTimes(1);
});

it('no informa como omitida una corrección ya incluida en la recuperación del mismo episodio', () => {
  const day = plan();
  day.reportEgresos = [{ encounterId: '321', correctedDay: day.day } as never];
  const correction = {
    day: day.day,
    reason: 'discharge-day-correction' as const,
    patientNames: ['Prueba'],
    recordExists: false,
    withinEditingWindow: true,
    isSigned: false,
  };
  const proposed = diff({ reportEgresos: day.reportEgresos, previousDayEdits: [correction] });
  expect(removeCorrectionsCoveredByRecovery(proposed, [day])).toEqual([]);
  const differentEpisode = {
    ...day,
    reportEgresos: [{ encounterId: '999', correctedDay: day.day } as never],
  };
  expect(removeCorrectionsCoveredByRecovery(proposed, [differentEpisode])).toEqual([correction]);
});

it.each([
  ['discharges', [{ id: 'concurrent-discharge', clinicalEpisodeId: 'other' }]],
  ['transfers', [{ id: 'concurrent-transfer', clinicalEpisodeId: 'other' }]],
  ['cma', [{ id: 'concurrent-cma', clinicalEpisodeId: 'other' }]],
  ['rayenSync', { runId: 'other-sync' }],
  ['rayenSyncHistory', [{ id: 'other-sync' }]],
] as const)(
  'detiene antes de escribir cuando otro cliente agregó %s a una fecha vacía',
  async (field, value) => {
    const { port, mocks } = repository([{ ...empty('2026-09-19'), [field]: value } as DailyRecord]);
    await expect(
      applyHistoricalRecoveryDays(port, [plan()], '2026-09-21', () => true, provenance)
    ).rejects.toThrow(/cambió/);
    expect(mocks.initializeDay).not.toHaveBeenCalled();
    expect(mocks.updatePartialDetailed).not.toHaveBeenCalled();
  }
);
