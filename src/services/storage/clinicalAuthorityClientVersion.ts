import { CLIENT_RUNTIME_CONTRACT_VERSION } from '@/constants/runtimeContracts';
import { CLIENT_RUNTIME_CONTRACT_VERSION_FIELD } from '@/services/storage/clinicalDerivedConstants';

/**
 * Payload of a clinical authority callable (full save, guarded patch and the Rayen batch) with the
 * client runtime contract version as its own top-level field: on split days the server accepts
 * moved-field writes only from contract v3 or later (D7 of
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md). It stays outside `syncContract`, digests
 * and receipts, so an idempotent retry still matches; the caller's payload is not mutated.
 */
export const withClientRuntimeContractVersion = <T extends object>(
  payload: T
): T & Record<typeof CLIENT_RUNTIME_CONTRACT_VERSION_FIELD, number> => ({
  ...payload,
  [CLIENT_RUNTIME_CONTRACT_VERSION_FIELD]: CLIENT_RUNTIME_CONTRACT_VERSION,
});
