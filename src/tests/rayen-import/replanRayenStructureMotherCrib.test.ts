import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

// Regresión a nivel de pipeline del caso vivo del 02-09 (H5C1): Rayen registra al
// RN bajo el RUN de la madre, el informe de Gestión de Camas trae dos filas con el
// mismo RUN (vinculación ambigua → 'unverified') y el egreso real nace después, en
// el lookup exacto por episodio. Un test unitario de la elegibilidad no puede ver
// ese orden: aquí se ejecuta el pipeline completo con las dependencias simuladas.

const RUN = '28.106.852-0';

const motherWithCrib = (): DailyRecord['beds'][string] => ({
  ...EMPTY_PATIENT,
  bedId: 'H5C1',
  patientName: 'Tania Cristina Valencia Ladino',
  rut: RUN,
  clinicalEpisodeId: '1001',
  admissionDate: '2026-08-31',
  admissionTime: '10:00',
  clinicalCrib: {
    ...EMPTY_PATIENT,
    bedId: 'H5C1',
    bedMode: 'Cuna',
    patientName: 'Rn De Tania Valencia Ladino',
    rut: RUN,
    clinicalEpisodeId: '1002',
    admissionDate: '2026-08-31',
  },
});

const makeRecord = (beds: DailyRecord['beds']): DailyRecord =>
  ({
    date: '2026-09-02',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-09-02T10:00:00.000Z',
  }) as DailyRecord;

const baseRow: EgresoReportRow = {
  encounterId: '',
  run: RUN,
  patientName: '',
  bedLabel: 'H5C1',
  servicio: 'Ginecobstetricia',
  edad: '18',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '02-09-2026 10:00',
  exactEpisodeVerification: 'unverified',
};
const motherRow: EgresoReportRow = { ...baseRow, patientName: 'Tania Cristina Valencia Ladino' };
const cribRow: EgresoReportRow = {
  ...baseRow,
  patientName: 'Rn De Tania Valencia Ladino',
  edad: '0',
};

const emptySnapshot = (): RayenCensusSnapshot => ({
  capturedAt: '2026-09-02T12:00:00-06:00',
  facilityId: 1342,
  encounters: [],
  isComplete: true,
});

const runPipeline = async (rows: EgresoReportRow[], lookupConfirms: string[]) => {
  const repository = {
    getForDate: vi.fn().mockResolvedValue(null),
    getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
  } as unknown as DailyRecordRepositoryPort;
  const lookupEgresos = vi
    .fn()
    .mockImplementation(async (targets: Array<{ run: string; encounterId: string }>) =>
      targets.map(target => ({
        run: target.run,
        encounterId: target.encounterId,
        egreso: lookupConfirms.includes(target.encounterId)
          ? {
              hasAdministrativeDischarge: true,
              hasMedicalDischarge: true,
              hasNurseDischarge: true,
              dateDischarge: '2026-09-02T10:00:00',
              dischargeDestinationName: 'Domicilio',
            }
          : undefined,
      }))
    );
  const dependencies = {
    dailyRecord: repository,
    isAdmin: false,
    fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    lookupEgresos,
  };
  return replanRayenStructure(
    makeRecord({ H5C1: motherWithCrib() }),
    {
      sourceSnapshot: emptySnapshot(),
      egresoRows: rows,
      reportDate: '2026-09-02',
      isHistoricalDay: false,
    },
    dependencies
  );
};

const unlinkedConflicts = (diff: Awaited<ReturnType<typeof runPipeline>>) =>
  diff.conflicts.filter(conflict => conflict.reason.includes('no pudo vincularse'));

describe('replanRayenStructure — madre + RN bajo el mismo RUN (caso vivo 02-09)', () => {
  it('el egreso confirmado por el lookup exacto no deja un conflicto «no pudo vincularse» redundante', async () => {
    const diff = await runPipeline([motherRow, cribRow], ['1001']);

    expect(diff.discharges).toHaveLength(1);
    expect(diff.discharges[0]).toMatchObject({ bedId: 'H5C1', kind: 'alta', status: 'Vivo' });
    expect(diff.discharges[0]?.associatedClinicalCrib?.clinicalEpisodeId).toBe('1002');
    expect(unlinkedConflicts(diff)).toEqual([]);
    expect(diff.summary.conflicts).toBe(diff.conflicts.length);
  });

  it('si el lookup no confirma el episodio, la fila ambigua sigue exigiendo revisión', async () => {
    const diff = await runPipeline([motherRow, cribRow], []);

    expect(diff.discharges).toEqual([]);
    expect(unlinkedConflicts(diff)).toHaveLength(1);
    expect(unlinkedConflicts(diff)[0]).toMatchObject({
      bedId: 'H5C1',
      code: 'unverified-report-row',
    });
  });

  it('gemelos: tres filas con el RUN de la madre superan lo que la cama explica y conservan la revisión', async () => {
    const twinRow: EgresoReportRow = { ...cribRow, patientName: 'Rn 2 De Tania Valencia Ladino' };
    const diff = await runPipeline([motherRow, cribRow, twinRow], ['1001']);

    expect(diff.discharges).toHaveLength(1);
    expect(unlinkedConflicts(diff)).toHaveLength(1);
    expect(unlinkedConflicts(diff)[0]?.code).toBeUndefined();
  });
});
