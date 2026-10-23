/**
 * Constants of the clinicalDerived contract (phase 1a). They live apart from the overlay so eager
 * modules (size telemetry, the episode-doc schema) can use them without pulling the overlay into
 * the static bundle; `clinicalDerivedContract.ts` re-exports them as part of the client twin.
 */

export const CLINICAL_DERIVED_COLLECTION = 'clinicalDerived';

/** Per-episode fields that leave the day on a marked day, in a stable order. */
export const CLINICAL_DERIVED_MOVED_FIELDS = [
  'clinicalSyncCheckpoint',
  'vitalSignsHistory',
] as const;

export const CLINICAL_DERIVED_TARGETS = ['bed', 'clinicalCrib'] as const;

/** Root field of the day marker `{ version, generation }`; only the server sets it. */
export const CLINICAL_DERIVED_LAYOUT_FIELD = 'clinicalDerivedLayout';
export const CLINICAL_DERIVED_LAYOUT_VERSION = 1;
export const CLINICAL_DERIVED_DOC_SCHEMA_VERSION = 1;

/**
 * Callables accept moved-field writes on marked (or marking) days only when the payload carries
 * this top-level field at or above the minimum. It stays outside digests and receipts.
 */
export const CLIENT_RUNTIME_CONTRACT_VERSION_FIELD = 'clientRuntimeContractVersion';
export const CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION = 3;
