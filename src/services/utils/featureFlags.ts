/**
 * Feature Flags Service
 * Enables controlled rollout and toggling of features.
 *
 * Features:
 * - Environment-based defaults
 * - Runtime toggling
 * - Persistent storage of user preferences
 * - Type-safe flag definitions
 */

// ============================================================================
// Feature Flag Definitions
// ============================================================================

/**
 * All available feature flags.
 * Add new flags here with their default state.
 */
export const FEATURE_FLAGS = {
  // UI Features
  SHOW_DEBUG_PANEL: false,
  ENABLE_ANALYTICS_VIEW: true,
  SHOW_CUDYR_PRINT: true,

  // Experimental Features
  ENABLE_OPTIMISTIC_UPDATES: true,
  ENABLE_OFFLINE_MODE: false,
  // Routes empty-bed admission saves through the canonical
  // useAdmitPatient command (validated → audited → typed outcome) when
  // the input qualifies as a "pure admission" (only patientName + rut +
  // admissionDate, optional pathology). Mixed edits stay on the legacy
  // updatePatientMultiple dispatch via `resolveEmptyBedSaveAction`.
  // ON by default since the routing controller is exhaustively unit
  // tested and the integration test exercises the full hook → port →
  // repository chain. The flag remains user-toggleable for emergency
  // rollback. See TECHNICAL_DEBT_REGISTER `command-layer-adoption`.
  USE_ADMIT_PATIENT_COMMAND: true,

  // Routes the existing discharge modal (`useCensusDischargeCommand` →
  // `usePatientDischarges.addDischarge`) through a thin canonical
  // facade that adds anonymous-actor rejection, typed outcome, and
  // dispatches the PATIENT_DISCHARGED audit through the canonical
  // command pipeline. OFF by default — see TECHNICAL_DEBT_REGISTER
  // `command-layer-discharge` for the rollout plan.
  USE_DISCHARGE_PATIENT_COMMAND: false,

  // Same facade for the transfer modal flow. OFF by default — see
  // TECHNICAL_DEBT_REGISTER `command-layer-transfer`.
  USE_TRANSFER_PATIENT_COMMAND: false,

  // Integration Features
  ENABLE_WHATSAPP_INTEGRATION: true,
  ENABLE_EMAIL_NOTIFICATIONS: true,

  // Developer Features
  VERBOSE_LOGGING: false,
  SHOW_PERFORMANCE_METRICS: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

// ============================================================================
// Feature Flags Service
// ============================================================================

const STORAGE_KEY = 'hhr_feature_flags';

const hasWindowLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

// Feature flags are read during early bootstrap paths. Keeping them in
// localStorage avoids waking IndexedDB/Dexie before auth decides whether the
// app should land in login or continue into the authenticated shell.
const loadFeatureFlagOverrides = (): Partial<Record<FeatureFlag, boolean>> => {
  if (!hasWindowLocalStorage()) {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === 'object'
      ? (parsedValue as Partial<Record<FeatureFlag, boolean>>)
      : {};
  } catch {
    return {};
  }
};

const persistFeatureFlagOverrides = (overrides: Partial<Record<FeatureFlag, boolean>>): void => {
  if (!hasWindowLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore storage errors
  }
};

class FeatureFlagsService {
  private static instance: FeatureFlagsService;
  private overrides: Partial<Record<FeatureFlag, boolean>> = {};
  private listeners: Map<FeatureFlag, Set<(enabled: boolean) => void>> = new Map();
  private allListeners: Set<() => void> = new Set();

  private constructor() {
    this.loadFromStorage();
    this.applyEnvironmentOverrides();
  }

  static getInstance(): FeatureFlagsService {
    if (!FeatureFlagsService.instance) {
      FeatureFlagsService.instance = new FeatureFlagsService();
    }
    return FeatureFlagsService.instance;
  }

  // ========================================================================
  // Initialization
  // ========================================================================

  private loadFromStorage(): void {
    this.overrides = {
      ...this.overrides,
      ...loadFeatureFlagOverrides(),
    };
  }

  private saveToStorage(): void {
    persistFeatureFlagOverrides(this.overrides);
  }

  private applyEnvironmentOverrides(): void {
    // Enable debug features in development
    const isDev =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (isDev) {
      // Only set if not already overridden by user
      if (this.overrides.SHOW_DEBUG_PANEL === undefined) {
        this.overrides.SHOW_DEBUG_PANEL = true;
      }
      if (this.overrides.VERBOSE_LOGGING === undefined) {
        this.overrides.VERBOSE_LOGGING = true;
      }
    }
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Check if a feature is enabled
   */
  isEnabled(flag: FeatureFlag): boolean {
    return this.overrides[flag] ?? FEATURE_FLAGS[flag];
  }

  /**
   * Enable a feature flag
   */
  enable(flag: FeatureFlag): void {
    this.overrides[flag] = true;
    this.saveToStorage();
    this.notifyListeners(flag, true);
  }

  /**
   * Disable a feature flag
   */
  disable(flag: FeatureFlag): void {
    this.overrides[flag] = false;
    this.saveToStorage();
    this.notifyListeners(flag, false);
  }

  /**
   * Toggle a feature flag
   */
  toggle(flag: FeatureFlag): boolean {
    const newValue = !this.isEnabled(flag);
    this.overrides[flag] = newValue;
    this.saveToStorage();
    this.notifyListeners(flag, newValue);
    return newValue;
  }

  /**
   * Reset a flag to its default value
   */
  reset(flag: FeatureFlag): void {
    delete this.overrides[flag];
    this.saveToStorage();
    this.notifyListeners(flag, FEATURE_FLAGS[flag]);
  }

  /**
   * Reset all flags to defaults
   */
  resetAll(): void {
    this.overrides = {};
    this.saveToStorage();
    Object.keys(FEATURE_FLAGS).forEach(flag => {
      this.notifyListeners(flag as FeatureFlag, FEATURE_FLAGS[flag as FeatureFlag]);
    });
  }

  /**
   * Get all flags with their current values
   */
  getAll(): Record<FeatureFlag, boolean> {
    const result = {} as Record<FeatureFlag, boolean>;
    for (const flag of Object.keys(FEATURE_FLAGS) as FeatureFlag[]) {
      result[flag] = this.isEnabled(flag);
    }
    return result;
  }

  // ========================================================================
  // Subscription
  // ========================================================================

  /**
   * Subscribe to changes on a specific flag
   */
  subscribe(flag: FeatureFlag, callback: (enabled: boolean) => void): () => void {
    if (!this.listeners.has(flag)) {
      this.listeners.set(flag, new Set());
    }
    this.listeners.get(flag)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(flag)?.delete(callback);
    };
  }

  /**
   * Subscribe to any change in any flag
   */
  subscribeAll(callback: () => void): () => void {
    this.allListeners.add(callback);
    return () => {
      this.allListeners.delete(callback);
    };
  }

  private notifyListeners(flag: FeatureFlag, enabled: boolean): void {
    this.listeners.get(flag)?.forEach(callback => callback(enabled));
    this.allListeners.forEach(callback => callback());
  }
}

// ============================================================================
// Exports
// ============================================================================

export const featureFlags = FeatureFlagsService.getInstance();

/**
 * Shorthand for checking if a feature is enabled
 */
export const isFeatureEnabled = (flag: FeatureFlag): boolean => {
  return featureFlags.isEnabled(flag);
};
