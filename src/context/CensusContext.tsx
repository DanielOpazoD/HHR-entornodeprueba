import React, { createContext, useContext, ReactNode } from 'react';
import { DailyRecordContextType } from '@/hooks/useDailyRecordTypes';
import { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { UseCensusEmailReturn } from '@/hooks/useCensusEmail';
import { UseFileOperationsReturn } from '@/hooks/useFileOperations';

import { SharedCensusModeResult } from '@/hooks/useSharedCensusMode';

// 1. Define the Context State Interface
export interface CensusContextType {
    // Core Domain Data
    dailyRecord: DailyRecordContextType;

    // Time & Navigation
    dateNav: UseDateNavigationReturn & {
        isSignatureMode: boolean;
        currentDateString: string;
        existingDaysInMonth: number[]; // From useExistingDays
    };

    // Domain Services
    fileOps: UseFileOperationsReturn;
    censusEmail: UseCensusEmailReturn;
    nurseSignature: string; // The Result string

    // Shared Mode State
    sharedCensus: SharedCensusModeResult;
}

// 2. Create Context
const CensusContext = createContext<CensusContextType | undefined>(undefined);

// 3. Create Provider Component
interface CensusProviderProps {
    value: CensusContextType;
    children: ReactNode;
}

export const CensusProvider: React.FC<CensusProviderProps> = ({ value, children }) => {
    return (
        <CensusContext.Provider value={value}>
            {children}
        </CensusContext.Provider>
    );
};

// 4. Custom Hook for Consumption
export const useCensusContext = () => {
    const context = useContext(CensusContext);
    if (!context) {
        throw new Error('useCensusContext must be used within a CensusProvider');
    }
    return context;
};
