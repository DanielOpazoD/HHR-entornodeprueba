import type { EgresoReportRow, RayenCensusSnapshot, RayenEncounter } from '@/features/rayen-import';
import { rayenToPatientData } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

export const REPLAY_NOW = new Date('2026-08-16T01:05:00.000Z');
export const CURRENT_CLINICAL_DAY = '2026-08-15';

const SYNTHETIC_RUNS: Record<string, string> = {
  admission: 'TEST-0001',
  readmission: 'TEST-0002',
  mother: 'TEST-0003',
  newborn: 'TEST-0004',
  departing: 'TEST-0005',
  moving: 'TEST-0006',
  incoming: 'TEST-0007',
  shortStay: 'TEST-0008',
};

/** Sanitized encounter factory. Values are synthetic and intentionally carry no real identity. */
export const syntheticEncounter = (
  key: keyof typeof SYNTHETIC_RUNS,
  overrides: Partial<RayenEncounter> = {}
): RayenEncounter => ({
  encounterId: `episode-${key}`,
  run: SYNTHETIC_RUNS[key],
  firstGivenName: 'Caso',
  firstFamilyName: key,
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C1',
  admissionDatetime: '2026-08-15T10:00:00-06:00',
  diagnosis: 'Diagnóstico sintético',
  ...overrides,
});

export const snapshotFor = (
  date: string,
  encounters: RayenEncounter[],
  isComplete = true
): RayenCensusSnapshot => ({
  capturedAt: `${date}T19:00:00-06:00`,
  facilityId: 1342,
  encounters,
  isComplete,
});

export const emptyRecordFor = (date: string, overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: `${date}T09:00:00.000Z`,
    ...overrides,
  }) as DailyRecord;

export const patientAt = (
  encounter: RayenEncounter,
  bedId: string,
  reference = REPLAY_NOW
): DailyRecord['beds'][string] => ({
  ...rayenToPatientData(encounter, reference).patient,
  bedId,
});

export const vitalSignsForm = (date: string, eventId: number) => ({
  formCodigo: 'VITAL_SIGNS',
  nameForm: 'Signos vitales sintéticos',
  encounterEventId: eventId,
  createDateTime: `${date.split('-').reverse().join('-')} 12:00:00 -06:00`,
  metaCampList: [
    { id: 'global_PASSent', value: '118' },
    { id: 'global_PADSent', value: '72' },
    { id: 'global_Pulso', value: '76' },
    { id: 'exa_Fisic_G_SaturacionO2', value: '98' },
  ],
});

export const bradenHistoryEvent = (date: string, total = 17) => ({
  publishDatetime: `${date}T12:01:00`,
  evaluationInstrumentsResume: [
    {
      FORM_NAME: 'Escala de riesgo UPP (Braden)',
      LABEL: 'Puntaje',
      VALUE: String(total),
      ARCHIVED: false,
    },
    {
      FORM_NAME: 'Escala de riesgo UPP (Braden)',
      LABEL: 'Nivel de Severidad',
      VALUE: 'Riesgo bajo',
      ARCHIVED: false,
    },
  ],
});

export const verifiedShortStayDischarge = (): EgresoReportRow => ({
  run: SYNTHETIC_RUNS.shortStay,
  encounterId: 'episode-shortStay',
  patientName: 'Caso shortStay',
  bedLabel: 'H4C2',
  servicio: 'Área Médico Quirúrgica Indiferenciada',
  edad: '60 año(s)',
  destino: 'Fallecido',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '15-08-2026 18:30',
  correctedDay: CURRENT_CLINICAL_DAY,
  correctedTime: '16:30',
  admissionDay: CURRENT_CLINICAL_DAY,
  admissionTime: '15:20',
  dischargeStatus: 'Fallecido',
  exactEpisodeVerification: 'verified',
  diagnostico: 'Diagnóstico sintético',
});
