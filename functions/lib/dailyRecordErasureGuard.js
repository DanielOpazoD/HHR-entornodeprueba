'use strict';

/**
 * Server entry for `findPatientErasures`, `movementAccountsForBed`, and
 * `findPersistedEpisodeDowngrades`.
 *
 * Single source compiled from `src/services/repositories/dailyRecordErasureGuard.ts` by
 * `scripts/build-shared-functions-contracts.mjs` into `generated/sharedDailyRecordContracts.cjs`.
 * See `docs/SYNC_CONCURRENCY_MODEL.md`.
 */

/**
 * @typedef {{
 *   findPatientErasures: (remote: Record<string, unknown>, local: Record<string, unknown>) => { bedId: string, remotePatientName: string }[],
 *   movementAccountsForBed: (movements: Record<string, unknown>[], bedId: string, patientName: string) => boolean,
 *   findPersistedEpisodeDowngrades: (remote: Record<string, unknown>, local: Record<string, unknown>) => { bedId: string, remotePatientName: string, remoteEpisodeId: string, localEpisodeId: string }[],
 * }} ErasureGuardBundle
 */

const { findPatientErasures, movementAccountsForBed, findPersistedEpisodeDowngrades } =
  /** @type {ErasureGuardBundle} */ (require('./generated/sharedDailyRecordContracts.cjs'));

module.exports = { findPatientErasures, movementAccountsForBed, findPersistedEpisodeDowngrades };
