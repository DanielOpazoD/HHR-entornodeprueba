import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

// Auditoría del 02-09: `applyEgresoReport` corre dos veces sobre el mismo diff
// (informe y, si nada cambió entre medio, otra vez antes del lookup). Un conflicto
// rederivado en cada pasada se contaba doble («episodio activo de HHR no se pudo
// confirmar» ×2), bloqueaba la etapa clínica de la cama y dejaba la corrida
// «Parcial» por un único motivo. Realista con ingresos manuales sin episodio.

const RUN = '11.111.111-1';

const legacyOccupant = (): DailyRecord['beds'][string] =>
  ({
    ...EMPTY_PATIENT,
    bedId: 'H4C1',
    patientName: 'Pedro Legacy',
    rut: RUN,
    admissionDate: '2026-08-30',
    admissionTime: '09:00',
  }) as DailyRecord['beds'][string];

const makeRecord = (): DailyRecord =>
  ({
    date: '2026-09-02',
    beds: { H4C1: legacyOccupant() },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-09-02T10:00:00.000Z',
  }) as DailyRecord;

const emptySnapshot = (): RayenCensusSnapshot => ({
  capturedAt: '2026-09-02T12:00:00-06:00',
  facilityId: 1342,
  encounters: [],
  isComplete: true,
});

const verifiedRow: EgresoReportRow = {
  encounterId: '777',
  run: RUN,
  patientName: 'Pedro Legacy',
  bedLabel: 'H4C1',
  servicio: 'Medicina',
  edad: '60',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '02-09-2026 10:00',
  exactEpisodeVerification: 'verified',
};

const runPipeline = async (rows: EgresoReportRow[]) => {
  const repository = {
    getForDate: vi.fn().mockResolvedValue(null),
    getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
  } as unknown as DailyRecordRepositoryPort;
  return replanRayenStructure(
    makeRecord(),
    {
      sourceSnapshot: emptySnapshot(),
      egresoRows: rows,
      reportDate: '2026-09-02',
      isHistoricalDay: false,
    },
    {
      dailyRecord: repository,
      isAdmin: false,
      fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      lookupEgresos: vi.fn().mockResolvedValue([]),
    }
  );
};

describe('replanRayenStructure — ocupante sin episodio y fila verificada con episodio', () => {
  it('el conflicto «episodio activo de HHR no se pudo confirmar» aparece una sola vez aunque el informe se aplique dos veces', async () => {
    const diff = await runPipeline([verifiedRow]);

    const unconfirmed = diff.conflicts.filter(conflict =>
      conflict.reason.includes('episodio activo de HHR no se pudo confirmar')
    );
    expect(diff.discharges).toEqual([]);
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]).toMatchObject({ bedId: 'H4C1', rut: RUN });
    expect(diff.summary.conflicts).toBe(diff.conflicts.length);
  });
});
