// v3: the per-episode clinical data split (phase 1a). Clients older than v3 are fenced per
// request by the callables (`clientRuntimeContractVersion`), not by the floor below.
const BACKEND_RUNTIME_CONTRACT_VERSION = 3;
// Raised to v3 with the phase 1a activation (P6). It is advisory: the Netlify runtime-contract
// function serves it so older tabs see the update notice; the per-request fence stays the guard.
const MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION = 3;
const SUPPORTED_SCHEMA_VERSION = 1;
const LEGACY_SCHEMA_FLOOR_VERSION = 0;

module.exports = {
  BACKEND_RUNTIME_CONTRACT_VERSION,
  MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION,
  SUPPORTED_SCHEMA_VERSION,
  LEGACY_SCHEMA_FLOOR_VERSION,
};
