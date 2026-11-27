/**
 * CONTRATO ÚNICO de autoridad clínica de episodios del registro diario.
 *
 * Fuente única compilada desde `src/services/repositories/dailyRecordClinicalAuthorityCore.ts`
 * mediante `scripts/build-shared-functions-contracts.mjs` en
 * `generated/sharedDailyRecordContracts.cjs`.
 */
'use strict';

/**
 * @typedef {{
 *   collectClinicalEpisodeCoverage: (record: any) => {
 *     activePatients: number,
 *     canonicalEpisodeIds: number,
 *     fallbackEpisodeKeys: number,
 *     degenerateFallbackEpisodeKeys: number,
 *   },
 *   evaluateDailyRecordClinicalAuthority: (record: any) => {
 *     status: string,
 *     violations: Array<{
 *       type: string,
 *       path: string,
 *       bedId?: string,
 *       episodeKey: string,
 *       message: string,
 *     }>,
 *   },
 * }} ClinicalAuthorityPolicyBundle
 */

const { collectClinicalEpisodeCoverage, evaluateDailyRecordClinicalAuthority } =
  /** @type {ClinicalAuthorityPolicyBundle} */ (
    require('./generated/sharedDailyRecordContracts.cjs')
  );

module.exports = {
  collectClinicalEpisodeCoverage,
  evaluateDailyRecordClinicalAuthority,
};
