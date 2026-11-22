/**
 * Wound Care Use Cases — public surface
 *
 * Barrel re-exporting the consent and photo use case modules so external
 * callers (hooks, controllers, components, tests) have one stable import
 * path regardless of how the implementation is split internally.
 */

export type { EpisodeContext } from './woundCareUseCaseHelpers';

export {
  executeUploadWoundCareConsent,
  executeGetWoundCareConsent,
  executeRevokeWoundCareConsent,
} from './woundCareConsentUseCases';

export {
  executeUploadWoundCarePhoto,
  executeListWoundCarePhotos,
  executeUpdatePhotoDescription,
  executeDeleteWoundCarePhoto,
} from './woundCarePhotoUseCases';

export {
  executeCreateWoundCareMobileUploadSession,
  executeRevokeWoundCareMobileUploadSession,
  executeValidateWoundCareMobileUploadSession,
} from './woundCareMobileUploadSessionUseCases';
