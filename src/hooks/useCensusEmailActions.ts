import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ConfirmOptions } from '@/context/uiContracts';
import type { CensusAccessRole } from '@/types/censusAccess';
import type { DailyRecord } from '@/types';
import {
  formatDate,
  getMonthRecordsFromFirestore,
  initializeDay,
  triggerCensusEmail,
} from '@/services';
import { buildCensusMasterWorkbook } from '@/services/exporters/censusMasterWorkbook';
import { uploadCensus } from '@/services/backup/censusStorageService';
import type { CensusEmailBrowserRuntime } from '@/hooks/controllers/censusEmailBrowserRuntimeController';
import { buildSharedCensusLink } from '@/hooks/controllers/censusEmailBrowserRuntimeController';
import { CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';
import { resolveSendingRecipients } from '@/hooks/controllers/censusEmailRecipientsController';
import {
  buildCensusEmailConfirmationText,
  buildMonthIntegrityDates,
  resolveFinalCensusEmailMessage,
  resolveMonthRecordsForDelivery,
} from '@/hooks/controllers/censusEmailSendController';

export type CensusEmailSendStatus = 'idle' | 'loading' | 'success' | 'error';

interface UseCensusEmailActionsParams {
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
  browserRuntime: CensusEmailBrowserRuntime;
}

interface UseCensusEmailActionsResult {
  sendEmail: () => Promise<void>;
  sendEmailWithLink: (role?: CensusAccessRole) => Promise<void>;
  generateShareLink: (role?: CensusAccessRole) => Promise<string | null>;
  copyShareLink: (role?: CensusAccessRole) => Promise<void>;
}

export const useCensusEmailActions = ({
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
}: UseCensusEmailActionsParams): UseCensusEmailActionsResult => {
  const generateShareLink = useCallback(
    async (_accessRole: CensusAccessRole = 'viewer'): Promise<string | null> => {
      try {
        const origin = browserRuntime.getOrigin();
        if (!origin) {
          throw new Error('No se pudo resolver el origen de la aplicación.');
        }

        return buildSharedCensusLink(origin);
      } catch (err) {
        console.error('Error generating share link', err);
        await alert('No se pudo generar el link de acceso.');
        return null;
      }
    },
    [alert, browserRuntime]
  );

  const sendEmail = useCallback(async () => {
    if (!record) {
      await alert('No hay datos del censo para enviar.');
      return;
    }

    if (status === 'loading' || status === 'success') return;

    const shouldUseTestMode = isAdminUser && testModeEnabled;
    const recipientsResult = resolveSendingRecipients({
      recipients,
      shouldUseTestMode,
      testRecipient,
    });
    if (!recipientsResult.ok) {
      setError(recipientsResult.error);
      await alert(recipientsResult.error, 'Modo prueba');
      return;
    }
    const resolvedRecipients = recipientsResult.recipients;

    const confirmationText = buildCensusEmailConfirmationText({
      currentDateString,
      recipients: resolvedRecipients,
      shouldUseTestMode,
      formatDate,
    });

    const confirmed = await confirm({
      title: 'Confirmar Envío de Censo',
      message: confirmationText,
      confirmText: 'Aceptar',
      cancelText: 'Cancelar',
      variant: 'info',
    });
    if (!confirmed) return;

    setError(null);
    setStatus('loading');

    try {
      const integrityDates = buildMonthIntegrityDates({
        year: selectedYear,
        monthZeroBased: selectedMonth,
        day: selectedDay,
      });
      for (let index = 0; index < integrityDates.length; index += 1) {
        const date = integrityDates[index];
        const previousDate = index > 0 ? integrityDates[index - 1] : undefined;
        try {
          await initializeDay(date, previousDate);
        } catch (errorOnInitialize) {
          console.warn(`[useCensusEmail] Failed to initialize day ${date}:`, errorOnInitialize);
        }
      }

      const finalMessage = resolveFinalCensusEmailMessage({
        message,
        currentDateString,
        nurseSignature,
      });
      const monthRecords = await getMonthRecordsFromFirestore(selectedYear, selectedMonth);
      const filteredRecords = resolveMonthRecordsForDelivery({
        monthRecords,
        currentRecord: record,
        currentDateString,
        selectedYear,
        selectedMonth,
        selectedDay,
      });
      await triggerCensusEmail({
        date: currentDateString,
        records: filteredRecords,
        recipients: resolvedRecipients,
        nursesSignature: nurseSignature || undefined,
        body: finalMessage,
        userEmail: user?.email,
        userRole: user?.role || role,
      });

      try {
        const workbook = await buildCensusMasterWorkbook(filteredRecords);
        const buffer = await workbook.xlsx.writeBuffer();
        const excelBlob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

        await uploadCensus(excelBlob, currentDateString);
      } catch (backupErr) {
        console.error('[useCensusEmail] Cloud backup failed (but email was sent):', backupErr);
      }

      setStatus('success');
    } catch (err: unknown) {
      const resolvedError = err as { message?: string };
      console.error('Error enviando correo de censo', err);
      const errorMessage = resolvedError?.message || 'No se pudo enviar el correo.';
      setError(errorMessage);
      setStatus('error');
      await alert(errorMessage, 'Error al enviar');
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
    user?.email,
    user?.role,
  ]);

  const sendEmailWithLink = useCallback(
    async (accessRole: CensusAccessRole = 'viewer') => {
      if (!record) {
        await alert('No hay datos del censo para enviar.');
        return;
      }

      if (status === 'loading' || status === 'success') return;

      const confirmed = await confirm({
        title: 'Enviar Link de Acceso',
        message:
          '¿Estás seguro de enviar un link de acceso seguro a los destinatarios configurados?\n\nEsto permitirá a los usuarios visualizar el censo sin necesidad de archivos Excel.',
        confirmText: 'Aceptar',
        cancelText: 'Cancelar',
        variant: 'info',
      });
      if (!confirmed) return;

      setStatus('loading');
      setError(null);

      try {
        const shareLink = await generateShareLink(accessRole);
        if (!shareLink) throw new Error('No se pudo generar el link.');

        const recipientsResult = resolveSendingRecipients({
          recipients,
          shouldUseTestMode: false,
          testRecipient: '',
        });
        const resolvedRecipients = recipientsResult.ok
          ? recipientsResult.recipients
          : CENSUS_DEFAULT_RECIPIENTS;

        await triggerCensusEmail({
          date: currentDateString,
          records: [record],
          recipients: resolvedRecipients,
          nursesSignature: nurseSignature || undefined,
          body: message,
          shareLink,
          userEmail: user?.email,
          userRole: user?.role || role,
        });

        setStatus('success');
      } catch (err: unknown) {
        console.error('Error sending email with link', err);
        const errorMessage = (err as Error).message || 'Error al enviar link.';
        setError(errorMessage);
        setStatus('error');
        await alert(errorMessage || 'No se pudo enviar el link de acceso.');
      }
    },
    [
      alert,
      confirm,
      currentDateString,
      generateShareLink,
      message,
      nurseSignature,
      recipients,
      record,
      role,
      setError,
      setStatus,
      status,
      user?.email,
      user?.role,
    ]
  );

  const copyShareLink = useCallback(
    async (accessRole: CensusAccessRole = 'viewer') => {
      const link = await generateShareLink(accessRole);
      if (link) {
        try {
          await browserRuntime.writeClipboard(link);
          await alert('Copiado al portapapeles: ' + link, 'Link Copiado');
        } catch (err) {
          console.error('Clipboard error', err);
          await alert('No se pudo copiar el link. Intenta manualmente: ' + link);
        }
      }
    },
    [alert, browserRuntime, generateShareLink]
  );

  return {
    sendEmail,
    sendEmailWithLink,
    generateShareLink,
    copyShareLink,
  };
};
