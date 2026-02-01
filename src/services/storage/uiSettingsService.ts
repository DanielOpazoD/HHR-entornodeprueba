/**
 * UI Settings Service
 * Handles persistence of visual preferences in localStorage.
 */

import { safeJsonParse } from '@/utils/jsonUtils';

export interface UISettings {
    glassmorphism: boolean;
    animations: boolean;
    hoverEffects: boolean;
    modernTypography: boolean;
}

const STORAGE_KEY = 'hhr_ui_settings';

export const DEFAULT_UI_SETTINGS: UISettings = {
    glassmorphism: false,
    animations: true,
    hoverEffects: true,
    modernTypography: true
};

/**
 * Load UI settings from localStorage
 */
export const loadUISettings = (): UISettings => {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_UI_SETTINGS;
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return { ...DEFAULT_UI_SETTINGS, ...safeJsonParse<UISettings>(saved, DEFAULT_UI_SETTINGS) };
        }
    } catch (error) {
        console.error('Error loading UI settings:', error);
    }
    return DEFAULT_UI_SETTINGS;
};

/**
 * Save UI settings to localStorage
 */
export const saveUISettings = (settings: UISettings): void => {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        console.error('Error saving UI settings:', error);
    }
};
