/**
 * AppProviders
 * Centralized context providers for the application.
 * Reduces nesting complexity in App.tsx.
 */

import React, { ReactNode } from 'react';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { StaffProvider } from '@/context/StaffContext';
import { TableConfigProvider } from '@/context/TableConfigContext';
import { UISettingsProvider } from '@/context/UISettingsContext';
import { SecurityProvider } from '@/context/SecurityContext';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';

interface AppProvidersProps {
  children: ReactNode;
  dailyRecordHook: DailyRecordContextType;
}

/**
 * Wraps children with all necessary context providers.
 * Order matters for provider nesting.
 *
 * @example
 * ```tsx
 * <AppProviders dailyRecordHook={dailyRecordHook}>
 *   <AppContent />
 * </AppProviders>
 * ```
 */
export const AppProviders: React.FC<AppProvidersProps> = ({ children, dailyRecordHook }) => {
  return (
    <DailyRecordProvider value={dailyRecordHook}>
      <StaffProvider>
        <UISettingsProvider>
          <SecurityProvider>
            <TableConfigProvider>{children}</TableConfigProvider>
          </SecurityProvider>
        </UISettingsProvider>
      </StaffProvider>
    </DailyRecordProvider>
  );
};
