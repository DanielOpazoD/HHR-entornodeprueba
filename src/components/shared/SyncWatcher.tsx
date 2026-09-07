/**
 * Sync Watcher
 * Reserved for global synchronization events without an operation owner.
 */

// Connectivity changes may belong to an in-flight write. Without an operation id,
// notifying here could duplicate or contradict the result emitted by that write.
export const SyncWatcher = () => null;
