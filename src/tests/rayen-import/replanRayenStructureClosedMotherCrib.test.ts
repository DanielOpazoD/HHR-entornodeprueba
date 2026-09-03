import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

// Regresión a nivel de pipeline (auditoría del 02-09, candidato ALTO): madre y RN
// CERRADOS en Ficha (epicrisis hecha, aún listados), informe de GC con dos filas del
// mismo RUN y lookup exacto que confirma ambos episodios. `findOccupiedBed` caía al
// RUN para la fila del RN (episodio de la CUNA) y construía un SEGUNDO egreso de la
// madre en la misma cama: alta duplicada en la estadística, RN sin egreso y conflicto
// «no pudo vincularse» conservado.

const MOTHER_RUN = '28.106.852-0';

const patient = (overrides: Partial<DailyRecord['beds'][string]>): DailyRecord['beds'][string] =>
  ({ ...EMPTY_PATIENT, ...overrides }) as DailyRecord['beds'][string];

const motherWithCrib = (): DailyRecord['beds'][string] =>
  patient({
    bedId: 'H5C1',
    patientName: 'Tania Cristina Valencia Ladino',
    rut: MOTHER_RUN,
    clinicalEpisodeId: '1001',
    admissionDate: '2026-08-31',
    admissionTime: '10:00',
    biologicalSex: 'Femenino',
    clinicalCrib: patient({
      bedId: 'H5C1',
      bedMode: 'Cuna',
      patientName: 'Rn De Tania Valencia Ladino',
      rut: MOTHER_RUN,
      clinicalEpisodeId: '1002',
      admissionDate: '2026-08-31',
    }),
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

const encounter = (overrides: Partial<RayenEncounter>): RayenEncounter => ({
  encounterId: '1001',
  run: MOTHER_RUN,
  firstGivenName: 'Tania Cristina',
  firstFamilyName: 'Valencia',
  secondFamilyName: 'Ladino',
  birthDate: '2000-01-01',
  administrativeSex: 'Mujer',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-08-31T12:00:00-04:00',
  diagnosis: 'Parto',
  ...overrides,
});

const cribEncounter = (): RayenEncounter =>
  encounter({
    encounterId: '1002',
    firstGivenName: 'Rn De Tania',
    birthDate: '2026-08-31',
    room: 'Cunas',
    bed: 'CH5C1',
    clinicalCribParentBedId: 'H5C1',
    admissionDatetime: '2026-08-31T13:00:00-04:00',
  });

const closed = (source: RayenEncounter): RayenEncounter => ({
  ...source,
  hasMedicalDischarge: true,
  hasNurseDischarge: true,
});

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-09-02T12:00:00-06:00',
  facilityId: 1342,
  encounters,
  isComplete: true,
});

const baseRow: EgresoReportRow = {
  encounterId: '',
  run: MOTHER_RUN,
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

const runPipeline = async (
  record: DailyRecord,
  snapshot: RayenCensusSnapshot,
  rows: EgresoReportRow[],
  lookupConfirms: string[]
) => {
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
  return replanRayenStructure(
    record,
    {
      sourceSnapshot: snapshot,
      egresoRows: rows,
      reportDate: '2026-09-02',
      isHistoricalDay: false,
    },
    {
      dailyRecord: repository,
      isAdmin: false,
      fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      lookupEgresos,
    }
  );
};

describe('replanRayenStructure — madre y RN cerrados en Ficha, lookup confirma ambos', () => {
  it('una sola alta de la madre, el RN sale con su episodio exacto y no queda conflicto redundante', async () => {
    const record = makeRecord({ H5C1: motherWithCrib() });
    const snapshot = snapshotOf([closed(encounter({})), closed(cribEncounter())]);

    const diff = await runPipeline(record, snapshot, [motherRow, cribRow], ['1001', '1002']);

    expect(diff.discharges.map(d => `${d.bedId}:${d.encounterId}:${d.kind}/${d.status}`)).toEqual([
      'H5C1:1001:alta/Vivo',
    ]);
    const newbornEgresos = (diff.reportEgresos ?? []).filter(e => e.encounterId === '1002');
    expect(newbornEgresos).toHaveLength(1);
    expect(diff.conflicts.filter(c => c.reason.includes('no pudo vincularse'))).toEqual([]);
    expect(diff.summary.conflicts).toBe(diff.conflicts.length);

    const applied = applyCensusImportDiff(record, diff, {
      idFactory: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      now: new Date('2026-09-02T15:00:00'),
      syncRunId: 'test',
    });
    expect(applied.record.beds.H5C1).toBeUndefined();
    const motherRecords = applied.record.discharges.filter(
      d => d.clinicalEpisodeId === '1001' && !d.isNested
    );
    expect(motherRecords).toHaveLength(1);
    // El RN nunca ocupó una cama independiente: su registro es anidado y no suma egreso
    // estadístico (misma regla que la alta asociada).
    const newbornRecords = applied.record.discharges.filter(d => d.clinicalEpisodeId === '1002');
    expect(newbornRecords).toHaveLength(1);
    expect(newbornRecords[0]?.isNested).toBe(true);
    expect(applied.skipped).toEqual([]);
  });

  it('madre confirmada por fila verificada del informe y RN por el lookup: sin update huérfano sobre la cama desocupada', async () => {
    const record = makeRecord({ H5C1: motherWithCrib() });
    const snapshot = snapshotOf([closed(encounter({})), closed(cribEncounter())]);
    const verifiedMotherRow: EgresoReportRow = {
      ...motherRow,
      encounterId: '1001',
      exactEpisodeVerification: 'verified',
    };

    const diff = await runPipeline(record, snapshot, [verifiedMotherRow], ['1002']);

    expect(diff.discharges.map(d => `${d.bedId}:${d.encounterId}`)).toEqual(['H5C1:1001']);
    expect((diff.reportEgresos ?? []).some(e => e.encounterId === '1002')).toBe(true);
    expect(diff.updates.filter(u => u.bedId === 'H5C1')).toEqual([]);
    const applied = applyCensusImportDiff(record, diff, {
      idFactory: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      now: new Date('2026-09-02T15:00:00'),
      syncRunId: 'test',
    });
    expect(applied.skipped).toEqual([]);
    expect(applied.record.beds.H5C1).toBeUndefined();
  });

  it('si el lookup confirma solo a la madre, el RN cerrado conserva la revisión (no se pierde en silencio)', async () => {
    const record = makeRecord({ H5C1: motherWithCrib() });
    const snapshot = snapshotOf([closed(encounter({})), closed(cribEncounter())]);

    const diff = await runPipeline(record, snapshot, [motherRow, cribRow], ['1001']);

    expect(diff.discharges.map(d => `${d.bedId}:${d.encounterId}`)).toEqual(['H5C1:1001']);
    expect((diff.reportEgresos ?? []).some(e => e.encounterId === '1002')).toBe(false);
    expect(diff.conflicts.filter(c => c.reason.includes('no pudo vincularse'))).toHaveLength(1);
  });
});
