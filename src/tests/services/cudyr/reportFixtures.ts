import type { CudyrReportInput } from '@/services/cudyr/cudyrReportModel';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecordCudyrExportState } from '@/types/domain/dailyRecordSlices';
import type { CudyrHistoryObservation } from '@/types/domain/cudyrHistory';
import type { CudyrCaptureReceipt } from '@/types/domain/cudyrCapture';
import type { CudyrSourcePlacement } from '@/types/domain/cudyrPlacement';
import { EMPTY_CUDYR_SCORE } from '@/services/cudyr/CudyrScoreUtils';

export const reportPatient = (patch: Partial<PatientData> = {}): PatientData =>
  ({
    bedId: 'R1',
    bedMode: 'Cama',
    patientName: 'Paciente Sintético',
    firstName: 'Paciente',
    lastName: 'Sintético',
    secondLastName: 'Ejemplo',
    rut: 'synthetic-rut',
    documentType: 'RUT',
    clinicalEpisodeId: 'synthetic-episode',
    pathology: 'Diagnóstico sintético',
    admissionDate: '2026-09-20',
    admissionTime: '10:00',
    isBlocked: false,
    hasCompanionCrib: false,
    cudyr: { ...EMPTY_CUDYR_SCORE, surveillance: 3, psychosocial: 3, vitalSigns: 2 },
    ...patch,
  }) as PatientData;
export const reportRecord = (
  date = '2026-10-02',
  beds: Record<string, PatientData> = { R1: reportPatient() }
): DailyRecordCudyrExportState => ({
  date,
  beds,
  activeExtraBeds: [],
  lastUpdated: date + 'T20:00:00Z',
  discharges: [],
  transfers: [],
  cma: [],
});
export const reportObservation = (
  patch: Partial<CudyrHistoryObservation> = {}
): CudyrHistoryObservation => ({
  schemaVersion: 1,
  id: 'observation-1',
  eventKey: 'event-1',
  censusDate: '2026-10-02',
  attributionRule: 'hhr-night-v1',
  evaluation: {
    clinicalEpisodeId: 'synthetic-episode',
    sourceEvaluationId: 'event-1',
    source: 'gestion_camas',
    category: 'C2',
    recordedAt: '2026-10-03T03:00:00-05:00',
    author: 'Autora Sintética',
    authorId: 'author-1',
    authorRole: 'Enfermera',
    dependencyScore: 9,
    riskScore: 8,
  },
  firstCapturedAt: '2026-10-03T15:00:00Z',
  lastVerifiedAt: '2026-10-03T15:00:00Z',
  firstCapturedBy: 'sync@example.com',
  firstCaptureRunId: 'run',
  lastVerifiedRunId: 'run',
  captureCensusDate: '2026-10-03',
  captureContexts: [
    {
      clinicalEpisodeId: 'synthetic-episode',
      bedId: 'R1',
      section: 'census',
      patientName: 'Paciente Sintético',
      rut: 'synthetic-rut',
      admissionDate: '2026-09-20',
      admissionTime: '10:00',
    },
  ],
  ...patch,
});
export const reportPlacement = (
  patch: Partial<CudyrSourcePlacement> = {}
): CudyrSourcePlacement => ({
  clinicalEpisodeId: 'synthetic-episode',
  sourceMappingId: 'mapping',
  sourceBedId: 'source-bed',
  sourceBedLabel: 'R1',
  sourceDepartmentId: 'service',
  sourceDepartmentLabel: 'Médico quirúrgico',
  sourceVersion: 'opaque-token',
  sourceStartAt: '2026-09-20T10:00:00-05:00',
  sourceEndAt: '0001-01-01T00:00:00+00:00',
  currentAssignment: true,
  isDeleted: false,
  bedId: 'R1',
  modality: 'hospitalizacion',
  ...patch,
});
export const reportCapture = (patch: Partial<CudyrCaptureReceipt> = {}): CudyrCaptureReceipt => ({
  schemaVersion: 1,
  id: 'receipt',
  censusDate: '2026-10-02',
  observationIds: ['observation-1'],
  capture: {
    id: 'capture',
    clinicalEpisodeId: 'synthetic-episode',
    sourceRunId: 'run',
    observedAt: '2026-10-04T15:00:00Z',
    status: 'observed',
    metadataStatus: 'complete',
    part: 0,
    totalParts: 1,
    totalEvaluations: 1,
  },
  captureContexts: reportObservation().captureContexts,
  receivedAt: '2026-10-04T15:01:00Z',
  receivedBy: 'sync@example.com',
  verifiedRunId: 'run',
  ...patch,
});
export const reportInput = (patch: Partial<CudyrReportInput> = {}): CudyrReportInput => ({
  from: '2026-10-01',
  to: '2026-10-04',
  generatedAt: '2026-10-05T15:00:00Z',
  records: [reportRecord()],
  observations: [],
  captures: [],
  corrections: [],
  dischargeAudit: [],
  pending: [],
  issues: [],
  coverage: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map(date => ({
    date,
    state: 'disponible',
    lastSyncedAt: '',
    runId: '',
  })),
  ...patch,
});

/** Eligibility-focused tests explicitly include independent, confirmed source bed intervals. */
export const confirmedReportInput = (patch: Partial<CudyrReportInput> = {}): CudyrReportInput => {
  const input = reportInput(patch);
  const evidence = new Map<string, CudyrCaptureReceipt>();
  for (const record of input.records)
    for (const patient of Object.values(record.beds)) {
      const episode = patient.clinicalEpisodeId;
      if (
        !episode ||
        evidence.has(episode) ||
        !patient.admissionDate ||
        !patient.admissionTime ||
        input.captures.some(receipt =>
          receipt.capture.sourcePlacements?.some(p => p.clinicalEpisodeId === episode)
        )
      )
        continue;
      const receipt = reportCapture({
        id: 'admission-' + episode,
        censusDate: patient.admissionDate,
        observationIds: [],
        captureContexts: [],
      });
      receipt.capture = {
        ...receipt.capture,
        id: receipt.id,
        clinicalEpisodeId: episode,
        observedAt: input.generatedAt,
        sourcePlacements: [
          reportPlacement({
            clinicalEpisodeId: episode,
            sourceMappingId: 'admission-' + episode,
            bedId: patient.bedId,
            sourceBedLabel: patient.bedId,
            sourceDepartmentLabel: patient.location || 'Médico quirúrgico',
            modality: patient.bedMode === 'Cuna' ? 'cuna' : 'hospitalizacion',
            sourceStartAt: patient.admissionDate + 'T' + patient.admissionTime + ':00-05:00',
          }),
        ],
      };
      evidence.set(episode, receipt);
    }
  return { ...input, captures: [...input.captures, ...evidence.values()] };
};
