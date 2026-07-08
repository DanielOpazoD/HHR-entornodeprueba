import type {
  ClinicalDocumentAuditActor,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/internal';
import {
  duplicateClinicalDocumentDraft,
  safeParseClinicalDocumentRecord,
} from '@/features/clinical-documents/internal';
import { hydrateClinicalDocumentRecord } from '@/application/ports/clinicalDocumentCompatibilityPort';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

export const CLINICAL_DOCUMENT_JSON_EXPORT_SCHEMA = 'hhr.clinical-document.export.v1';

export interface ClinicalDocumentJsonExportPayload {
  schema: typeof CLINICAL_DOCUMENT_JSON_EXPORT_SCHEMA;
  exportedAt: string;
  document: ClinicalDocumentRecord;
}

const IMPORTED_TITLE_SUFFIX = '(importado)';

const normalizeFileNamePart = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const buildImportedClinicalDocumentTitle = (title: string): string => {
  const normalizedTitle = title.trim();
  return /\(importado\)$/i.test(normalizedTitle)
    ? normalizedTitle
    : `${normalizedTitle} ${IMPORTED_TITLE_SUFFIX}`;
};

const createValidationFailure = (
  message: string
): ApplicationOutcome<ClinicalDocumentRecord | null> =>
  createApplicationFailed(null, [{ kind: 'validation', message }]);

export const buildClinicalDocumentJsonExport = (
  document: ClinicalDocumentRecord,
  exportedAt = new Date().toISOString()
): ClinicalDocumentJsonExportPayload => ({
  schema: CLINICAL_DOCUMENT_JSON_EXPORT_SCHEMA,
  exportedAt,
  document,
});

export const buildClinicalDocumentJsonFileName = (document: ClinicalDocumentRecord): string => {
  const date = normalizeFileNamePart(document.sourceDailyRecordDate || document.audit.updatedAt);
  const patient = normalizeFileNamePart(document.patientName || document.patientRut || 'paciente');
  const title = normalizeFileNamePart(document.title || document.documentType);
  return ['documento-clinico', date, patient, title].filter(Boolean).join('-') + '.json';
};

export const stringifyClinicalDocumentJsonExport = (
  document: ClinicalDocumentRecord,
  exportedAt?: string
): string => JSON.stringify(buildClinicalDocumentJsonExport(document, exportedAt), null, 2);

export const prepareClinicalDocumentJsonImportDraft = (
  rawJson: string,
  actor: ClinicalDocumentAuditActor
): ApplicationOutcome<ClinicalDocumentRecord | null> => {
  let payload: unknown;

  try {
    payload = JSON.parse(rawJson);
  } catch {
    return createValidationFailure('El archivo JSON no es válido.');
  }

  if (!payload || typeof payload !== 'object') {
    return createValidationFailure('El archivo JSON no contiene un documento clínico válido.');
  }

  const candidate = payload as Partial<ClinicalDocumentJsonExportPayload>;
  if (candidate.schema !== CLINICAL_DOCUMENT_JSON_EXPORT_SCHEMA) {
    return createValidationFailure(
      'El archivo no corresponde a una exportación clínica HHR válida.'
    );
  }

  try {
    const hydrated = hydrateClinicalDocumentRecord(candidate.document as ClinicalDocumentRecord);
    const parsed = safeParseClinicalDocumentRecord(hydrated);
    if (!parsed.success) {
      return createValidationFailure(
        'El documento clínico importado no cumple el contrato esperado.'
      );
    }

    const importedDraft = duplicateClinicalDocumentDraft(parsed.data, actor);
    return createApplicationSuccess({
      ...importedDraft,
      title: buildImportedClinicalDocumentTitle(parsed.data.title),
    });
  } catch {
    return createValidationFailure(
      'El documento clínico importado no cumple el contrato esperado.'
    );
  }
};
