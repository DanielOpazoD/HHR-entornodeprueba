/**
 * UI Settings Context
 * Manages visual preferences across the application.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { UISettings, loadUISettings, saveUISettings, DEFAULT_UI_SETTINGS } from '../services/storage/uiSettingsService';

interface UISettingsContextType {
    settings: UISettings;
    updateSetting: (key: keyof UISettings, value: boolean) => void;
    resetSettings: () => void;
}

const UISettingsContext = createContext<UISettingsContextType | undefined>(undefined);

export const UISettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<UISettings>(loadUISettings);

    // Apply settings to document root for CSS access
    useEffect(() => {
        const root = document.documentElement;
        if (settings.glassmorphism) {
            root.classList.add('aesthetic-glass');
        } else {
            root.classList.remove('aesthetic-glass');
        }

        if (settings.animations) {
            root.classList.add('aesthetic-animations');
        } else {
            root.classList.remove('aesthetic-animations');
        }

        if (settings.modernTypography) {
            root.classList.add('aesthetic-typography');
        } else {
            root.classList.remove('aesthetic-typography');
        }

        saveUISettings(settings);
    }, [settings]);

    const updateSetting = (key: keyof UISettings, value: boolean) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const resetSettings = () => {
        setSettings(DEFAULT_UI_SETTINGS);
    };

    return (
        <UISettingsContext.Provider value={{ settings, updateSetting, resetSettings }}>
            {children}
        </UISettingsContext.Provider>
    );
};

export const useUISettings = () => {
    const context = useContext(UISettingsContext);
    if (!context) {
        throw new Error('useUISettings must be used within a UISettingsProvider');
    }
    return context;
};
