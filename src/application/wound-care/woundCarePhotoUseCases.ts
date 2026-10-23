/**
 * Wound Care Photo Use Cases
 *
 * Upload / list / update / soft-delete wound care photographs.
 * Each use case returns an {@link ApplicationOutcome} with structured issues.
 */

import {
  createApplicationSuccess,
  createApplicationFailed,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  defaultWoundCarePhotoPort,
  defaultWoundCareStoragePort,
} from '@/application/ports/woundCarePort';
import type { WoundCareAuditActor, WoundCarePhoto } from '@/types/domain/woundCare';
import { compressImage, generateThumbnail } from '@/utils/imageCompression';
import {
  buildPhotoStoragePath,
  buildThumbnailStoragePath,
  generateId,
  todayDateString,
  type EpisodeContext,
  type WoundCarePhotoDeps,
} from './woundCareUseCaseHelpers';
import { hospitalTakenAt } from './woundCarePhotoTime';

interface PhotoUploadInput {
  file: File;
  episodeContext: EpisodeContext;
  description?: string;
  bodyLocation?: string;
  takenAt?: string;
  actor: WoundCareAuditActor;
  hospitalId: string;
}

/**
 * Upload a wound care photo with client-side compression and thumbnail generation.
 *
 * Pipeline: compress original to WebP + generate thumbnail (parallel),
 * upload both blobs to Firebase Storage (parallel), then persist
 * photo metadata (URLs, dimensions, audit fields) to Firestore.
 *
 * Consent is not a blocking requirement; photos can be uploaded
 * before or without a signed consent.
 */
export const executeUploadWoundCarePhoto = async (
  input: PhotoUploadInput,
  deps: WoundCarePhotoDeps = {}
): Promise<ApplicationOutcome<WoundCarePhoto | null>> => {
  const photoPort = deps.photoPort ?? defaultWoundCarePhotoPort;
  const storagePort = deps.storagePort ?? defaultWoundCareStoragePort;

  try {
    const [compressed, thumbnail] = await Promise.all([
      compressImage(input.file),
      generateThumbnail(input.file),
    ]);

    const photoId = generateId();
    const dateStr = todayDateString();
    const photoPath = buildPhotoStoragePath(
      input.hospitalId,
      input.episodeContext.patientRut,
      input.episodeContext.episodeKey,
      dateStr,
      photoId
    );
    const thumbPath = buildThumbnailStoragePath(
      input.hospitalId,
      input.episodeContext.patientRut,
      input.episodeContext.episodeKey,
      dateStr,
      photoId
    );

    const [photoUpload, thumbUpload] = await Promise.all([
      storagePort.uploadPhoto(compressed.blob, photoPath, {
        episodeKey: input.episodeContext.episodeKey,
        patientRut: input.episodeContext.patientRut,
      }),
      storagePort.uploadThumbnail(thumbnail.blob, thumbPath),
    ]);

    if (photoUpload.status !== 'success') {
      return createApplicationFailed(null, [
        { kind: 'unknown', message: 'Error al subir la fotografía.' },
      ]);
    }

    if (thumbUpload.status !== 'success') {
      return createApplicationFailed(null, [
        { kind: 'unknown', message: 'Error al subir la miniatura.' },
      ]);
    }

    const now = new Date().toISOString();
    const photo: WoundCarePhoto = {
      id: photoId,
      patientRut: input.episodeContext.patientRut,
      patientName: input.episodeContext.patientName,
      episodeKey: input.episodeContext.episodeKey,
      consentId: undefined,
      storagePath: photoPath,
      thumbnailStoragePath: thumbPath,
      downloadUrl: photoUpload.data as string,
      thumbnailDownloadUrl: thumbUpload.data as string,
      mimeType: compressed.blob.type,
      originalFileSize: compressed.originalSize,
      compressedFileSize: compressed.compressedSize,
      width: compressed.width,
      height: compressed.height,
      description: input.description,
      bodyLocation: input.bodyLocation,
      takenAt: input.takenAt || hospitalTakenAt(new Date(now)),
      uploadedAt: now,
      uploadedBy: input.actor,
      isDeleted: false,
    };

    const saved = await photoPort.create(photo, input.hospitalId);
    return createApplicationSuccess(saved);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message:
          error instanceof Error ? error.message : 'Error inesperado al subir la fotografía.',
      },
    ]);
  }
};

/**
 * List all non-deleted wound care photos for a hospitalization episode.
 *
 * Photos are sorted by upload date descending; soft-deleted rows are
 * excluded by the repository layer.
 */
export const executeListWoundCarePhotos = async (
  episodeKey: string,
  hospitalId?: string,
  deps: Pick<WoundCarePhotoDeps, 'photoPort'> = {}
): Promise<ApplicationOutcome<WoundCarePhoto[]>> => {
  const photoPort = deps.photoPort ?? defaultWoundCarePhotoPort;

  try {
    const photos = await photoPort.listByEpisode(episodeKey, hospitalId);
    return createApplicationSuccess(photos);
  } catch (error) {
    return createApplicationFailed(
      [],
      [
        {
          kind: 'unknown',
          message: error instanceof Error ? error.message : 'Error al listar fotografías.',
        },
      ]
    );
  }
};

/**
 * Update the free-text description of an existing wound care photo.
 */
export const executeUpdatePhotoDescription = async (
  photoId: string,
  description: string,
  hospitalId?: string,
  deps: Pick<WoundCarePhotoDeps, 'photoPort'> = {}
): Promise<ApplicationOutcome<null>> => {
  const photoPort = deps.photoPort ?? defaultWoundCarePhotoPort;

  try {
    await photoPort.updateDescription(photoId, description, hospitalId);
    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'Error al actualizar la descripción.',
      },
    ]);
  }
};

/**
 * Soft-delete a wound care photo with best-effort storage cleanup.
 *
 * Marks the Firestore metadata as deleted (audit trail with actor and
 * timestamp) first, then attempts to remove the photo and thumbnail
 * blobs from Firebase Storage. Storage failures are silently settled
 * so the metadata deletion is never rolled back.
 */
export const executeDeleteWoundCarePhoto = async (
  photoId: string,
  storagePath: string,
  thumbnailStoragePath: string,
  actor: WoundCareAuditActor,
  hospitalId?: string,
  deps: Pick<WoundCarePhotoDeps, 'photoPort' | 'storagePort'> = {}
): Promise<ApplicationOutcome<null>> => {
  const photoPort = deps.photoPort ?? defaultWoundCarePhotoPort;
  const storagePort = deps.storagePort ?? defaultWoundCareStoragePort;

  try {
    await photoPort.softDelete(photoId, actor, hospitalId);

    await Promise.allSettled([
      storagePort.deleteFile(storagePath),
      storagePort.deleteFile(thumbnailStoragePath),
    ]);

    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'Error al eliminar la fotografía.',
      },
    ]);
  }
};
