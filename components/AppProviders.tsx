/**
 * AppProviders
 * Centralized context providers for the application.
 * Reduces nesting complexity in App.tsx.
 */

import React, { ReactNode } from 'react';
import { DailyRecordProvider, StaffProvider } from '@/context';
import { TableConfigProvider } from '@/context/TableConfigContext';
import { UISettingsProvider } from '@/context/UISettingsContext';
import { DailyRecordContextType } from '@/hooks/useDailyRecordTypes';

interface AppProvidersProps {
    children: ReactNode;
    dailyRecordHook: DailyRecordContextType;
    _userId: string;
}

/**
 * Wraps children with all necessary context providers.
 * Order matters for provider nesting.
 * 
 * @example
 * ```tsx
 * <AppProviders dailyRecordHook={dailyRecordHook} userId={userId}>
 *   <AppContent />
 * </AppProviders>
 * ```
 */
export const AppProviders: React.FC<AppProvidersProps> = ({ children, dailyRecordHook, _userId }) => {
    return (
        <DailyRecordProvider value={dailyRecordHook}>
            <StaffProvider>
                <UISettingsProvider>
                    <TableConfigProvider>
                        {children}
                    </TableConfigProvider>
                </UISettingsProvider>
            </StaffProvider>
        </DailyRecordProvider>
    );
};
