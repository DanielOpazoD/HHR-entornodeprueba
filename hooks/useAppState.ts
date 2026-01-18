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
 * <SettingsModal isOpen={appState.settingsModal.isOpen} onClose={appState.settingsModal.close} />
 * ```
 */

import { useState, useMemo } from 'react';
import { useModal, UseModalReturn } from './useModal';
import type { ModuleType } from '@/components';

export interface UseAppStateReturn {
    // Module navigation
    currentModule: ModuleType;
    setCurrentModule: (m: ModuleType) => void;

    // View modes
    censusViewMode: 'REGISTER' | 'ANALYTICS';
    setCensusViewMode: (m: 'REGISTER' | 'ANALYTICS') => void;

    // Modal states (using useModal)
    settingsModal: UseModalReturn;
    bedManagerModal: UseModalReturn;
    demoModal: UseModalReturn;

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

/**
 * Hook that manages all UI state for the main application shell
 */
export function useAppState(): UseAppStateReturn {
    // Module navigation
    const [currentModule, setCurrentModule] = useState<ModuleType>('CENSUS');

    // View modes
    const [censusViewMode, setCensusViewMode] = useState<'REGISTER' | 'ANALYTICS'>('REGISTER');

    // Modal states using the new useModal hook
    const settingsModal = useModal();
    const bedManagerModal = useModal();
    const demoModal = useModal();

    // Feature flags
    const [isTestAgentRunning, setIsTestAgentRunning] = useState(false);

    // Bookmarks bar toggle
    const [showBookmarksBar, setShowBookmarksBar] = useState(false);

    // Shift state
    const [selectedShift, setSelectedShift] = useState<'day' | 'night'>('day');

    // Derived state
    const showPrintButton = useMemo(() => {
        return currentModule === 'CUDYR' ||
            currentModule === 'NURSING_HANDOFF' ||
            currentModule === 'MEDICAL_HANDOFF';
    }, [currentModule]);

    return {
        // Module navigation
        currentModule,
        setCurrentModule,

        // View modes
        censusViewMode,
        setCensusViewMode,

        // Modals
        settingsModal,
        bedManagerModal,
        demoModal,

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
        setShowBookmarksBar
    };
}

export default useAppState;
