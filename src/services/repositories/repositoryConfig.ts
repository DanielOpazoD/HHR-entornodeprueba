/**
 * Repository Configuration
 * Shared configuration state for repositories (Firestore toggle, demo mode).
 * Extracted to avoid circular dependencies between repository modules.
 */

// ============================================================================
// State
// ============================================================================

let firestoreEnabled = true;
let demoModeActive = false;

// ============================================================================
// API
// ============================================================================

/**
 * Enable or disable Firestore synchronization.
 * When disabled, only local IndexedDB storage is used.
 */
export const setFirestoreEnabled = (enabled: boolean): void => {
    firestoreEnabled = enabled;
};

/**
 * Check if Firestore synchronization is enabled.
 */
export const isFirestoreEnabled = (): boolean => firestoreEnabled;

/**
 * Enable or disable demo mode.
 * Demo mode isolates data storage for demonstration purposes.
 */
export const setDemoModeActive = (active: boolean): void => {
    demoModeActive = active;
};

/**
 * Check if demo mode is active.
 */
export const isDemoModeActive = (): boolean => demoModeActive;
