export const CLIENT_RUNTIME_CONTRACT_VERSION = 2;
export const BACKEND_RUNTIME_CONTRACT_VERSION = 2;
// The web requires backend v2. The backend temporarily accepts client v1 so Functions can deploy
// first; policy schema v2 is migrated only after the v2 web is available and then becomes the
// irreversible Firestore write fence for stale clients.
export const MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION = 2;
export const MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION = 1;
