import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ConfirmOptions } from '@/context/uiContracts';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { canRunCensusEmailAction } from '@/hooks/controllers/censusEmailActionController';
import { resolveCensusEmailSendOutcomePresentation } from '@/hooks/controllers/censusEmailOutcomeController';

export type CensusEmailSendStatus = 'idle' | 'loading' | 'success' | 'error';

interface UseCensusEmailDeliveryActionsParams {
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

const loadSendCensusEmailUseCases = () =>
  import('@/application/census-email/sendCensusEmailUseCases');

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
  const sendEmail = useCallback(async () => {
    if (!canRunCensusEmailAction(status)) return;
    let useCases: Awaited<ReturnType<typeof loadSendCensusEmailUseCases>>;
    try {
      useCases = await loadSendCensusEmailUseCases();
    } catch (loadError) {
      setError(resolveLazyEmailModuleError(loadError));
      setStatus('error');
      return;
    }
    const { buildSendCensusConfirmationMessage, executeSendCensusEmail } = useCases;
    const confirmed = await confirm({
      title: 'Confirmar Envío de Censo',
      message: buildSendCensusConfirmationMessage({
        currentDateString,
        recipients,
        testModeEnabled,
        testRecipient,
        isAdminUser,
      }),
      confirmText: 'Aceptar',
      cancelText: 'Cancelar',
      variant: 'info',
    });
    if (!confirmed) return;

    setError(null);
    setStatus('loading');

    const result = await executeSendCensusEmail({
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
      testModeEnabled,
      testRecipient,
      isAdminUser,
    });

    const presentation = resolveCensusEmailSendOutcomePresentation(result, {
      fallbackErrorMessage: 'No se pudo enviar el correo.',
      partialTitle: 'Envío completado con advertencias',
      errorTitle: 'Error al enviar',
      validationTitle: 'Modo prueba',
      shouldUseValidationTitle: isAdminUser && testModeEnabled,
    });

    setError(presentation.error);
    setStatus(presentation.nextStatus);
    if (presentation.alertMessage) {
      await alert(presentation.alertMessage, presentation.alertTitle);
    }
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
