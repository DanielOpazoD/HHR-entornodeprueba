/**
 * Demo Mode Context
 * Manages the demo/test mode state across the application.
 * When active, data is stored separately from production data.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { setDemoModeActive as setRepositoryDemoMode } from '../services/repositories/DailyRecordRepository';
import { saveSetting, getSetting } from '../services/storage/indexedDBService';

// ============================================================================
// Types
// ============================================================================

export type DemoPeriod = 'day' | 'week' | 'month';

export interface DemoModeState {
    isActive: boolean;
    period: DemoPeriod;
    startDate: string;
    isGenerating: boolean;
}

export interface DemoModeContextType extends DemoModeState {
    activateDemo: (period: DemoPeriod, startDate: string) => void;
    deactivateDemo: () => void;
    setGenerating: (isGenerating: boolean) => void;
}

// ============================================================================
// Context & Provider
// ============================================================================

const DemoModeContext = createContext<DemoModeContextType | null>(null);

const DEMO_MODE_STORAGE_KEY = 'hhr_demo_mode_state';


export const DemoModeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [state, setState] = useState<DemoModeState>({
        isActive: false,
        period: 'day',
        startDate: new Date().toISOString().split('T')[0],
        isGenerating: false
    });

    // 1. Initial Load from IndexedDB
    useEffect(() => {
        const init = async () => {
            try {
                // Try IndexedDB first
                let stored = await getSetting<Partial<DemoModeState> | null>(DEMO_MODE_STORAGE_KEY, null);

                // Fallback to localStorage for migration
                if (!stored && typeof window !== 'undefined' && window.localStorage) {
                    const legacy = window.localStorage.getItem(DEMO_MODE_STORAGE_KEY);
                    if (legacy) {
                        stored = JSON.parse(legacy);
                        if (stored) await saveSetting(DEMO_MODE_STORAGE_KEY, stored);
                    }
                }

                if (stored) {
                    setState(prev => ({
                        ...prev,
                        isActive: stored?.isActive || false,
                        period: stored?.period || 'day',
                        startDate: stored?.startDate || new Date().toISOString().split('T')[0]
                    }));
                }
            } catch (e) {
                console.error('Failed to load demo mode state:', e);
            }
        };
        init();
    }, []);

    // Sync demo mode state with Repository on mount and changes
    useEffect(() => {
        setRepositoryDemoMode(state.isActive);
    }, [state.isActive]);

    const persistState = useCallback(async (newState: DemoModeState) => {
        try {
            const data = {
                isActive: newState.isActive,
                period: newState.period,
                startDate: newState.startDate
            };
            await saveSetting(DEMO_MODE_STORAGE_KEY, data);
            // Cleanup legacy
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
            }
        } catch (e) {
            console.error('Failed to persist demo mode state:', e);
        }
    }, []);

    const activateDemo = useCallback((period: DemoPeriod, startDate: string) => {
        const newState: DemoModeState = {
            isActive: true,
            period,
            startDate,
            isGenerating: false
        };
        setState(newState);
        persistState(newState);
    }, [persistState]);

    const deactivateDemo = useCallback(() => {
        const newState: DemoModeState = {
            isActive: false,
            period: 'day',
            startDate: state.startDate,
            isGenerating: false
        };
        setState(newState);
        persistState(newState);
    }, [state.startDate, persistState]);

    const setGenerating = useCallback((isGenerating: boolean) => {
        setState(prev => ({ ...prev, isGenerating }));
    }, []);

    const contextValue: DemoModeContextType = {
        ...state,
        activateDemo,
        deactivateDemo,
        setGenerating
    };

    return (
        <DemoModeContext.Provider value={contextValue}>
            {children}
        </DemoModeContext.Provider>
    );
};

// ============================================================================
// Hook
// ============================================================================

export const useDemoMode = (): DemoModeContextType => {
    const context = useContext(DemoModeContext);
    if (!context) {
        throw new Error('useDemoMode must be used within a DemoModeProvider');
    }
    return context;
};
