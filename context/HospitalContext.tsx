import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { HospitalConfigService } from '../services/config/HospitalConfigService';

export interface HospitalConfig {
    id: string;
    name: string;
    shortName: string;
    capacity: number;
    logoUrl?: string;
}

interface HospitalContextType {
    hospital: HospitalConfig;
    setHospitalId: (id: string) => void;
    isLoading: boolean;
}

const DEFAULT_HOSPITAL: HospitalConfig = {
    id: 'hanga_roa',
    name: 'Hospital Hanga Roa',
    shortName: 'HHR',
    capacity: 25, // Fallback default
};

const HospitalContext = createContext<HospitalContextType | undefined>(undefined);

/**
 * Provider to manage the current hospital context.
 * In the future, this could fetch config from Firestore hospitals/{id}
 */
export const HospitalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [hospital, setHospital] = useState<HospitalConfig>(DEFAULT_HOSPITAL);
    const [isLoading, setIsLoading] = useState(false);

    const setHospitalId = (id: string) => {
        // Update both React state and global singleton service
        HospitalConfigService.setHospitalId(id);
        setHospital(prev => ({ ...prev, id }));
    };

    return (
        <HospitalContext.Provider value={{ hospital, setHospitalId, isLoading }}>
            {children}
        </HospitalContext.Provider>
    );
};

export const useHospital = () => {
    const context = useContext(HospitalContext);
    if (context === undefined) {
        throw new Error('useHospital must be used within a HospitalProvider');
    }
    return context;
};
