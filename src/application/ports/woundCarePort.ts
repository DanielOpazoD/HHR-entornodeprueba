/**
 * Wound Care Ports
 *
 * Dependency injection interfaces for wound care consent, photo,
 * and storage operations. Default wiring to concrete repositories.
 */

import { WoundCareConsentRepository } from '@/services/repositories/WoundCareConsentRepository';
import { WoundCarePhotoRepository } from '@/services/repositories/WoundCarePhotoRepository';
import { woundCareStorageService } from '@/services/backup/woundCareStorageService';
import type {
  WoundCareConsent,
  WoundCareAuditActor,
  WoundCareMobileUploadSession,
  WoundCarePhoto,
} from '@/types/domain/woundCare';
import { WoundCareMobileUploadSessionRepository } from '@/services/repositories/WoundCareMobileUploadSessionRepository';
import type { BackupStorageMutationResult } from '@/services/backup/backupStorageRuntimeSupport';

// ============================================================================
// Consent Port
// ============================================================================

export interface WoundCareConsentPort {
  getByEpisode: (episodeKey: string, hospitalId?: string) => Promise<WoundCareConsent | null>;
  getAnyByEpisode: (episodeKey: string, hospitalId?: string) => Promise<WoundCareConsent | null>;
  listByPatientRut: (patientRut: string, hospitalId?: string) => Promise<WoundCareConsent[]>;
  create: (consent: WoundCareConsent, hospitalId?: string) => Promise<WoundCareConsent>;
  revoke: (
    consentId: string,
    patch: {
      revokedAt: string;
      revokedBy: WoundCareAuditActor;
      revocationReason: string;
    },
    hospitalId?: string
  ) => Promise<void>;
  subscribeByEpisode: (
    episodeKey: string,
    callback: (consent: WoundCareConsent | null) => void,
    hospitalId?: string
  ) => () => void;
}

export const defaultWoundCareConsentPort: WoundCareConsentPort = {
  getByEpisode: (episodeKey, hospitalId) =>
    WoundCareConsentRepository.getByEpisode(episodeKey, hospitalId),
  getAnyByEpisode: (episodeKey, hospitalId) =>
    WoundCareConsentRepository.getAnyByEpisode(episodeKey, hospitalId),
  listByPatientRut: (patientRut, hospitalId) =>
    WoundCareConsentRepository.listByPatientRut(patientRut, hospitalId),
  create: (consent, hospitalId) => WoundCareConsentRepository.create(consent, hospitalId),
  revoke: (consentId, patch, hospitalId) =>
    WoundCareConsentRepository.revoke(consentId, patch, hospitalId),
  subscribeByEpisode: (episodeKey, callback, hospitalId) =>
    WoundCareConsentRepository.subscribeByEpisode(episodeKey, callback, hospitalId),
};

// ============================================================================
// Photo Port
// ============================================================================

export interface WoundCarePhotoPort {
  listByEpisode: (episodeKey: string, hospitalId?: string) => Promise<WoundCarePhoto[]>;
  listByPatientRut: (patientRut: string, hospitalId?: string) => Promise<WoundCarePhoto[]>;
  create: (photo: WoundCarePhoto, hospitalId?: string) => Promise<WoundCarePhoto>;
  updateDescription: (photoId: string, description: string, hospitalId?: string) => Promise<void>;
  softDelete: (
    photoId: string,
    deletedBy: WoundCareAuditActor,
    hospitalId?: string
  ) => Promise<void>;
  subscribeByEpisode: (
    episodeKey: string,
    callback: (photos: WoundCarePhoto[]) => void,
    hospitalId?: string
  ) => () => void;
}

export const defaultWoundCarePhotoPort: WoundCarePhotoPort = {
  listByEpisode: (episodeKey, hospitalId) =>
    WoundCarePhotoRepository.listByEpisode(episodeKey, hospitalId),
  listByPatientRut: (patientRut, hospitalId) =>
    WoundCarePhotoRepository.listByPatientRut(patientRut, hospitalId),
  create: (photo, hospitalId) => WoundCarePhotoRepository.create(photo, hospitalId),
  updateDescription: (photoId, description, hospitalId) =>
    WoundCarePhotoRepository.updateDescription(photoId, description, hospitalId),
  softDelete: (photoId, deletedBy, hospitalId) =>
    WoundCarePhotoRepository.softDelete(photoId, deletedBy, hospitalId),
  subscribeByEpisode: (episodeKey, callback, hospitalId) =>
    WoundCarePhotoRepository.subscribeByEpisode(episodeKey, callback, hospitalId),
};

// ============================================================================
// Mobile Upload Session Port
// ============================================================================

export interface WoundCareMobileUploadSessionPort {
  getById: (sessionId: string, hospitalId?: string) => Promise<WoundCareMobileUploadSession | null>;
  create: (
    session: WoundCareMobileUploadSession,
    hospitalId?: string
  ) => Promise<WoundCareMobileUploadSession>;
  revoke: (
    sessionId: string,
    patch: { revokedAt: string; revokedBy: WoundCareAuditActor },
    hospitalId?: string
  ) => Promise<void>;
}

export const defaultWoundCareMobileUploadSessionPort: WoundCareMobileUploadSessionPort = {
  getById: (sessionId, hospitalId) =>
    WoundCareMobileUploadSessionRepository.getById(sessionId, hospitalId),
  create: (session, hospitalId) =>
    WoundCareMobileUploadSessionRepository.create(session, hospitalId),
  revoke: (sessionId, patch, hospitalId) =>
    WoundCareMobileUploadSessionRepository.revoke(sessionId, patch, hospitalId),
};

// ============================================================================
// Storage Port
// ============================================================================

export interface WoundCareStoragePort {
  uploadPhoto: (
    blob: Blob,
    path: string,
    metadata: Record<string, string>
  ) => Promise<BackupStorageMutationResult<string>>;
  uploadConsent: (
    blob: Blob,
    path: string,
    metadata: Record<string, string>
  ) => Promise<BackupStorageMutationResult<string>>;
  uploadThumbnail: (blob: Blob, path: string) => Promise<BackupStorageMutationResult<string>>;
  deleteFile: (storagePath: string) => Promise<BackupStorageMutationResult>;
}

export const defaultWoundCareStoragePort: WoundCareStoragePort = {
  uploadPhoto: (blob, path, metadata) => woundCareStorageService.uploadPhoto(blob, path, metadata),
  uploadConsent: (blob, path, metadata) =>
    woundCareStorageService.uploadConsent(blob, path, metadata),
  uploadThumbnail: (blob, path) => woundCareStorageService.uploadThumbnail(blob, path),
  deleteFile: storagePath => woundCareStorageService.deleteFile(storagePath),
};
