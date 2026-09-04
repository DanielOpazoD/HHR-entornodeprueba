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

const BED_ID = 'H4C1';
const OCCUPANT_RUN = '11.111.111-1';
const OCCUPANT_EPISODE = '1001';
const INCOMING_EPISODE = '3001';

const incoming: RayenEncounter = {
  encounterId: INCOMING_EPISODE,
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

const makeRecord = (withEpisode: boolean): DailyRecord =>
  ({
    date: '2026-09-02',
    beds: {
      [BED_ID]: {
        ...EMPTY_PATIENT,
        bedId: BED_ID,
        patientName: 'Paciente Saliente',
        rut: OCCUPANT_RUN,
        clinicalEpisodeId: withEpisode ? OCCUPANT_EPISODE : undefined,
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

const makeReportRow = (run: string, encounterId: string): EgresoReportRow => ({
  encounterId,
  run,
  patientName: 'Paciente Saliente',
  bedLabel: BED_ID,
  servicio: 'Medicina',
  edad: '60',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '02-09-2026 10:00',
});

const repository = {
  getForDate: vi.fn().mockResolvedValue(null),
  getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
} as unknown as DailyRecordRepositoryPort;

interface IdentityScenario {
  name: string;
  withEpisode: boolean;
  reportRun: string;
  reportEpisode: string;
  shouldReplace: boolean;
}

const scenarios: IdentityScenario[] = [
  {
    name: 'ocupante normal con RUN y episodio coincidentes',
    withEpisode: true,
    reportRun: OCCUPANT_RUN,
    reportEpisode: OCCUPANT_EPISODE,
    shouldReplace: true,
  },
  {
    name: 'ocupante normal con RUN desactualizado pero episodio exacto',
    withEpisode: true,
    reportRun: '22.222.222-2',
    reportEpisode: OCCUPANT_EPISODE,
    shouldReplace: true,
  },
  {
    name: 'mismo RUN pero episodio de otra hospitalización',
    withEpisode: true,
    reportRun: OCCUPANT_RUN,
    reportEpisode: 'otro-episodio',
    shouldReplace: false,
  },
  {
    name: 'reporte sin RUN pero con episodio exacto',
    withEpisode: true,
    reportRun: '',
    reportEpisode: OCCUPANT_EPISODE,
    shouldReplace: true,
  },
  {
    name: 'ocupante manual con RUN y sello de ingreso verificables',
    withEpisode: false,
    reportRun: OCCUPANT_RUN,
    reportEpisode: '',
    shouldReplace: true,
  },
  {
    name: 'ocupante manual con RUN diferente en el reporte',
    withEpisode: false,
    reportRun: '22.222.222-2',
    reportEpisode: '',
    shouldReplace: false,
  },
  {
    name: 'ocupante manual con reporte sin RUN',
    withEpisode: false,
    reportRun: '',
    reportEpisode: '',
    shouldReplace: false,
  },
];

describe('invariantes de identidad entre vista previa y aplicación de egresos Rayen', () => {
  it.each(scenarios)('$name', async scenario => {
    const current = makeRecord(scenario.withEpisode);
    const diff = await replanRayenStructure(
      current,
      {
        sourceSnapshot: snapshot,
        egresoRows: [makeReportRow(scenario.reportRun, scenario.reportEpisode)],
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

    const previewReplacesOccupant = diff.admissions.some(
      admission =>
        admission.bedId === BED_ID && admission.patient.clinicalEpisodeId === INCOMING_EPISODE
    );
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: (() => {
        let sequence = 0;
        return () => `identity-matrix-${++sequence}`;
      })(),
      now: new Date('2026-09-02T15:00:00'),
      syncRunId: 'identity-invariant-matrix',
    });
    const applyReplacesOccupant =
      applied.record.beds[BED_ID]?.clinicalEpisodeId === INCOMING_EPISODE;
    const previewedDischargeMovements = diff.discharges.length + (diff.reportEgresos?.length ?? 0);

    expect(previewReplacesOccupant).toBe(scenario.shouldReplace);
    expect(applyReplacesOccupant).toBe(previewReplacesOccupant);
    expect(applied.applied.admissions).toBe(diff.admissions.length);
    expect(applied.applied.discharges).toBe(previewedDischargeMovements);

    if (scenario.shouldReplace) {
      expect(diff.discharges).toEqual([
        expect.objectContaining({
          bedId: BED_ID,
          rut: OCCUPANT_RUN,
          encounterId: scenario.withEpisode ? OCCUPANT_EPISODE : '',
          expectedOccupant: expect.objectContaining({
            clinicalEpisodeId: scenario.withEpisode ? OCCUPANT_EPISODE : undefined,
            rut: OCCUPANT_RUN,
            admissionDate: '2026-08-30',
            admissionTime: '09:00',
          }),
        }),
      ]);
      expect(applied.record.discharges).toEqual([
        expect.objectContaining({
          bedId: BED_ID,
          rut: OCCUPANT_RUN,
          clinicalEpisodeId: scenario.withEpisode ? OCCUPANT_EPISODE : undefined,
        }),
      ]);
    } else {
      expect(diff.conflicts).not.toHaveLength(0);
      expect(applied.record.beds[BED_ID]).toEqual(current.beds[BED_ID]);
    }
  });
});
