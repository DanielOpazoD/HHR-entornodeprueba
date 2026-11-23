import React, { createContext, useContext, ReactNode } from 'react';
import { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { UseFileOperationsReturn } from '@/hooks/useFileOperations';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';

/** What the census email flow gives the app shell and the layout; built by the census feature. */
export interface UseCensusEmailReturn {
  // Config modal state
  showEmailConfig: boolean;
  setShowEmailConfig: (show: boolean) => void;

  // Recipients
  recipients: string[];
  setRecipients: (recipients: string[]) => void;
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientListId: string;
  setActiveRecipientListId: (listId: string) => void;
  createRecipientList: (name: string) => Promise<void>;
  renameActiveRecipientList: (name: string) => Promise<void>;
  deleteRecipientList: (listId: string) => Promise<void>;
  recipientsSource: 'firebase' | 'local' | 'default';
  isRecipientsSyncing: boolean;
  recipientsSyncError: string | null;

  // Message
  message: string;
  onMessageChange: (value: string) => void;
  onResetMessage: () => void;

  // Send state
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  emailBlockedReason?: string | null;

  // Actions
  resetStatus: () => void;
  sendEmail: () => Promise<void>;

  // Test mode
  testModeEnabled: boolean;
  setTestModeEnabled: (value: boolean) => void;
  testRecipient: string;
  setTestRecipient: (value: string) => void;
  isAdminUser: boolean;
}

// 1. Define the Context State Interface (excludes reactive dailyRecord slices; use DailyRecordContext hooks)
export interface CensusContextType {
  // Time & Navigation
  dateNav: UseDateNavigationReturn & {
    existingDaysInMonth: number[]; // From useExistingDays
    /** Active clinical day (08:00/09:00 shift rollover); reactive across the rollover. */
    clinicalToday: string;
    /** Jump the selection back to the clinical day (used by the banner + date strip). */
    goToClinicalToday: () => void;
  };

  // Domain Services
  fileOps: UseFileOperationsReturn;
  censusEmail: UseCensusEmailReturn;
  nurseSignature: string; // The Result string
}

// 2. Create Context
const CensusContext = createContext<CensusContextType | undefined>(undefined);

// 3. Create Provider Component
interface CensusProviderProps {
  value: CensusContextType;
  children: ReactNode;
}

export const CensusProvider: React.FC<CensusProviderProps> = ({ value, children }) => {
  return <CensusContext.Provider value={value}>{children}</CensusContext.Provider>;
};

// 4. Custom Hook for Consumption
export const useCensusContext = () => {
  const context = useContext(CensusContext);
  if (!context) {
    throw new Error('useCensusContext must be used within a CensusProvider');
  }
  return context;
};
