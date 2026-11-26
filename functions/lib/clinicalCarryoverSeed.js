'use strict';

/**
 * Server-side trusted clinical carryover wrapper.
 *
 * The patient-level carryover seed (`seedPatient`) is compiled from the single TypeScript source
 * `src/services/repositories/clinicalCarryoverSeed.ts` by
 * `scripts/build-shared-functions-contracts.mjs` into `generated/sharedDailyRecordContracts.cjs`.
 */

/**
 * @typedef {{
 *   seedClinicalCarryover: (source: unknown, destination: unknown, sourceDate: string, date: string) => unknown,
 * }} ClinicalCarryoverBundle
 */

const { seedClinicalCarryover: seedPatient } = /** @type {ClinicalCarryoverBundle} */ (
  require('./generated/sharedDailyRecordContracts.cjs')
);

const clone = value => JSON.parse(JSON.stringify(value));

/** Called only for today's missing destination inside the authority transaction. Client values
 * are never clinical evidence: the prior snapshot is re-read on every transaction retry. */
const applyTrustedClinicalCarryover = ({ candidate, requested, priorRecord }) => {
  if (!priorRecord) return candidate;
  const priorPatients = Object.values(priorRecord.beds || {});
  const find = (patient, crib) => {
    const matches = priorPatients
      .map(bed => (crib ? bed.clinicalCrib : bed))
      .filter(item => item && item.clinicalEpisodeId === patient?.clinicalEpisodeId);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const seedRequested = (patient, request, crib) => {
    if (request?.clinicalCarryover?.sourceDate !== priorRecord.date) return patient;
    return seedPatient(find(patient, crib), patient, priorRecord.date, candidate.date);
  };
  const next = clone(candidate);
  for (const [bedId, bed] of Object.entries(next.beds || {})) {
    next.beds[bedId] = seedRequested(bed, requested.beds?.[bedId], false);
    if (bed.clinicalCrib)
      next.beds[bedId].clinicalCrib = seedRequested(
        bed.clinicalCrib,
        requested.beds?.[bedId]?.clinicalCrib,
        true
      );
  }
  return next;
};

module.exports = { applyTrustedClinicalCarryover, seedPatient };
