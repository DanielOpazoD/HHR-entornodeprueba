import {
  canArchiveClinicalDocuments,
  canDeleteClinicalDocuments,
  canEditClinicalDocuments,
  canReadClinicalDocuments,
} from '@/shared/access/clinicalDocumentAccessPolicy';

/**
 * Role-based permission guards for clinical document operations.
 * Re-exported from the application-level access policy for use within the feature.
 */
export {
  /** Checks whether the user's role allows archiving clinical documents. */
  canArchiveClinicalDocuments,
  /** Checks whether the user's role allows deleting clinical documents. */
  canDeleteClinicalDocuments,
  /** Checks whether the user's role allows editing clinical documents. */
  canEditClinicalDocuments,
  /** Checks whether the user's role allows reading clinical documents. */
  canReadClinicalDocuments,
};
