import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import {
  hydrateLegacyClinicalDocument,
  normalizeClinicalDocumentForPersistence,
} from '@/domain/clinical-documents/compatibility';

export interface ClinicalDocumentCompatibilityPort {
  hydrateClinicalDocumentRecord: (record: ClinicalDocumentRecord) => ClinicalDocumentRecord;
  normalizeClinicalDocumentRecordForStorage: (
    record: ClinicalDocumentRecord
  ) => ClinicalDocumentRecord;
}

export const defaultClinicalDocumentCompatibilityPort: ClinicalDocumentCompatibilityPort = {
  hydrateClinicalDocumentRecord: record => hydrateLegacyClinicalDocument(record),
  normalizeClinicalDocumentRecordForStorage: record =>
    normalizeClinicalDocumentForPersistence(record),
};

export const hydrateClinicalDocumentRecord = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord =>
  defaultClinicalDocumentCompatibilityPort.hydrateClinicalDocumentRecord(record);

export const normalizeClinicalDocumentRecordForStorage = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord =>
  defaultClinicalDocumentCompatibilityPort.normalizeClinicalDocumentRecordForStorage(record);
