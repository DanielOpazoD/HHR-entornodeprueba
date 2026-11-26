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
  // Experimental Features
  /** Server-controlled episode assignment is opt-in; this only exposes its client intent. */
  SPECIALTY_EPISODE_ASSIGNMENT: false,
  SPECIALTY_RULES_MEMORY: false,
  SPECIALTY_JEV_CONSULTATION: false,
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
  private envOverrides: Partial<Record<FeatureFlag, boolean>> = {};
  private listeners: Map<FeatureFlag, Set<(enabled: boolean) => void>> = new Map();

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
    // Match the backend's episode authority without enabling the optional AI pilot.
    if (
      import.meta.env.MODE !== 'test' &&
      import.meta.env.VITE_HHR_SPECIALTY_EPISODE_ASSIGNMENT === 'enabled'
    ) {
      this.envOverrides.SPECIALTY_EPISODE_ASSIGNMENT = true;
      delete this.overrides.SPECIALTY_EPISODE_ASSIGNMENT;
    }
    // This public build flag is set only for the hhr-pruebas pilot builds.
    // The Jev client independently verifies the Firebase project before consulting.
    if (
      import.meta.env.MODE !== 'test' &&
      import.meta.env.VITE_HHR_SPECIALTY_JEV_PILOT === 'enabled'
    ) {
      this.envOverrides.SPECIALTY_EPISODE_ASSIGNMENT = true;
      this.envOverrides.SPECIALTY_JEV_CONSULTATION = true;
      delete this.overrides.SPECIALTY_EPISODE_ASSIGNMENT;
      delete this.overrides.SPECIALTY_JEV_CONSULTATION;
    }
  }

  private getDefaultValue(flag: FeatureFlag): boolean {
    return this.envOverrides[flag] ?? FEATURE_FLAGS[flag];
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Check if a feature is enabled
   */
  isEnabled(flag: FeatureFlag): boolean {
    return this.overrides[flag] ?? this.getDefaultValue(flag);
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
   * Reset a flag to its default value (preserving environment overrides)
   */
  reset(flag: FeatureFlag): void {
    delete this.overrides[flag];
    this.saveToStorage();
    this.notifyListeners(flag, this.getDefaultValue(flag));
  }

  /**
   * Reset all user overrides back to defaults (preserving environment overrides)
   */
  resetAll(): void {
    this.overrides = {};
    this.saveToStorage();
    Object.keys(FEATURE_FLAGS).forEach(flag => {
      const typedFlag = flag as FeatureFlag;
      this.notifyListeners(typedFlag, this.getDefaultValue(typedFlag));
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

  private notifyListeners(flag: FeatureFlag, enabled: boolean): void {
    this.listeners.get(flag)?.forEach(callback => callback(enabled));
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
