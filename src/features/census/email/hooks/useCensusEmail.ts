import { useState, useCallback, useMemo } from 'react';
import { useConfirmDialog } from '@/context/UIContext';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { defaultCensusEmailBrowserRuntime } from '@/features/census/email/controllers/censusEmailBrowserRuntimeController';
import type { UseCensusEmailReturn } from '@/context/CensusContext';
import {
  canManageGlobalCensusEmailRecipients,
  canUseAdminMaintenanceActions,
} from '@/shared/access/operationalAccessPolicy';
import { useCensusEmailDeliveryActions } from '@/features/census/email/hooks/useCensusEmailDeliveryActions';
import { useCensusEmailRecipientLists } from '@/features/census/email/hooks/useCensusEmailRecipientLists';
import { useCensusEmailMessageState } from '@/features/census/email/hooks/useCensusEmailMessageState';
import { useCensusEmailSendState } from '@/features/census/email/hooks/useCensusEmailSendState';
import { resolveUpcEmailBlockReason } from '@/shared/census/upcEvaluationPolicy';

export interface UseCensusEmailParams {
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

  const emailBlockedReason = useMemo(
    () => resolveUpcEmailBlockReason(record, currentDateString),
    [record, currentDateString]
  );

  return useMemo(
    () => ({
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
      emailBlockedReason,
      resetStatus,
      sendEmail,
      testModeEnabled,
      setTestModeEnabled,
      testRecipient,
      setTestRecipient,
      isAdminUser,
    }),
    [
      activeShowEmailConfig,
      setEnabledShowEmailConfig,
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
      emailBlockedReason,
      resetStatus,
      sendEmail,
      testModeEnabled,
      setTestModeEnabled,
      testRecipient,
      setTestRecipient,
      isAdminUser,
    ]
  );
};
