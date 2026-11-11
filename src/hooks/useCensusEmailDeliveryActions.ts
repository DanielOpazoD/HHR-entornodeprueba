import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ConfirmOptions } from '@/context/uiContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { canRunCensusEmailAction } from '@/hooks/controllers/censusEmailActionController';
import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';
import { resolveUpcEmailBlockReason } from '@/shared/census/upcEvaluationPolicy';

export type CensusEmailSendStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseCensusEmailDeliveryActionsParams {
  record: DailyRecord | null;
  currentDateString: string;
  nurseSignature: string;
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  user: { uid?: string; email?: string | null; role?: string } | null;
  role: string;
  recipients: string[];
  message: string;
  status: CensusEmailSendStatus;
  testModeEnabled: boolean;
  testRecipient: string;
  isAdminUser: boolean;
  setStatus: Dispatch<SetStateAction<CensusEmailSendStatus>>;
  setError: Dispatch<SetStateAction<string | null>>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (message: string, title?: string) => Promise<void>;
}

const loadCensusEmailDelivery = createCachedRuntimeLoader(
  () => import('@/hooks/controllers/censusEmailDeliveryRuntime')
);

const resolveLazyEmailModuleError = (error: unknown): string =>
  error instanceof Error
    ? `No se pudo cargar el envío de censo: ${error.message}`
    : 'No se pudo cargar el envío de censo.';

export const useCensusEmailDeliveryActions = ({
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
}: UseCensusEmailDeliveryActionsParams) => {
  const latestContext = useRef({ record, currentDateString });
  useLayoutEffect(() => {
    latestContext.current = { record, currentDateString };
  }, [record, currentDateString]);
  const sendEmail = useCallback(async () => {
    if (!canRunCensusEmailAction(status)) return;
    const blockReason = resolveUpcEmailBlockReason(record, currentDateString);
    if (blockReason) {
      setError(blockReason);
      setStatus('error');
      await alert(blockReason, 'Evaluación UPC pendiente');
      return;
    }
    let delivery: Awaited<ReturnType<typeof loadCensusEmailDelivery>>;
    try {
      delivery = await loadCensusEmailDelivery();
    } catch (loadError) {
      setError(resolveLazyEmailModuleError(loadError));
      setStatus('error');
      return;
    }
    await delivery.deliverCensusEmail({
      currentDateString,
      nurseSignature,
      selectedYear,
      selectedMonth,
      selectedDay,
      user,
      role,
      recipients,
      message,
      testModeEnabled,
      testRecipient,
      isAdminUser,
      setStatus,
      setError,
      confirm,
      alert,
      latestContext,
    });
  }, [
    alert,
    confirm,
    currentDateString,
    isAdminUser,
    message,
    nurseSignature,
    recipients,
    record,
    role,
    selectedDay,
    selectedMonth,
    selectedYear,
    setError,
    setStatus,
    status,
    testModeEnabled,
    testRecipient,
    user,
  ]);

  return {
    sendEmail,
  };
};
