import type { RefObject } from 'react';
import type { UseCensusEmailDeliveryActionsParams } from '@/hooks/useCensusEmailDeliveryActions';
import { resolveCensusEmailSendOutcomePresentation } from '@/hooks/controllers/censusEmailOutcomeController';
import { resolveUpcEmailBlockReason } from '@/shared/census/upcEvaluationPolicy';

import {
  buildSendCensusConfirmationMessage,
  executeSendCensusEmail,
} from '@/application/census-email/sendCensusEmailUseCases';

type DeliveryParams = Omit<UseCensusEmailDeliveryActionsParams, 'status' | 'record'> & {
  latestContext: RefObject<
    Pick<UseCensusEmailDeliveryActionsParams, 'record' | 'currentDateString'>
  >;
};

export const deliverCensusEmail = async ({
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
}: DeliveryParams): Promise<void> => {
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
  const latest = latestContext.current;
  const finalBlockReason =
    latest.currentDateString !== currentDateString
      ? 'El censo cambió de fecha. Revisa el día antes de enviar.'
      : resolveUpcEmailBlockReason(latest.record, currentDateString);
  if (finalBlockReason) {
    setError(finalBlockReason);
    setStatus('error');
    await alert(finalBlockReason, 'Envío bloqueado');
    return;
  }

  setError(null);
  setStatus('loading');

  const result = await executeSendCensusEmail({
    record: latest.record,
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
};
