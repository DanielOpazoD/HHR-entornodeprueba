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

// Auditoría del 02-09, candidato 5: un ocupante ingresado a mano (sin episodio)
// egresa por el informe de Gestión de Camas mientras Ficha ya lista a otro
// paciente en esa cama. El egreso no traía episodio y el ingreso retenido sí:
// la comparación quedaba «unknown», la cama se vaciaba y el ingreso seguía
// bloqueado («ya está ocupada por Pedro Legacy») hasta la siguiente corrida.

const LEGACY_RUN = '11.111.111-1';

const makeRecord = (): DailyRecord =>
  ({
    date: '2026-09-02',
    beds: {
      H4C1: {
        ...EMPTY_PATIENT,
        bedId: 'H4C1',
        patientName: 'Pedro Legacy',
        rut: LEGACY_RUN,
        admissionDate: '2026-08-30',
        admissionTime: '09:00',
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-09-02T10:00:00.000Z',
  }) as DailyRecord;

const incoming: RayenEncounter = {
  encounterId: '3001',
  run: '33.333.333-3',
  firstGivenName: 'Nuevo',
  firstFamilyName: 'Ingreso',
  birthDate: '1980-01-01',
  administrativeSex: 'Hombre',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H4',
  bed: 'C1',
  admissionDatetime: '2026-09-02T09:00:00-04:00',
  diagnosis: 'Neumonía',
};

const snapshot: RayenCensusSnapshot = {
  capturedAt: '2026-09-02T12:00:00-06:00',
  facilityId: 1342,
  encounters: [incoming],
  isComplete: true,
};

const legacyRow: EgresoReportRow = {
  encounterId: '',
  run: LEGACY_RUN,
  patientName: 'Pedro Legacy',
  bedLabel: 'H4C1',
  servicio: 'Medicina',
  edad: '60',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '02-09-2026 10:00',
};

const runPipeline = async () => {
  const repository = {
    getForDate: vi.fn().mockResolvedValue(null),
    getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
  } as unknown as DailyRecordRepositoryPort;
  return replanRayenStructure(
    makeRecord(),
    {
      sourceSnapshot: snapshot,
      egresoRows: [legacyRow],
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

describe('replanRayenStructure — ocupante manual sin episodio egresa y otro paciente llega a su cama', () => {
  it('el egreso libera la cama y el ingreso retenido se promueve en la misma corrida', async () => {
    const diff = await runPipeline();

    expect(diff.discharges.map(d => `${d.bedId}:${d.rut}`)).toEqual([`H4C1:${LEGACY_RUN}`]);
    expect(diff.admissions.map(a => `${a.bedId}:${a.patient.clinicalEpisodeId}`)).toEqual([
      'H4C1:3001',
    ]);
    expect(diff.conflicts.filter(c => c.code === 'occupied-local-bed')).toEqual([]);

    const applied = applyCensusImportDiff(makeRecord(), diff, {
      idFactory: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      now: new Date('2026-09-02T15:00:00'),
      syncRunId: 'test',
    });
    expect(applied.record.beds.H4C1?.clinicalEpisodeId).toBe('3001');
    expect(applied.record.discharges.map(d => d.rut)).toEqual([LEGACY_RUN]);
    expect(applied.skipped).toEqual([]);
  });
});
