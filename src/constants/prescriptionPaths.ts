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
