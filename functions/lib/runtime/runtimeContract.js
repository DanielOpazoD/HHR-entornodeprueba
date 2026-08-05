const BACKEND_RUNTIME_CONTRACT_VERSION = 2;
// Keep v1 clients accepted while Functions v2 is deployed ahead of the web. The schema-v2
// Firestore fence, activated only after both deployments, prevents those clients from replaying
// clinical writes. Raising this floor to v2 is a later operational hardening step.
const MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION = 1;
const SUPPORTED_SCHEMA_VERSION = 1;
const LEGACY_SCHEMA_FLOOR_VERSION = 0;

module.exports = {
  BACKEND_RUNTIME_CONTRACT_VERSION,
  MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION,
  SUPPORTED_SCHEMA_VERSION,
  LEGACY_SCHEMA_FLOOR_VERSION,
};
