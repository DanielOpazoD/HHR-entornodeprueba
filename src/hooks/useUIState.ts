/**
 * UI State Hook Aliases
 * Provides stricter types for UI state consumption.
 */
import { UseAppStateReturn } from './useAppState';

export type UseUIStateReturn = UseAppStateReturn;
export { useAppState as useUIState } from './useAppState';
