/**
 * useAppState Hook
 *
 * Centralizes all UI state management for the main App component.
 * Reduces complexity in App.tsx by extracting navigation, modal, and view state.
 *
 * @example
 * ```tsx
 * const appState = useAppState();
 * <Navbar currentModule={appState.currentModule} setModule={appState.setCurrentModule} />
 * ```
 */

import { useEffect, useState } from 'react';
import { useModal, UseModalReturn } from './useModal';
import type { ModuleType } from '@/constants/navigationConfig';
import {
  resolveInitialModuleFromLocation,
  shouldShowPrintButtonForModule,
  syncModuleToUrl,
} from '@/hooks/controllers/appStateNavigationController';

const resolveInitialModule = (): ModuleType => {
  if (typeof window === 'undefined') return 'CENSUS';
  return resolveInitialModuleFromLocation({
    pathname: window.location.pathname,
    search: window.location.search,
  });
};

export interface UseAppStateReturn {
  // Module navigation
  currentModule: ModuleType;
  setCurrentModule: (m: ModuleType) => void;

  // View modes
  censusViewMode: 'REGISTER' | 'ANALYTICS';
  setCensusViewMode: (m: 'REGISTER' | 'ANALYTICS') => void;

  // Modal states (using useModal)
  bedManagerModal: UseModalReturn;
  patientSearchModal: UseModalReturn;

  // Feature flags
  isTestAgentRunning: boolean;
  setIsTestAgentRunning: (v: boolean) => void;

  // Shift state (shared between views and global actions)
  selectedShift: 'day' | 'night';
  setSelectedShift: (s: 'day' | 'night') => void;

  // Derived state
  showPrintButton: boolean;

  // Bookmarks bar toggle
  showBookmarksBar: boolean;
  setShowBookmarksBar: (v: boolean) => void;
}

export interface UseAppStateOptions {
  /** Selected by the shared clinical date owner, never inferred from a stale URL. */
  date?: string;
  initialModule?: ModuleType;
  syncUrl?: boolean;
}

/**
 * Hook that manages all UI state for the main application shell
 */
export function useAppState(options: UseAppStateOptions = {}): UseAppStateReturn {
  const { initialModule, syncUrl = true, date } = options;

  // Module navigation
  const [currentModule, setCurrentModule] = useState<ModuleType>(
    () => initialModule ?? resolveInitialModule()
  );

  // View modes
  const [censusViewMode, setCensusViewMode] = useState<'REGISTER' | 'ANALYTICS'>('REGISTER');

  // Modal states using the new useModal hook
  const bedManagerModal = useModal();
  const patientSearchModal = useModal();

  // Feature flags
  const [isTestAgentRunning, setIsTestAgentRunning] = useState(false);

  // Bookmarks bar toggle
  const [showBookmarksBar, setShowBookmarksBar] = useState(false);

  // Shift state
  const [selectedShift, setSelectedShift] = useState<'day' | 'night'>('day');

  // Derived state
  const showPrintButton = shouldShowPrintButtonForModule(currentModule);

  useEffect(() => {
    if (!syncUrl) {
      return;
    }
    syncModuleToUrl({ module: currentModule, date });
  }, [currentModule, syncUrl, date]);

  return {
    // Module navigation
    currentModule,
    setCurrentModule,

    // View modes
    censusViewMode,
    setCensusViewMode,

    // Modals
    bedManagerModal,
    patientSearchModal,

    // Feature flags
    isTestAgentRunning,
    setIsTestAgentRunning,

    // Shift
    selectedShift,
    setSelectedShift,

    // Derived
    showPrintButton,

    // Bookmarks
    showBookmarksBar,
    setShowBookmarksBar,
  };
}

export default useAppState;
