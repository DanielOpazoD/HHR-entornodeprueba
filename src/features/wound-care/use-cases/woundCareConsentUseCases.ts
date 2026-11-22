/**
 * Wound Care Consent Use Cases
 *
 * Upload / retrieve / revoke informed consent for clinical photography.
 * Each use case returns an {@link ApplicationOutcome} with structured issues.
 */

import {
  createApplicationSuccess,
  createApplicationFailed,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  defaultWoundCareConsentPort,
  defaultWoundCareStoragePort,
} from '@/features/wound-care/use-cases/woundCarePort';
import type { WoundCareAuditActor, WoundCareConsent } from '@/types/domain/woundCare';
import {
  buildConsentStoragePath,
  extractFileExtension,
  generateId,
  type EpisodeContext,
  type WoundCareConsentDeps,
} from './woundCareUseCaseHelpers';

interface ConsentUploadInput {
  file: File;
  episodeContext: EpisodeContext;
  actor: WoundCareAuditActor;
  hospitalId: string;
}

/**
 * Upload signed informed consent for clinical photography.
 *
 * Stores the consent document (PDF or image) in Firebase Storage
 * and creates a Firestore record linking it to the hospitalization episode.
 * One consent per episode is expected.
 */
export const executeUploadWoundCareConsent = async (
  input: ConsentUploadInput,
  deps: WoundCareConsentDeps = {}
): Promise<ApplicationOutcome<WoundCareConsent | null>> => {
  const consentPort = deps.consentPort ?? defaultWoundCareConsentPort;
  const storagePort = deps.storagePort ?? defaultWoundCareStoragePort;

  try {
    const consentId = generateId();
    const extension = extractFileExtension(input.file);
    const storagePath = buildConsentStoragePath(
      input.hospitalId,
      input.episodeContext.patientRut,
      input.episodeContext.episodeKey,
      consentId,
      extension
    );

    const uploadResult = await storagePort.uploadConsent(input.file, storagePath, {
      contentType: input.file.type || 'application/pdf',
    });

    if (uploadResult.status !== 'success') {
      return createApplicationFailed(null, [
        { kind: 'unknown', message: 'Error al subir el consentimiento informado.' },
      ]);
    }

    const now = new Date().toISOString();
    const consent: WoundCareConsent = {
      id: consentId,
      patientRut: input.episodeContext.patientRut,
      patientName: input.episodeContext.patientName,
      episodeKey: input.episodeContext.episodeKey,
      status: 'signed',
      consentFileStoragePath: storagePath,
      consentFileDownloadUrl: uploadResult.data as string,
      consentFileMimeType: input.file.type || 'application/pdf',
      consentFileSize: input.file.size,
      signedAt: now,
      uploadedAt: now,
      uploadedBy: input.actor,
    };

    const saved = await consentPort.create(consent, input.hospitalId);
    return createApplicationSuccess(saved);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message:
          error instanceof Error ? error.message : 'Error inesperado al subir el consentimiento.',
      },
    ]);
  }
};

/**
 * Retrieve the current consent record for a hospitalization episode.
 *
 * Prefers a signed consent over revoked if both exist.
 */
export const executeGetWoundCareConsent = async (
  episodeKey: string,
  hospitalId?: string,
  deps: Pick<WoundCareConsentDeps, 'consentPort'> = {}
): Promise<ApplicationOutcome<WoundCareConsent | null>> => {
  const consentPort = deps.consentPort ?? defaultWoundCareConsentPort;

  try {
    const consent = await consentPort.getAnyByEpisode(episodeKey, hospitalId);
    return createApplicationSuccess(consent);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'Error al obtener el consentimiento.',
      },
    ]);
  }
};

/**
 * Revoke a previously signed informed consent.
 *
 * Sets status to `'revoked'` and records an audit trail with actor,
 * timestamp and free-text reason. Existing photos are not deleted.
 */
export const executeRevokeWoundCareConsent = async (
  consentId: string,
  reason: string,
  actor: WoundCareAuditActor,
  hospitalId?: string,
  deps: Pick<WoundCareConsentDeps, 'consentPort'> = {}
): Promise<ApplicationOutcome<null>> => {
  const consentPort = deps.consentPort ?? defaultWoundCareConsentPort;

  try {
    await consentPort.revoke(
      consentId,
      {
        revokedAt: new Date().toISOString(),
        revokedBy: actor,
        revocationReason: reason,
      },
      hospitalId
    );
    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'Error al revocar el consentimiento.',
      },
    ]);
  }
};
