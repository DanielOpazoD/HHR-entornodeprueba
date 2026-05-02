/**
 * Wound Care Photo Repository
 *
 * Firestore CRUD and real-time subscriptions for wound care photo metadata.
 * Photos are soft-deleted (`isDeleted` flag) to preserve the medical audit trail;
 * hard deletes are never performed at this layer.
 * All reads are validated through {@link safeParseWoundCarePhoto};
 * invalid records are logged via operational telemetry and silently dropped.
 */

import { firestoreDb } from '@/services/storage/firestore';
import { getActiveHospitalId, getWoundCarePhotosPath } from '@/constants/firestorePaths';
import type { WoundCareAuditActor, WoundCarePhoto } from '@/types/domain/woundCare';
import { safeParseWoundCarePhoto } from '@/schemas/zod/woundCare';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

// ============================================================================
// Helpers
// ============================================================================

const sanitizeForFirestore = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map(item => sanitizeForFirestore(item))
      .filter(item => item !== undefined) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, sanitizeForFirestore(nested)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
};

const validateReadPhoto = (record: WoundCarePhoto): WoundCarePhoto | null => {
  const parsed = safeParseWoundCarePhoto(record);
  if (!parsed.success) {
    recordOperationalTelemetry({
      category: 'clinical_document',
      status: 'failed',
      operation: 'photo_repository_invalid_read_record',
      issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      context: { photoId: record.id, episodeKey: record.episodeKey },
    });
    return null;
  }
  return parsed.data as WoundCarePhoto;
};

const sortByUploadedAtDesc = (photos: WoundCarePhoto[]): WoundCarePhoto[] =>
  [...photos].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

// ============================================================================
// Repository
// ============================================================================

export const WoundCarePhotoRepository = {
  /**
   * List non-deleted photos for a hospitalization episode, sorted by upload date descending.
   *
   * Soft-deleted photos (`isDeleted === true`) are filtered out before
   * Zod validation and sorting.
   *
   * @param episodeKey - Composite key identifying the hospitalization episode.
   * @param hospitalId - Defaults to the active hospital.
   * @returns Photos sorted most-recent-first; empty array if none.
   */
  async listByEpisode(
    episodeKey: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCarePhoto[]> {
    const documents = await firestoreDb.getDocs<WoundCarePhoto>(
      getWoundCarePhotosPath(hospitalId),
      {
        where: [
          { field: 'episodeKey', operator: '==', value: episodeKey },
          { field: 'isDeleted', operator: '==', value: false },
        ],
        orderBy: [{ field: 'uploadedAt', direction: 'desc' }],
      }
    );

    // Client-side filter as safety net while index builds
    return sortByUploadedAtDesc(
      documents
        .filter(doc => !doc.isDeleted)
        .map(doc => validateReadPhoto(doc))
        .filter((doc): doc is WoundCarePhoto => Boolean(doc))
    );
  },

  /**
   * List all non-deleted photos across every hospitalization episode for a patient.
   *
   * Used by the multi-episode history view. Results are sorted by upload
   * date descending and validated through Zod.
   *
   * @param patientRut - Chilean RUT of the patient.
   * @param hospitalId - Defaults to the active hospital.
   * @returns Photos sorted most-recent-first across all episodes.
   */
  async listByPatientRut(
    patientRut: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCarePhoto[]> {
    const documents = await firestoreDb.getDocs<WoundCarePhoto>(
      getWoundCarePhotosPath(hospitalId),
      {
        where: [
          { field: 'patientRut', operator: '==', value: patientRut },
          { field: 'isDeleted', operator: '==', value: false },
        ],
      }
    );

    // Client-side filter as safety net while index builds
    return sortByUploadedAtDesc(
      documents
        .filter(doc => !doc.isDeleted)
        .map(doc => validateReadPhoto(doc))
        .filter((doc): doc is WoundCarePhoto => Boolean(doc))
    );
  },

  /**
   * Create a new photo metadata record in Firestore.
   *
   * The photo object is sanitized (undefined values stripped) before
   * writing to avoid Firestore serialization errors.
   *
   * @param photo      - Fully populated photo object including its `id`.
   * @param hospitalId - Defaults to the active hospital.
   * @returns The sanitized photo as persisted.
   */
  async create(
    photo: WoundCarePhoto,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCarePhoto> {
    const sanitized = sanitizeForFirestore(photo);
    await firestoreDb.setDoc(getWoundCarePhotosPath(hospitalId), photo.id, sanitized);
    return sanitized;
  },

  /**
   * Update the description field of an existing photo record.
   *
   * Only the `description` field is patched; all other fields remain untouched.
   *
   * @param photoId     - Firestore document ID of the photo.
   * @param description - New description text.
   * @param hospitalId  - Defaults to the active hospital.
   */
  async updateDescription(
    photoId: string,
    description: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    await firestoreDb.updateDoc(getWoundCarePhotosPath(hospitalId), photoId, { description });
  },

  /**
   * Soft-delete a photo by setting `isDeleted` to `true` with an audit trail.
   *
   * Records `deletedAt` (ISO timestamp) and `deletedBy` (actor) on the
   * document. The photo blob in Firebase Storage is **not** removed here;
   * storage cleanup is the caller's responsibility.
   *
   * @param photoId    - Firestore document ID of the photo.
   * @param deletedBy  - The user performing the deletion (audit trail).
   * @param hospitalId - Defaults to the active hospital.
   */
  async softDelete(
    photoId: string,
    deletedBy: WoundCareAuditActor,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    await firestoreDb.updateDoc(getWoundCarePhotosPath(hospitalId), photoId, {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: sanitizeForFirestore(deletedBy),
    });
  },

  /**
   * Subscribe to real-time photo updates for a hospitalization episode.
   *
   * The callback receives the current list of non-deleted, validated photos
   * sorted by upload date descending. Fires immediately with the current
   * state, then on every Firestore snapshot change.
   *
   * @param episodeKey - Composite key identifying the hospitalization episode.
   * @param callback   - Invoked on each snapshot with the resolved photo array.
   * @param hospitalId - Defaults to the active hospital.
   * @returns An unsubscribe function to tear down the listener.
   */
  subscribeByEpisode(
    episodeKey: string,
    callback: (photos: WoundCarePhoto[]) => void,
    hospitalId: string = getActiveHospitalId()
  ): () => void {
    return firestoreDb.subscribeQuery<WoundCarePhoto>(
      getWoundCarePhotosPath(hospitalId),
      {
        where: [
          { field: 'episodeKey', operator: '==', value: episodeKey },
          { field: 'isDeleted', operator: '==', value: false },
        ],
        orderBy: [{ field: 'uploadedAt', direction: 'desc' }],
      },
      docs =>
        // Client-side filter as safety net while index builds
        callback(
          sortByUploadedAtDesc(
            docs
              .filter(doc => !doc.isDeleted)
              .map(doc => validateReadPhoto(doc))
              .filter((doc): doc is WoundCarePhoto => Boolean(doc))
          )
        )
    );
  },
};
