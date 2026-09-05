import { useState, useCallback } from 'react';
import { useConfirmDialog } from '@/context/UIContext';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { defaultCensusEmailBrowserRuntime } from '@/hooks/controllers/censusEmailBrowserRuntimeController';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import {
  canManageGlobalCensusEmailRecipients,
  canUseAdminMaintenanceActions,
} from '@/shared/access/operationalAccessPolicy';
import { useCensusEmailDeliveryActions } from '@/hooks/useCensusEmailDeliveryActions';
import { useCensusEmailRecipientLists } from '@/hooks/useCensusEmailRecipientLists';
import { useCensusEmailMessageState } from '@/hooks/useCensusEmailMessageState';
import { useCensusEmailSendState } from '@/hooks/useCensusEmailSendState';
import { resolveUpcEmailBlockReason } from '@/shared/census/upcEvaluationPolicy';

interface UseCensusEmailParams {
  record: DailyRecord | null;
  currentDateString: string;
  nurseSignature: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  user: { uid?: string; email?: string | null; role?: string } | null;
  role: string;
  enabled?: boolean;
}

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

const resolveCensusEmailAccess = (
  role: string,
  user: UseCensusEmailParams['user'],
  showEmailConfig: boolean
) => {
  const isAdminUser = canUseAdminMaintenanceActions(role);
  const canManageGlobalRecipientLists = canManageGlobalCensusEmailRecipients({
    role,
    userId: user?.uid || user?.email || null,
  });

  return {
    isAdminUser,
    canManageGlobalRecipientLists,
    areGlobalRecipientListsEnabled: canManageGlobalRecipientLists && showEmailConfig,
  };
};

const useAdminGuardedState = <T>(initialValue: T, enabled: boolean) => {
  const [state, setState] = useState(initialValue);

  const setGuardedState = useCallback(
    (value: T) => {
      if (enabled) {
        setState(value);
      }
    },
    [enabled]
  );

  return [enabled ? state : initialValue, setGuardedState] as const;
};

/**
 * Hook to manage census email configuration and sending.
 * Extracts email handling logic from App.tsx for cleaner separation of concerns.
 */
export const useCensusEmail = ({
  record,
  currentDateString,
  nurseSignature,
  selectedYear,
  selectedMonth,
  selectedDay,
  user,
  role,
  enabled = true,
}: UseCensusEmailParams): UseCensusEmailReturn => {
  const { confirm, alert } = useConfirmDialog();
  const browserRuntime = defaultCensusEmailBrowserRuntime;
  const [showEmailConfig, setShowEmailConfig] = useState(false);
  const activeShowEmailConfig = enabled && showEmailConfig;
  const { isAdminUser, canManageGlobalRecipientLists, areGlobalRecipientListsEnabled } =
    resolveCensusEmailAccess(role, user, activeShowEmailConfig);
  const setEnabledShowEmailConfig = useCallback(
    (show: boolean) => {
      if (!enabled) {
        setShowEmailConfig(false);
        return;
      }
      setShowEmailConfig(show);
    },
    [enabled]
  );

  // ========== RECIPIENTS STATE ==========
  const {
    recipients,
    setRecipients,
    recipientLists,
    activeRecipientListId,
    setActiveRecipientListId,
    createRecipientList,
    renameActiveRecipientList,
    deleteRecipientList,
    recipientsSource,
    isRecipientsSyncing,
    recipientsSyncError,
  } = useCensusEmailRecipientLists({
    canManageGlobalRecipientLists,
    browserRuntime,
    bootstrapEnabled: enabled,
    enabled: areGlobalRecipientListsEnabled,
    user,
  });

  // ========== MESSAGE STATE ==========
  // Message is always generated dynamically based on date and nurses
  // No localStorage persistence to ensure it always reflects current data
  const { message, onMessageChange, onResetMessage } = useCensusEmailMessageState(
    currentDateString,
    nurseSignature
  );

  // ========== TEST MODE (ADMIN) ==========
  const [testModeEnabled, setTestModeEnabled] = useAdminGuardedState(false, isAdminUser);
  const [testRecipient, setTestRecipient] = useAdminGuardedState('', isAdminUser);

  // ========== UI STATE ==========
  const { status, error, setStatus, setError, resetStatus } =
    useCensusEmailSendState(currentDateString);

  // ========== HANDLERS ==========
  const { sendEmail } = useCensusEmailDeliveryActions({
    record,
    currentDateString,
    nurseSignature,
    selectedYear,
    selectedMonth,
    selectedDay,
    user,
    role,
    recipients,
    message,
    status,
    testModeEnabled,
    testRecipient,
    isAdminUser,
    setStatus,
    setError,
    confirm,
    alert,
  });

  return {
    showEmailConfig: activeShowEmailConfig,
    setShowEmailConfig: setEnabledShowEmailConfig,
    recipients,
    setRecipients,
    recipientLists,
    activeRecipientListId,
    setActiveRecipientListId,
    createRecipientList,
    renameActiveRecipientList,
    deleteRecipientList,
    recipientsSource,
    isRecipientsSyncing,
    recipientsSyncError,
    message,
    onMessageChange,
    onResetMessage,
    status,
    error,
    emailBlockedReason: resolveUpcEmailBlockReason(record, currentDateString),
    resetStatus,
    sendEmail,
    testModeEnabled,
    setTestModeEnabled,
    testRecipient,
    setTestRecipient,
    isAdminUser,
  };
};
