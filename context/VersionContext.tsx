import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CURRENT_SCHEMA_VERSION } from '../constants/version';

interface VersionContextType {
    isOutdated: boolean;
    appVersion: number;
    remoteVersion: number | null;
    checkVersion: (remoteVersion: number) => void;
    forceUpdate: () => void;
}

const VersionContext = createContext<VersionContextType | undefined>(undefined);

export const VersionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isOutdated, setIsOutdated] = useState(false);
    const [remoteVersion, setRemoteVersion] = useState<number | null>(null);

    const checkVersion = useCallback((remoteVersionValue: number) => {
        if (remoteVersionValue > CURRENT_SCHEMA_VERSION) {
            console.error(`[Versioning] App version mismatch detected. Local: ${CURRENT_SCHEMA_VERSION}, Remote: ${remoteVersionValue}`);
            setIsOutdated(true);
            setRemoteVersion(remoteVersionValue);
        }
    }, []);

    const forceUpdate = useCallback(() => {
        window.location.reload();
    }, []);

    return (
        <VersionContext.Provider value={{
            isOutdated,
            appVersion: CURRENT_SCHEMA_VERSION,
            remoteVersion,
            checkVersion,
            forceUpdate
        }}>
            {children}
        </VersionContext.Provider>
    );
};

export const useVersion = () => {
    const context = useContext(VersionContext);
    if (!context) {
        throw new Error('useVersion must be used within a VersionProvider');
    }
    return context;
};
