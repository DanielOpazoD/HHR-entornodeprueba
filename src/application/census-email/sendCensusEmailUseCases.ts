import { formatDateDDMMYYYY as formatDate } from '@/utils/dateDisplayUtils';
import { resolveSendingRecipients } from '@/features/census';
import { buildCensusWorkbookPlan } from '@/hooks/controllers/censusExcelSheetController';
import {
  buildCensusEmailConfirmationText,
  buildMonthIntegrityDates,
  resolveFinalCensusEmailMessage,
  resolveMonthRecordsForDelivery,
} from '@/hooks/controllers/censusEmailSendController';
import {
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  defaultDailyRecordReadPort,
  type DailyRecordReadPort,
} from '@/application/ports/dailyRecordPort';
import {
  defaultCensusEmailDeliveryPort,
  type CensusEmailDeliveryPort,
} from '@/application/ports/censusEmailPort';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import { resolveUpcEmailBlockReason } from '@/shared/census/upcEvaluationPolicy';

interface BaseCensusEmailInput {
  currentDateString: string;
  nurseSignature: string;
  record: CensusExportRecord | null;
  recipients: string[];
  message: string;
  role: string;
  user: { uid?: string; email?: string | null; role?: string } | null;
}

export interface SendCensusEmailInput extends BaseCensusEmailInput {
  selectedYear: number;
  selectedMonth: number;
  selectedDay: number;
  testModeEnabled: boolean;
  testRecipient: string;
  isAdminUser: boolean;
}

export interface SendCensusEmailOutput {
  recipients: string[];
  backupUploaded: boolean;
}

export interface CensusEmailUseCaseDependencies {
  dailyRecordReadPort?: Pick<DailyRecordReadPort, 'initializeDay' | 'getMonthRecords'>;
  censusEmailDeliveryPort?: CensusEmailDeliveryPort;
}

export const buildSendCensusConfirmationMessage = (
  input: Pick<
    SendCensusEmailInput,
    'currentDateString' | 'recipients' | 'testModeEnabled' | 'testRecipient' | 'isAdminUser'
  >
): string => {
  const recipientsResult = resolveSendingRecipients({
    recipients: input.recipients,
    shouldUseTestMode: input.isAdminUser && input.testModeEnabled,
    testRecipient: input.testRecipient,
  });

  return buildCensusEmailConfirmationText({
    currentDateString: input.currentDateString,
    recipients: recipientsResult.ok ? recipientsResult.recipients : [],
    shouldUseTestMode: input.isAdminUser && input.testModeEnabled,
    formatDate,
  });
};

export const executeSendCensusEmail = async (
  input: SendCensusEmailInput,
  dependencies: CensusEmailUseCaseDependencies = {}
): Promise<ApplicationOutcome<SendCensusEmailOutput | null>> => {
  const dailyRecordReadPort = dependencies.dailyRecordReadPort || defaultDailyRecordReadPort;
  const censusEmailDeliveryPort =
    dependencies.censusEmailDeliveryPort || defaultCensusEmailDeliveryPort;
  if (!input.record) {
    return createApplicationFailed(null, [
      { kind: 'validation', message: 'No hay datos del censo para enviar.' },
    ]);
  }
  const upcBlockReason = resolveUpcEmailBlockReason(input.record, input.currentDateString);
  if (upcBlockReason) {
    return createApplicationFailed(null, [{ kind: 'validation', message: upcBlockReason }]);
  }

  const recipientsResult = resolveSendingRecipients({
    recipients: input.recipients,
    shouldUseTestMode: input.isAdminUser && input.testModeEnabled,
    testRecipient: input.testRecipient,
  });
  if (!recipientsResult.ok) {
    return createApplicationFailed(null, [{ kind: 'validation', message: recipientsResult.error }]);
  }

  const issues: Array<{ kind: 'unknown'; message: string }> = [];

  try {
    const integrityDates = buildMonthIntegrityDates({
      year: input.selectedYear,
      monthZeroBased: input.selectedMonth,
      day: input.selectedDay,
    });

    for (let index = 0; index < integrityDates.length; index += 1) {
      const date = integrityDates[index];
      const previousDate = index > 0 ? integrityDates[index - 1] : undefined;
      try {
        await dailyRecordReadPort.initializeDay(date, previousDate);
      } catch (errorOnInitialize) {
        issues.push({
          kind: 'unknown',
          message:
            errorOnInitialize instanceof Error
              ? `No se pudo inicializar ${date}: ${errorOnInitialize.message}`
              : `No se pudo inicializar ${date}.`,
        });
      }
    }

    const finalMessage = resolveFinalCensusEmailMessage({
      message: input.message,
      currentDateString: input.currentDateString,
      nurseSignature: input.nurseSignature,
    });
    const monthRecords = await dailyRecordReadPort.getMonthRecords(
      input.selectedYear,
      input.selectedMonth
    );
    const filteredRecords = resolveMonthRecordsForDelivery({
      monthRecords,
      currentRecord: input.record,
      currentDateString: input.currentDateString,
      selectedYear: input.selectedYear,
      selectedMonth: input.selectedMonth,
      selectedDay: input.selectedDay,
    });
    const workbookPlan = buildCensusWorkbookPlan({
      monthRecords: filteredRecords,
      currentDateString: input.currentDateString,
    });

    // Validate the actual day selected for the attachment, which may differ from the UI snapshot.
    const deliveryRecord = filteredRecords.find(record => record.date === input.currentDateString);
    const deliveryBlockReason = deliveryRecord
      ? resolveUpcEmailBlockReason(deliveryRecord, input.currentDateString)
      : 'No hay datos del día seleccionado para enviar.';
    if (deliveryBlockReason) {
      return createApplicationFailed(null, [{ kind: 'validation', message: deliveryBlockReason }]);
    }

    const sendResult = await censusEmailDeliveryPort.sendEmailWithResult({
      date: input.currentDateString,
      records: workbookPlan.records,
      sheetDescriptors: workbookPlan.sheetDescriptors,
      recipients: recipientsResult.recipients,
      nursesSignature: input.nurseSignature || undefined,
      body: finalMessage,
      userEmail: input.user?.email,
      userRole: input.user?.role || input.role,
    });
    if (sendResult.status !== 'success') {
      return createApplicationFailed(null, sendResult.issues, {
        userSafeMessage: sendResult.userSafeMessage,
      });
    }

    let backupUploaded = true;
    try {
      const { buildCensusMasterBinary } = await import('@/services/exporters/censusMasterWorkbook');
      const binary = await buildCensusMasterBinary(workbookPlan.records, {
        sheetDescriptors: workbookPlan.sheetDescriptors,
      });
      const excelBlob = new Blob([binary], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const backupResult = await censusEmailDeliveryPort.uploadBackupWithResult(
        excelBlob,
        input.currentDateString
      );
      if (backupResult.status !== 'success') {
        throw new Error(
          backupResult.issues[0]?.userSafeMessage ||
            backupResult.issues[0]?.message ||
            'No se pudo respaldar la copia en la nube.'
        );
      }
    } catch (backupError) {
      backupUploaded = false;
      issues.push({
        kind: 'unknown',
        message:
          backupError instanceof Error
            ? `No se pudo respaldar la copia en la nube: ${backupError.message}`
            : 'No se pudo respaldar la copia en la nube.',
      });
    }

    const output = {
      recipients: recipientsResult.recipients,
      backupUploaded,
    };

    if (issues.length > 0) {
      return createApplicationPartial(output, issues);
    }

    return createApplicationSuccess(output);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo enviar el correo.',
      },
    ]);
  }
};
