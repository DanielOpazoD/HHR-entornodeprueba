import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { PatientData } from '@/types/domain/patient';
import type { CensusWorkbookSheetDescriptor } from '@/services/exporters/censusMasterWorkbook';
import {
  CensusEmailRequestPayloadSchema,
  type CensusEmailRequestPayload,
} from '@/contracts/serverless';

export interface CensusEmailRequestPayloadInput extends Omit<
  CensusEmailRequestPayload,
  'shareLink'
> {
  date: string;
  records: CensusExportRecord[];
  recipients: string[];
  nursesSignature?: string;
  body?: string;
  sheetDescriptors?: CensusWorkbookSheetDescriptor[];
}

// The workbook never reads what the clinical sync derives per bed (about 38 KB per occupied bed)
// nor the embedded Rayen sync log: most of each day's weight. The request leaves them out; the
// server drops the same fields from its slim history copies. See
// docs/ADR_DAILY_RECORD_DOCUMENT_GRANULARITY.md.
const withoutDerivedClinicalSync = ({
  clinicalSyncCheckpoint: _checkpoint,
  vitalSignsHistory: _vitalsHistory,
  evaluationScores: _scores,
  ...patient
}: PatientData): PatientData => ({
  ...patient,
  ...(patient.clinicalCrib
    ? { clinicalCrib: withoutDerivedClinicalSync(patient.clinicalCrib) }
    : {}),
});

const withSlimSnapshot = <T extends { originalData?: PatientData }>(movement: T): T =>
  movement.originalData
    ? { ...movement, originalData: withoutDerivedClinicalSync(movement.originalData) }
    : movement;

export const stripDerivedClinicalSync = (record: CensusExportRecord): CensusExportRecord => {
  const { rayenSyncHistory: _syncLog, ...rest } = record as CensusExportRecord & {
    rayenSyncHistory?: unknown;
  };
  return {
    ...rest,
    beds: Object.fromEntries(
      Object.entries(record.beds).map(([bedId, patient]) => [
        bedId,
        withoutDerivedClinicalSync(patient),
      ])
    ),
    ...(record.discharges ? { discharges: record.discharges.map(withSlimSnapshot) } : {}),
    ...(record.transfers ? { transfers: record.transfers.map(withSlimSnapshot) } : {}),
    ...(record.cma ? { cma: record.cma.map(withSlimSnapshot) } : {}),
  };
};

export const buildCensusEmailRequestBody = (input: CensusEmailRequestPayloadInput): string =>
  JSON.stringify(
    CensusEmailRequestPayloadSchema.parse({
      date: input.date,
      records: input.records.map(stripDerivedClinicalSync),
      recipients: input.recipients,
      nursesSignature: input.nursesSignature,
      body: input.body,
      sheetDescriptors: input.sheetDescriptors,
    })
  );
