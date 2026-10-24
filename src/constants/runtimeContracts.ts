// The clinical authority callables send this as `clientRuntimeContractVersion`. On split days the
// server trusts v3 to build moved fields from the combined view (D7 and D10 of
// docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md); the Rayen fill reads that view since P4b
// (clinicalAuthorityClientVersion.test.ts holds both together). The minimum client floor stays at 1
// until the activation (P6).
export const CLIENT_RUNTIME_CONTRACT_VERSION = 3;
// Backend v3 splits the moved clinical fields per episode behind its switch (phase 1a); it fences
// older clients per request, so the client floor below does not move with it.
export const BACKEND_RUNTIME_CONTRACT_VERSION = 3;
// The web requires backend v2. The backend temporarily accepts client v1 so Functions can deploy
// first; policy schema v2 is migrated only after the v2 web is available and then becomes the
// irreversible Firestore write fence for stale clients.
export const MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION = 2;
export const MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION = 1;
