import React from 'react';
import type { UseCensusEmailReturn } from '@/context/CensusContext';
import type { CensusEmailRuntimeBridgeProps } from '@/app-shell/runtime/CensusEmailRuntimeBridge';
import { resolveUpcEmailBlockReason } from '@/shared/census/upcEvaluationPolicy';
import { canUseAdminMaintenanceActions } from '@/shared/access/operationalAccessPolicy';

export type DeferredCensusEmailParams = CensusEmailRuntimeBridgeProps['params'];
export type CensusEmailRuntimeBridgeComponent = React.ComponentType<CensusEmailRuntimeBridgeProps>;

export const loadCensusEmailRuntimeBridge =
  async (): Promise<CensusEmailRuntimeBridgeComponent> => {
    const module = await import('@/app-shell/runtime/CensusEmailRuntimeBridge');
    return module.CensusEmailRuntimeBridge;
  };

const noop = () => undefined;
const noopAsync = async () => undefined;
const EMPTY_RECIPIENTS: string[] = [];
const EMPTY_RECIPIENT_LISTS: UseCensusEmailReturn['recipientLists'] = [];

export interface UseDeferredCensusEmailReturn {
  censusEmail: UseCensusEmailReturn;
  censusEmailBridge: React.ReactNode;
}

/**
 * Keeps the census email hook tree (recipient sync, message builder, send state)
 * outside `app-authenticated-shell` startup bytes while preserving the full
 * `UseCensusEmailReturn` contract. The real bridge loads asynchronously once the
 * census module mounts (or immediately if the user invokes an email action first).
 */
export const useDeferredCensusEmail = (
  params: DeferredCensusEmailParams
): UseDeferredCensusEmailReturn => {
  const {
    record,
    currentDateString,
    nurseSignature,
    selectedYear,
    selectedMonth,
    selectedDay,
    user,
    role,
    enabled = true,
  } = params;

  const [Bridge, setBridge] = React.useState<CensusEmailRuntimeBridgeComponent | null>(null);
  const [loadedValue, setLoadedValue] = React.useState<UseCensusEmailReturn | null>(null);
  const pendingShowConfigRef = React.useRef<boolean | null>(null);
  const pendingSendsRef = React.useRef<Array<() => void>>([]);
  const loadPromiseRef = React.useRef<Promise<void> | null>(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensureBridgeLoaded = React.useCallback(() => {
    if (loadPromiseRef.current) return loadPromiseRef.current;

    const nextPromise = loadCensusEmailRuntimeBridge()
      .then(component => {
        if (mountedRef.current) {
          setBridge(() => component);
        }
      })
      .catch(() => {
        loadPromiseRef.current = null;
        // Optional email runtime must not interrupt the authenticated clinical shell.
        const pendingSends = pendingSendsRef.current.splice(0);
        pendingSends.forEach(resolve => resolve());
      });

    loadPromiseRef.current = nextPromise;
    return nextPromise;
  }, []);

  React.useEffect(() => {
    if (enabled) {
      void ensureBridgeLoaded();
    }
  }, [enabled, ensureBridgeLoaded]);

  React.useEffect(() => {
    if (!loadedValue) return;

    if (pendingShowConfigRef.current !== null) {
      const desired = pendingShowConfigRef.current;
      pendingShowConfigRef.current = null;
      loadedValue.setShowEmailConfig(desired);
    }

    if (pendingSendsRef.current.length > 0) {
      const pendingResolvers = pendingSendsRef.current.splice(0);
      void loadedValue.sendEmail().finally(() => {
        pendingResolvers.forEach(resolve => resolve());
      });
    }
  }, [loadedValue]);

  const deferredSetShowEmailConfig = React.useCallback(
    (show: boolean) => {
      if (!enabled) {
        pendingShowConfigRef.current = null;
        return;
      }
      pendingShowConfigRef.current = show;
      if (show) {
        void ensureBridgeLoaded();
      }
    },
    [enabled, ensureBridgeLoaded]
  );

  const deferredSendEmail = React.useCallback((): Promise<void> => {
    return new Promise<void>(resolve => {
      pendingSendsRef.current.push(resolve);
      void ensureBridgeLoaded();
    });
  }, [ensureBridgeLoaded]);

  const emailBlockedReason = React.useMemo(
    () => resolveUpcEmailBlockReason(record, currentDateString),
    [record, currentDateString]
  );

  const isAdminUser = React.useMemo(() => canUseAdminMaintenanceActions(role), [role]);

  const fallbackCensusEmail = React.useMemo<UseCensusEmailReturn>(
    () => ({
      showEmailConfig: false,
      setShowEmailConfig: deferredSetShowEmailConfig,
      recipients: EMPTY_RECIPIENTS,
      setRecipients: noop,
      recipientLists: EMPTY_RECIPIENT_LISTS,
      activeRecipientListId: '',
      setActiveRecipientListId: noop,
      createRecipientList: noopAsync,
      renameActiveRecipientList: noopAsync,
      deleteRecipientList: noopAsync,
      recipientsSource: 'default',
      isRecipientsSyncing: false,
      recipientsSyncError: null,
      message: '',
      onMessageChange: noop,
      onResetMessage: noop,
      status: 'idle',
      error: null,
      emailBlockedReason,
      resetStatus: noop,
      sendEmail: deferredSendEmail,
      testModeEnabled: false,
      setTestModeEnabled: noop,
      testRecipient: '',
      setTestRecipient: noop,
      isAdminUser,
    }),
    [deferredSendEmail, deferredSetShowEmailConfig, emailBlockedReason, isAdminUser]
  );

  const bridgeParams = React.useMemo<DeferredCensusEmailParams>(
    () => ({
      record,
      currentDateString,
      nurseSignature,
      selectedYear,
      selectedMonth,
      selectedDay,
      user,
      role,
      enabled,
    }),
    [
      currentDateString,
      enabled,
      nurseSignature,
      record,
      role,
      selectedDay,
      selectedMonth,
      selectedYear,
      user,
    ]
  );

  const censusEmailBridge = React.useMemo(
    () =>
      Bridge
        ? React.createElement(Bridge, {
            params: bridgeParams,
            onValueChange: setLoadedValue,
          })
        : null,
    [Bridge, bridgeParams]
  );

  return {
    censusEmail: loadedValue ?? fallbackCensusEmail,
    censusEmailBridge,
  };
};
