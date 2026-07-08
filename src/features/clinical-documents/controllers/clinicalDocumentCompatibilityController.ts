import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import {
  hydrateClinicalDocumentRecord,
  normalizeClinicalDocumentRecordForStorage,
} from '@/application/ports/clinicalDocumentCompatibilityPort';
import { resolveClinicalDocumentSchemaVersion } from '@/domain/clinical-documents/compatibility';

/**
 * Feature-facing compatibility facade. The migration logic lives in the
 * application port/domain boundary so repository, import and workspace reads
 * cannot drift independently.
 */
export const hydrateLegacyClinicalDocument = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => hydrateClinicalDocumentRecord(record);

export const normalizeClinicalDocumentForPersistence = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => normalizeClinicalDocumentRecordForStorage(record);

export { resolveClinicalDocumentSchemaVersion };
