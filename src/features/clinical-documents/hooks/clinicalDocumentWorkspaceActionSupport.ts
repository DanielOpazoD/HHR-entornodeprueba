import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';

export const resolveClinicalDocumentOutcomeError = <T>(
  outcome: ApplicationOutcome<T>,
  fallback: string
): string | null => {
  if (outcome.status === 'success') {
    return null;
  }

  return (
    outcome.userSafeMessage ||
    outcome.issues[0]?.userSafeMessage ||
    outcome.issues[0]?.message ||
    fallback
  );
};

export const resolveClinicalDocumentExceptionMessage = (
  error: unknown,
  fallback: string
): string => (error instanceof Error ? error.message : fallback);

export const shouldClearSelectedClinicalDocument = (
  selectedDocumentId: string | null,
  targetDocumentId: string
): boolean => selectedDocumentId === targetDocumentId;

type PdfExportTarget = Pick<ClinicalDocumentRecord, 'id' | 'hospitalId' | 'episodeKey'>;

const matchesPdfExportTarget = (
  previous: ClinicalDocumentRecord | null,
  target: PdfExportTarget
): boolean =>
  previous?.id === target.id &&
  previous.hospitalId === target.hospitalId &&
  previous.episodeKey === target.episodeKey;

export const updateClinicalDocumentPdfFailure = (
  previous: ClinicalDocumentRecord | null,
  errorMessage: string,
  target: PdfExportTarget
): ClinicalDocumentRecord | null =>
  previous && matchesPdfExportTarget(previous, target)
    ? {
        ...previous,
        pdf: {
          ...previous.pdf,
          exportStatus: 'failed',
          exportError: errorMessage,
        },
      }
    : previous;

export const updateClinicalDocumentPdfSuccess = (
  previous: ClinicalDocumentRecord | null,
  pdf: NonNullable<ClinicalDocumentRecord['pdf']>,
  target: PdfExportTarget
): ClinicalDocumentRecord | null =>
  previous && matchesPdfExportTarget(previous, target)
    ? {
        ...previous,
        pdf,
      }
    : previous;
