/**
 * The clinical document contract lives once, in `@/domain/clinical-documents/runtimeContracts`,
 * because `ClinicalDocumentRepository` parses with it on every save and read. A second copy here
 * drifted and the repository silently stripped `includePatientSignature`, `annexIncludedInPrint`
 * and the IEEH doctor overrides. This module only keeps the feature's typed entry points.
 */
import {
  parseClinicalDocumentRecord as parseDomainRecord,
  parseClinicalDocumentTemplate as parseDomainTemplate,
} from '@/domain/clinical-documents/runtimeContracts';
import type {
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
} from '@/features/clinical-documents/domain/entities';

export {
  clinicalDocumentRecordSchema,
  clinicalDocumentTemplateSchema,
  formatClinicalDocumentContractIssues,
  safeParseClinicalDocumentRecord,
  safeParseClinicalDocumentTemplate,
} from '@/domain/clinical-documents/runtimeContracts';

export const parseClinicalDocumentRecord = (record: unknown): ClinicalDocumentRecord =>
  parseDomainRecord(record) as unknown as ClinicalDocumentRecord;

export const parseClinicalDocumentTemplate = (template: unknown): ClinicalDocumentTemplate =>
  parseDomainTemplate(template) as unknown as ClinicalDocumentTemplate;
