// The clinical authority callables send this as `clientRuntimeContractVersion`. On split days the
// server trusts v3 to build moved fields from the combined view (D7 and D10 of
// docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md); the Rayen fill reads that view since P4b
// (clinicalAuthorityClientVersion.test.ts holds both together).
export const CLIENT_RUNTIME_CONTRACT_VERSION = 3;
// Backend v3 splits the moved clinical fields per episode behind its switch (phase 1a).
export const BACKEND_RUNTIME_CONTRACT_VERSION = 3;
// Both floors are 3 since the phase 1a activation (P6). The client floor is advisory: the web
// served with this build asks older tabs to update, and the callables still fence older clients
// per request. The backend floor keeps a revert to a backend that ignores the split marker from
// passing check:runtime-contracts.
export const MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION = 3;
export const MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION = 3;
