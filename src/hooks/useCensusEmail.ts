import { useState, useEffect, useCallback, useMemo } from 'react';
import { useConfirmDialog } from '@/context/UIContext';
import { DailyRecord } from '@/types';
import { buildCensusEmailBody, CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';
import { getAppSetting, saveAppSetting } from '@/services';
import { isAdmin } from '@/utils/permissions';
import { CensusAccessRole } from '@/types/censusAccess';
import { defaultCensusEmailBrowserRuntime } from '@/hooks/controllers/censusEmailBrowserRuntimeController';
import {
  resolveLegacyRecipients,
  resolveStoredRecipients,
} from '@/hooks/controllers/censusEmailRecipientsController';
import { useCensusEmailActions, type CensusEmailSendStatus } from '@/hooks/useCensusEmailActions';

interface UseCensusEmailParams {
  record: DailyRecord | null;
  currentDateString: string;
  nurseSignature: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  user: { uid?: string; email?: string | null; role?: string } | null;
  role: string;
}

export interface UseCensusEmailReturn {
  // Config modal state
  showEmailConfig: boolean;
  setShowEmailConfig: (show: boolean) => void;

  // Recipients
  recipients: string[];
  setRecipients: (recipients: string[]) => void;

  // Message
  message: string;
  onMessageChange: (value: string) => void;
  onResetMessage: () => void;

  // Send state
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;

  // Actions
  resetStatus: () => void;
  sendEmail: () => Promise<void>;
  sendEmailWithLink: (role?: CensusAccessRole) => Promise<void>;
  generateShareLink: (role?: CensusAccessRole) => Promise<string | null>;
  copyShareLink: (role?: CensusAccessRole) => Promise<void>;

  // Test mode
  testModeEnabled: boolean;
  setTestModeEnabled: (value: boolean) => void;
  testRecipient: string;
  setTestRecipient: (value: string) => void;
  isAdminUser: boolean;
}

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
}: UseCensusEmailParams): UseCensusEmailReturn => {
  const { confirm, alert } = useConfirmDialog();
  const isAdminUser = isAdmin(role);
  const browserRuntime = defaultCensusEmailBrowserRuntime;

  // ========== RECIPIENTS STATE ==========
  const [recipients, setRecipients] = useState<string[]>(CENSUS_DEFAULT_RECIPIENTS);

  // Load recipients from IndexedDB on mount
  useEffect(() => {
    const loadRecipients = async () => {
      const stored = await getAppSetting<string[] | null>('censusEmailRecipients', null);
      const storedRecipients = resolveStoredRecipients(stored);
      if (storedRecipients) {
        setRecipients(storedRecipients);
        return;
      }

      const legacyRecipients = resolveLegacyRecipients(browserRuntime.getLegacyRecipients());
      if (legacyRecipients) {
        setRecipients(legacyRecipients);
        await saveAppSetting('censusEmailRecipients', legacyRecipients);
        browserRuntime.clearLegacyRecipients();
      }
    };
    loadRecipients();
  }, [browserRuntime]);

  // ========== MESSAGE STATE ==========
  // Message is always generated dynamically based on date and nurses
  // No localStorage persistence to ensure it always reflects current data
  const [messageState, setMessageState] = useState<{
    key: string;
    value: string;
    edited: boolean;
  }>(() => ({
    key: currentDateString,
    value: buildCensusEmailBody(currentDateString, nurseSignature),
    edited: false,
  }));
  const message = useMemo(() => {
    if (messageState.key !== currentDateString) {
      return buildCensusEmailBody(currentDateString, nurseSignature);
    }
    if (!messageState.edited) {
      return buildCensusEmailBody(currentDateString, nurseSignature);
    }
    return messageState.value;
  }, [currentDateString, nurseSignature, messageState]);

  // ========== TEST MODE (ADMIN) ==========
  const [testModeEnabledState, setTestModeEnabledState] = useState(false);
  const [testRecipientState, setTestRecipientState] = useState('');
  const testModeEnabled = isAdminUser ? testModeEnabledState : false;
  const testRecipient = isAdminUser ? testRecipientState : '';
  const setTestModeEnabled = useCallback(
    (value: boolean) => {
      if (isAdminUser) {
        setTestModeEnabledState(value);
      }
    },
    [isAdminUser]
  );
  const setTestRecipient = useCallback(
    (value: string) => {
      if (isAdminUser) {
        setTestRecipientState(value);
      }
    },
    [isAdminUser]
  );

  // ========== UI STATE ==========
  const [showEmailConfig, setShowEmailConfig] = useState(false);
  const [sendState, setSendState] = useState<{
    key: string;
    status: CensusEmailSendStatus;
    error: string | null;
  }>(() => ({
    key: currentDateString,
    status: 'idle',
    error: null,
  }));
  const status =
    sendState.key === currentDateString ? sendState.status : ('idle' as CensusEmailSendStatus);
  const error = sendState.key === currentDateString ? sendState.error : null;
  const setStatus = useCallback(
    (next: React.SetStateAction<CensusEmailSendStatus>) => {
      setSendState(previous => {
        const previousStatus = previous.key === currentDateString ? previous.status : 'idle';
        const nextStatus =
          typeof next === 'function'
            ? (next as (prev: CensusEmailSendStatus) => CensusEmailSendStatus)(previousStatus)
            : next;
        return {
          key: currentDateString,
          status: nextStatus,
          error: previous.key === currentDateString ? previous.error : null,
        };
      });
    },
    [currentDateString]
  );
  const setError = useCallback(
    (next: React.SetStateAction<string | null>) => {
      setSendState(previous => {
        const previousError = previous.key === currentDateString ? previous.error : null;
        const nextError =
          typeof next === 'function'
            ? (next as (prev: string | null) => string | null)(previousError)
            : next;
        return {
          key: currentDateString,
          status: previous.key === currentDateString ? previous.status : 'idle',
          error: nextError,
        };
      });
    },
    [currentDateString]
  );

  // ========== PERSISTENCE EFFECTS ==========
  useEffect(() => {
    saveAppSetting('censusEmailRecipients', recipients);
  }, [recipients]);

  // ========== HANDLERS ==========
  const onMessageChange = useCallback(
    (value: string) => {
      setMessageState({
        key: currentDateString,
        value,
        edited: true,
      });
    },
    [currentDateString]
  );

  const onResetMessage = useCallback(() => {
    setMessageState({
      key: currentDateString,
      value: buildCensusEmailBody(currentDateString, nurseSignature),
      edited: false,
    });
  }, [currentDateString, nurseSignature]);

  const resetStatus = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, [setError, setStatus]);

  const { sendEmail, sendEmailWithLink, generateShareLink, copyShareLink } = useCensusEmailActions({
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
    browserRuntime,
  });

  return {
    showEmailConfig,
    setShowEmailConfig,
    recipients,
    setRecipients,
    message,
    onMessageChange,
    onResetMessage,
    status,
    error,
    resetStatus,
    sendEmail,
    sendEmailWithLink,
    generateShareLink,
    copyShareLink,
    testModeEnabled,
    setTestModeEnabled,
    testRecipient,
    setTestRecipient,
    isAdminUser,
  };
};
