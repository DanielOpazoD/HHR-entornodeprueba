/**
 * CONTRATO ÚNICO de autoridad clínico/estructural del registro diario.
 *
 * Fuente única compilada desde `src/services/storage/dailyRecordAuthorityContract.ts` mediante
 * `scripts/build-shared-functions-contracts.mjs` en `generated/sharedDailyRecordContracts.cjs`.
 */
'use strict';

/**
 * @typedef {{
 *   CLINICAL_AUTHORITY_BED_FIELDS: readonly string[],
 *   SERVER_ONLY_CLINICAL_PATCH_FIELDS: readonly string[],
 *   RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS: readonly string[],
 *   RAYEN_BATCH_ONLY_CLINICAL_FIELDS: readonly string[],
 *   RAYEN_CLINICAL_FIELDS: readonly string[],
 *   isClinicalAuthorityBedScalarPath: (path: string) => boolean,
 *   isBedTypeOverridePath: (path: string) => boolean,
 *   isClinicalAuthorityCallablePatchPath: (path: string) => boolean,
 *   splitPatchPath: (path: string) => string[],
 * }} AuthorityContractBundle
 */

const {
  CLINICAL_AUTHORITY_BED_FIELDS,
  SERVER_ONLY_CLINICAL_PATCH_FIELDS,
  RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  RAYEN_CLINICAL_FIELDS,
  isClinicalAuthorityBedScalarPath,
  isBedTypeOverridePath,
  isClinicalAuthorityCallablePatchPath,
  splitPatchPath,
} = /** @type {AuthorityContractBundle} */ (require('./generated/sharedDailyRecordContracts.cjs'));

module.exports = {
  CLINICAL_AUTHORITY_BED_FIELDS,
  SERVER_ONLY_CLINICAL_PATCH_FIELDS,
  RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  RAYEN_CLINICAL_FIELDS,
  isClinicalAuthorityBedScalarPath,
  isBedTypeOverridePath,
  isClinicalAuthorityCallablePatchPath,
  splitPatchPath,
};
