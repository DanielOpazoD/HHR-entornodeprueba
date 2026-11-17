/**
 * Prescription Storage / Firestore Path Constants
 *
 * Single source of truth for the locations the prescriptions backup module
 * reads and writes. Both client and Cloud Functions consume these so the
 * tree layout cannot drift between layers.
 */

import { getActiveHospitalId } from '@/constants/firestorePaths';

/** Firestore subcollection holding prescription metadata records. */
export const getPrescriptionsCollectionPath = (
  hospitalId: string = getActiveHospitalId()
): string => `hospitals/${hospitalId}/prescriptions`;

/**
 * Storage prefix for prescription images. Each record stores its full
 * image at `${prefix}/${id}/full.jpg` and its thumbnail at
 * `${prefix}/${id}/thumb.jpg`. Cleanup function deletes both blobs when
 * the record expires.
 *
 * Layout uses the top-level `prescriptions/` collection (matching the
 * existing convention of `wound-care/`, `cudyr-backup/`, etc. in
 * Storage), with `hospitalId` as a sub-segment for tenant isolation.
 */
export const getPrescriptionsStoragePrefix = (hospitalId: string = getActiveHospitalId()): string =>
  `prescriptions/${hospitalId}`;
