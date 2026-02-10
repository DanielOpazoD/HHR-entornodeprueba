import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useIdle } from 'react-use';
import { db } from '@/services/infrastructure/db';

interface SecurityConfig {
    pin: string | null;
    lockOnStartup: boolean;
    inactivityTimeoutMinutes: number; // 0 means disabled
}

interface SecurityContextType {
    isLocked: boolean;
    config: SecurityConfig;
    setPin: (pin: string) => void;
    setLockOnStartup: (enabled: boolean) => void;
    setInactivityTimeout: (minutes: number) => void;
    unlock: (pin: string) => boolean;
    lock: () => void;
    hasPin: boolean;
}

const STORAGE_KEY = 'hhr_security_config';

const DEFAULT_CONFIG: SecurityConfig = {
    pin: null,
    lockOnStartup: false,
    inactivityTimeoutMinutes: 0,
};

const SecurityContext = createContext<SecurityContextType | undefined>(undefined);

export const SecurityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Load config from localStorage (Initial state for speed)
    const [config, setConfig] = useState<SecurityConfig>(() => {
        if (typeof window === 'undefined') return DEFAULT_CONFIG;
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
    });

    // Determine initial lock state
    const [isLocked, setIsLocked] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        const saved = localStorage.getItem(STORAGE_KEY);
        const parsedConfig = saved ? JSON.parse(saved) : DEFAULT_CONFIG;
        return !!parsedConfig.pin && parsedConfig.lockOnStartup;
    });

    // Sync with Firestore on Mount
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const remoteConfig = await db.getDoc<SecurityConfig>('config', 'security');
                if (remoteConfig) {
                    // Update local state and storage if remote exists
                    setConfig(prev => {
                        const newConfig = { ...prev, ...remoteConfig };
                        // Only update if different to avoid loops? 
                        // Actually setConfig matches state updates so it's fine.
                        return newConfig;
                    });
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteConfig));
                }
            } catch (error) {
                console.error('[SecurityContext] Failed to fetch config from Firestore:', error);
            }
        };

        fetchConfig();
    }, []);

    // Save config updates to BOTH LocalStorage and Firestore
    const updateConfig = async (newConfig: SecurityConfig) => {
        setConfig(newConfig);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
        try {
            await db.setDoc('config', 'security', newConfig, { merge: true });
        } catch (error) {
            console.error('[SecurityContext] Failed to save config to Firestore:', error);
        }
    };

    // Idle Timer
    const isIdle = useIdle((config.inactivityTimeoutMinutes || 999999) * 60 * 1000);

    const setPin = (pin: string) => {
        updateConfig({ ...config, pin });
    };

    const setLockOnStartup = (enabled: boolean) => {
        updateConfig({ ...config, lockOnStartup: enabled });
    };

    const setInactivityTimeout = (minutes: number) => {
        updateConfig({ ...config, inactivityTimeoutMinutes: minutes });
    };

    const unlock = (enteredPin: string): boolean => {
        if (enteredPin === config.pin) {
            setIsLocked(false);
            return true;
        }
        return false;
    };

    const lock = useCallback(() => {
        if (config.pin) {
            setIsLocked(true);
        }
    }, [config.pin]);

    useEffect(() => {
        if (!isLocked && isIdle && config.pin && config.inactivityTimeoutMinutes > 0) {
            lock();
        }
    }, [isIdle, config.inactivityTimeoutMinutes, config.pin, isLocked, lock]);

    return (
        <SecurityContext.Provider value={{
            isLocked,
            config,
            setPin,
            setLockOnStartup,
            setInactivityTimeout,
            unlock,
            lock,
            hasPin: !!config.pin
        }}>
            {children}
        </SecurityContext.Provider>
    );
};

export const useSecurity = () => {
    const context = useContext(SecurityContext);
    if (!context) {
        throw new Error('useSecurity must be used within a SecurityProvider');
    }
    return context;
};
