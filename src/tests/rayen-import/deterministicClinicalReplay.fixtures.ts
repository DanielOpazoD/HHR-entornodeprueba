import type {
  EgresoReportRow,
  RayenCensusSnapshot,
  RayenEncounter,
  RayenSyncBundle,
} from '@/features/rayen-import';
import {
  cancelRayenSyncBundleRequest,
  rayenToPatientData,
  requestRayenSyncBundle,
  subscribeToRayenSnapshots,
} from '@/features/rayen-import';
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

/** Guarded, synthetic dual-source evidence matching the snapshot capture instant. */
export const syncBundleFor = (
  date: string,
  snapshot: RayenCensusSnapshot,
  egresoRows: EgresoReportRow[] = []
): RayenSyncBundle => {
  const fichaCapturedAt = Date.parse(snapshot.capturedAt);
  const gestionCapturedAt = fichaCapturedAt + 1_000;
  return {
    id: `synthetic-bundle-${date}`,
    startedAt: new Date(fichaCapturedAt - 1_000).toISOString(),
    completedAt: new Date(gestionCapturedAt + 1_000).toISOString(),
    facilityId: snapshot.facilityId,
    dateStart: date,
    dateEnd: date,
    fichaMedicoCapturedAt: snapshot.capturedAt,
    gestionCamasCapturedAt: new Date(gestionCapturedAt).toISOString(),
    sourceSkewMs: 1_000,
    egresoRows,
  };
};

export interface SyntheticRayenCapture {
  snapshot: RayenCensusSnapshot;
  bundle: RayenSyncBundle;
}

/** Production-shaped evidence emitted together by the guarded extension capture. */
export const captureFor = (
  date: string,
  encounters: RayenEncounter[],
  egresoRows: EgresoReportRow[] = [],
  isComplete = true
): SyntheticRayenCapture => {
  const snapshot = snapshotFor(date, encounters, isComplete);
  return { snapshot, bundle: syncBundleFor(date, snapshot, egresoRows) };
};

/** Delivers capture evidence through the same request-correlation guard used in production. */
export const receiveCorrelatedCapture = (capture: SyntheticRayenCapture): SyntheticRayenCapture => {
  const delivery: { accepted: SyntheticRayenCapture | null } = { accepted: null };
  const unsubscribe = subscribeToRayenSnapshots((snapshot, bundle) => {
    delivery.accepted = { snapshot, bundle };
  });
  const requestId = requestRayenSyncBundle(capture.bundle.dateStart, capture.bundle.dateEnd);
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      data: {
        type: 'HHR_RAYEN_CENSUS_SNAPSHOT',
        requestId: `${requestId}-stale`,
        snapshot: capture.snapshot,
        bundle: capture.bundle,
      },
    })
  );
  if (delivery.accepted) {
    unsubscribe();
    cancelRayenSyncBundleRequest(requestId);
    throw new Error('El puente aceptó evidencia de una solicitud no correlacionada.');
  }
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      data: {
        type: 'HHR_RAYEN_CENSUS_SNAPSHOT',
        requestId,
        snapshot: capture.snapshot,
        bundle: capture.bundle,
      },
    })
  );
  unsubscribe();
  if (!delivery.accepted) {
    cancelRayenSyncBundleRequest(requestId);
    throw new Error('La captura sintética no superó el contrato correlacionado de Rayen.');
  }
  return delivery.accepted;
};

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
  exactEpisodeVerification: 'verified',
  diagnostico: 'Diagnóstico sintético',
});
