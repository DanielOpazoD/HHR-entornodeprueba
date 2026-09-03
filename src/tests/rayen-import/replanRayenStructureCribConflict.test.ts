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

// Auditoría del 02-09, candidatos 3 y 4, a nivel del pipeline real:
// (3) alta de la madre confirmada por lookup mientras la cuna de su cama tiene un
//     conflicto pendiente (gemelos): aplicarla vaciaba la cama entera y el RN quedaba
//     sin ningún movimiento → cierre seguro: el alta no se construye y queda un
//     conflicto con cama.
// (4) fila sin episodio de un RUN con otro episodio movido el mismo día + lookup que
//     confirma el episodio activo: el conflicto «no identifica el episodio activo»
//     sobrevivía al egreso → redundante, se descarta.

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

const makeRecord = (beds: DailyRecord['beds'], extra: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-09-02',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-09-02T10:00:00.000Z',
    ...extra,
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

const cribEncounter = (encounterId: string, firstGivenName = 'Rn De Tania'): RayenEncounter =>
  encounter({
    encounterId,
    firstGivenName,
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

const applyCtx = () => ({
  idFactory: (() => {
    let n = 0;
    return () => `id-${++n}`;
  })(),
  now: new Date('2026-09-02T15:00:00'),
  syncRunId: 'test',
});

describe('replanRayenStructure — cierre seguro ante conflicto de cuna', () => {
  it('gemelos apuntando a la cama de la madre + alta de la madre por lookup: el alta no se construye y la cama se conserva', async () => {
    const record = makeRecord({ H5C1: motherWithCrib() });
    const snapshot = snapshotOf([
      closed(encounter({})),
      cribEncounter('1002'),
      cribEncounter('1003', 'Rn 2 De Tania'),
    ]);

    const diff = await runPipeline(record, snapshot, [], ['1001']);

    expect(diff.discharges).toEqual([]);
    const cribConflicts = diff.conflicts.filter(
      c => c.scope === 'clinical-crib' && c.bedId === 'H5C1'
    );
    expect(cribConflicts.length).toBeGreaterThan(0);
    const blocked = diff.conflicts.filter(c => c.reason.includes('la cuna de H5C1'));
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ bedId: 'H5C1', rut: MOTHER_RUN });

    const applied = applyCensusImportDiff(record, diff, applyCtx());
    expect(applied.record.beds.H5C1?.patientName).toBe('Tania Cristina Valencia Ladino');
    expect(applied.record.beds.H5C1?.clinicalCrib?.clinicalEpisodeId).toBe('1002');
    expect(applied.record.discharges).toEqual([]);
    expect(blocked[0]?.code).toBe('crib-conflict-blocks-discharge');
  });

  it('madre trasladada en Ficha (H5C1→H5C2) + gemelos en H5C1 + fila verificada: la cuna NO se promueve a la cama destino', async () => {
    // Revisión adversarial de #316: la promoción usaba la cama planificada y el
    // bloqueo la cama actual → RN duplicado (cuna anidada en H5C1 y principal en H5C2).
    const record = makeRecord({ H5C1: motherWithCrib() });
    const snapshot = snapshotOf([
      encounter({ bed: 'C2' }),
      cribEncounter('1002'),
      cribEncounter('1003', 'Rn 2 De Tania'),
    ]);
    const verifiedMotherRow: EgresoReportRow = {
      encounterId: '1001',
      run: MOTHER_RUN,
      patientName: 'Tania Cristina Valencia Ladino',
      bedLabel: 'H5C2',
      servicio: 'Ginecobstetricia',
      edad: '18',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '02-09-2026 10:00',
      exactEpisodeVerification: 'verified',
    };

    const diff = await runPipeline(record, snapshot, [verifiedMotherRow], []);

    expect(diff.discharges).toEqual([]);
    expect(diff.admissions).toEqual([]);
    expect(diff.conflicts.filter(c => c.code === 'crib-conflict-blocks-discharge')).toHaveLength(1);

    const applied = applyCensusImportDiff(record, diff, applyCtx());
    expect(applied.record.beds.H5C1?.clinicalCrib?.clinicalEpisodeId).toBe('1002');
    expect(applied.record.beds.H5C2).toBeUndefined();
  });
});

describe('replanRayenStructure — fila sin episodio con otro episodio del día y lookup exacto', () => {
  it('el egreso confirmado por episodio descarta el conflicto «no identifica el episodio activo»', async () => {
    const record = makeRecord(
      {
        H4C1: patient({
          bedId: 'H4C1',
          patientName: 'Zoila Reingreso',
          rut: '22.222.222-2',
          clinicalEpisodeId: '2002',
          admissionDate: '2026-09-02',
          admissionTime: '06:00',
        }),
      },
      {
        cma: [
          {
            id: 'cma-1',
            rut: '22.222.222-2',
            patientName: 'Zoila Reingreso',
            clinicalEpisodeId: '2001',
            bedId: 'R1',
          } as never,
        ],
      }
    );
    const row: EgresoReportRow = {
      encounterId: '',
      run: '22.222.222-2',
      patientName: 'Zoila Reingreso',
      bedLabel: 'H4C1',
      servicio: 'Medicina',
      edad: '40',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '02-09-2026 22:00',
    };

    const diff = await runPipeline(record, snapshotOf([]), [row], ['2002']);

    expect(diff.discharges.map(d => `${d.bedId}:${d.encounterId}`)).toEqual(['H4C1:2002']);
    expect(
      diff.conflicts.filter(c => c.reason.includes('no identifica el episodio activo'))
    ).toEqual([]);
    expect(diff.summary.conflicts).toBe(diff.conflicts.length);
  });

  it('sin egreso confirmado, el conflicto se conserva con su etiqueta', async () => {
    const record = makeRecord(
      {
        H4C1: patient({
          bedId: 'H4C1',
          patientName: 'Zoila Reingreso',
          rut: '22.222.222-2',
          clinicalEpisodeId: '2002',
          admissionDate: '2026-09-02',
          admissionTime: '06:00',
        }),
      },
      {
        cma: [
          {
            id: 'cma-1',
            rut: '22.222.222-2',
            patientName: 'Zoila Reingreso',
            clinicalEpisodeId: '2001',
            bedId: 'R1',
          } as never,
        ],
      }
    );
    const row: EgresoReportRow = {
      encounterId: '',
      run: '22.222.222-2',
      patientName: 'Zoila Reingreso',
      bedLabel: 'H4C1',
      servicio: 'Medicina',
      edad: '40',
      destino: 'Domicilio',
      motivo: 'Alta hospitalaria',
      fechaEgreso: '02-09-2026 22:00',
    };

    const diff = await runPipeline(record, snapshotOf([]), [row], []);

    expect(diff.discharges).toEqual([]);
    const gated = diff.conflicts.filter(c => c.reason.includes('no identifica el episodio activo'));
    expect(gated).toHaveLength(1);
    expect(gated[0]?.code).toBe('episode-less-report-row');

    // Valla de gemelos: con más filas de hoy del mismo RUN de las que la cama
    // explica, el conflicto se conserva sin etiqueta (no puede descartarse).
    const tripled = await runPipeline(record, snapshotOf([]), [row, row, row], ['2002']);
    const kept = tripled.conflicts.filter(c =>
      c.reason.includes('no identifica el episodio activo')
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.code).toBeUndefined();
  });
});
