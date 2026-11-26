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
import { safeParseWoundCarePhoto } from '@/features/wound-care/schemas/woundCare';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

// ============================================================================
// Helpers
// ============================================================================

const sanitizeForFirestore = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeForFirestore(item)).filter(item => item !== undefined) as T;
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
      issues: parsed.error.issues.map(
        issue => `${issue.path.map(String).join('.')}: ${issue.message}`
      ),
      context: { photoId: record.id, episodeKey: record.episodeKey },
    });
    return null;
  }
  return parsed.data as WoundCarePhoto;
};

const EPISODE_KEY_QUERY_CHUNK_SIZE = 30;

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
   * Count non-deleted, schema-valid photos across multiple hospitalization episodes in batches.
   *
   * Uses Firestore `in` queries on the single-field `episodeKey` index (chunks of 30) and filters
   * soft-deleted or malformed records client-side so a full handoff ward resolves in one read
   * without requiring a new composite index. Read errors propagate to callers (SAVE-01).
   */
  async countByEpisodeKeys(
    episodeKeys: readonly string[],
    hospitalId: string = getActiveHospitalId()
  ): Promise<Record<string, number>> {
    const uniqueEpisodeKeys = Array.from(
      new Set(episodeKeys.map(key => key.trim()).filter(Boolean))
    );
    if (uniqueEpisodeKeys.length === 0) {
      return {};
    }

    const counts: Record<string, number> = Object.fromEntries(
      uniqueEpisodeKeys.map(key => [key, 0])
    );

    const chunks: string[][] = [];
    for (let index = 0; index < uniqueEpisodeKeys.length; index += EPISODE_KEY_QUERY_CHUNK_SIZE) {
      chunks.push(uniqueEpisodeKeys.slice(index, index + EPISODE_KEY_QUERY_CHUNK_SIZE));
    }

    const chunkedResults = await Promise.all(
      chunks.map(chunk =>
        firestoreDb.getDocs<WoundCarePhoto>(getWoundCarePhotosPath(hospitalId), {
          where: [{ field: 'episodeKey', operator: 'in', value: chunk }],
        })
      )
    );

    for (const photo of chunkedResults.flat()) {
      if (photo.isDeleted) continue;
      const valid = validateReadPhoto(photo);
      if (!valid) continue;
      const currentCount = counts[valid.episodeKey];
      if (currentCount !== undefined) {
        counts[valid.episodeKey] = currentCount + 1;
      }
    }

    return counts;
  },

  /**
   * List all non-deleted photos across every hospitalization episode for a patient.
   *
   * Reads directly from the Firestore server (`source: 'server'`) so an offline cold cache
   * never disguises missing data as an empty gallery, and fails closed if any active record
   * fails Zod validation (SAVE-01).
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
        // Query by patientRut only so legacy/valid docs omitting `isDeleted` (which schema defaults
        // to `false`) are not excluded by Firestore before validation; filter soft deletes client-side.
        where: [{ field: 'patientRut', operator: '==', value: patientRut }],
        source: 'server',
      }
    );

    const validPhotos: WoundCarePhoto[] = [];
    let invalidCount = 0;
    for (const doc of documents) {
      if (doc.isDeleted === true) continue;
      const valid = validateReadPhoto(doc);
      if (valid) validPhotos.push(valid);
      else invalidCount += 1;
    }

    if (invalidCount > 0) {
      throw new Error(
        `No se pudieron validar ${invalidCount} fotografía(s) del historial clínico.`
      );
    }

    return sortByUploadedAtDesc(validPhotos);
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
