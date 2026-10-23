// v3: clinical authority callables carry `clientRuntimeContractVersion` and direct writes keep the
// stored split-day state (docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md, D7 and D9). The
// minimum client floor stays at 1 until the activation (P6).
export const CLIENT_RUNTIME_CONTRACT_VERSION = 3;
export const BACKEND_RUNTIME_CONTRACT_VERSION = 2;
// The web requires backend v2. The backend temporarily accepts client v1 so Functions can deploy
// first; policy schema v2 is migrated only after the v2 web is available and then becomes the
// irreversible Firestore write fence for stale clients.
export const MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION = 2;
export const MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION = 1;
