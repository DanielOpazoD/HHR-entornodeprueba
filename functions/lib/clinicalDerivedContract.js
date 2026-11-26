/**
 * Shared contract for the per-episode clinical data moved out of the daily record (phase 1a,
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md).
 *
 * Single source compiled from `src/services/storage/clinicalDerivedContract.ts` by
 * `scripts/build-shared-functions-contracts.mjs` into `generated/sharedDailyRecordContracts.cjs`.
 */
'use strict';

/**
 * @typedef {{ status: 'unmarked' } | { status: 'unsupported' } | { status: 'marked', layout: { version: number, generation: string } }} ClinicalDerivedLayoutState
 * @typedef {{
 *   CLINICAL_DERIVED_COLLECTION: string,
 *   CLINICAL_DERIVED_MOVED_FIELDS: readonly string[],
 *   CLINICAL_DERIVED_TARGETS: readonly ('bed' | 'clinicalCrib')[],
 *   CLINICAL_DERIVED_LAYOUT_FIELD: string,
 *   CLINICAL_DERIVED_LAYOUT_VERSION: number,
 *   CLINICAL_DERIVED_DOC_SCHEMA_VERSION: number,
 *   CLIENT_RUNTIME_CONTRACT_VERSION_FIELD: string,
 *   CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION: number,
 *   isClinicalDerivedDocId: (value: unknown) => value is string,
 *   buildClinicalDerivedLayout: (generation: string) => { version: number, generation: string },
 *   readClinicalDerivedLayout: (record: unknown) => ClinicalDerivedLayoutState,
 *   meetsClinicalDerivedClientVersion: (value: unknown) => boolean,
 *   collectClinicalDerivedEpisodes: (record: unknown) => { episodes: any[], duplicateEpisodeIds: string[] },
 *   overlayClinicalDerived: (record: Record<string, unknown>, docs: Record<string, unknown>[]) => { record: Record<string, unknown>, matchedEpisodeIds: string[], skippedDuplicateEpisodeIds: string[] },
 *   findStaleClinicalDerivedEpisodeIds: (record: Record<string, unknown>, docs: Record<string, unknown>[]) => string[],
 * }} ClinicalDerivedContractBundle
 */

const {
  CLINICAL_DERIVED_COLLECTION,
  CLINICAL_DERIVED_MOVED_FIELDS,
  CLINICAL_DERIVED_TARGETS,
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_LAYOUT_VERSION,
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLIENT_RUNTIME_CONTRACT_VERSION_FIELD,
  CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION,
  isClinicalDerivedDocId,
  buildClinicalDerivedLayout,
  readClinicalDerivedLayout,
  meetsClinicalDerivedClientVersion,
  collectClinicalDerivedEpisodes,
  overlayClinicalDerived,
  findStaleClinicalDerivedEpisodeIds,
} = /** @type {ClinicalDerivedContractBundle} */ (
  require('./generated/sharedDailyRecordContracts.cjs')
);

module.exports = {
  CLINICAL_DERIVED_COLLECTION,
  CLINICAL_DERIVED_MOVED_FIELDS,
  CLINICAL_DERIVED_TARGETS,
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_LAYOUT_VERSION,
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLIENT_RUNTIME_CONTRACT_VERSION_FIELD,
  CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION,
  isClinicalDerivedDocId,
  buildClinicalDerivedLayout,
  readClinicalDerivedLayout,
  meetsClinicalDerivedClientVersion,
  collectClinicalDerivedEpisodes,
  overlayClinicalDerived,
  findStaleClinicalDerivedEpisodeIds,
};
