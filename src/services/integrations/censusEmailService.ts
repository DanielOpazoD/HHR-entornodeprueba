import { CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { CensusWorkbookSheetDescriptor } from '@/services/exporters/censusMasterWorkbook';
import {
  getDevelopmentSendDisabledMessage,
  resolveCensusEmailRuntimePolicy,
} from '@/services/integrations/censusEmailRuntimePolicy';
import { sendCensusEmailRequest } from '@/services/integrations/censusEmailNetworkClient';
import { buildCensusEmailRequestBody } from '@/services/integrations/censusEmailRequestPayload';
import { assertCensusEmailSendingAllowed } from '@/services/integrations/censusEmailSendPolicy';
import { savePasswordToFirestore } from '@/services/security/exportPasswordService';
import { CensusEmailResponseSchema, type CensusEmailResponse } from '@/shared/contracts/serverless';

export const resolveCensusEmailRecipients = (recipients?: string[]): string[] => {
  const finalRecipients =
    recipients && recipients.length > 0 ? recipients : CENSUS_DEFAULT_RECIPIENTS;

  if (finalRecipients.length === 0) {
    throw new Error(
      'No se especificaron destinatarios para el correo. Configure los destinatarios antes de enviar.'
    );
  }

  return finalRecipients;
};

interface TriggerEmailParams {
  date: string;
  records: CensusExportRecord[];
  recipients?: string[];
  nursesSignature?: string;
  body?: string;
  userEmail?: string | null;
  userRole?: string | null;
  sheetDescriptors?: CensusWorkbookSheetDescriptor[];
}

const { endpoint: ENDPOINT, allowDevelopmentEmailSend } = resolveCensusEmailRuntimePolicy({
  isDevelopment: import.meta.env.DEV,
  allowDevEmailSendRaw: import.meta.env.VITE_ALLOW_DEV_EMAIL_SEND,
  endpointRaw: import.meta.env.VITE_CENSUS_EMAIL_ENDPOINT,
});

export const triggerCensusEmail = async (
  params: TriggerEmailParams
): Promise<CensusEmailResponse> => {
  const {
    date,
    records,
    recipients,
    nursesSignature,
    body,
    userEmail,
    userRole,
    sheetDescriptors,
  } = params;

  assertCensusEmailSendingAllowed({
    isDevelopment: import.meta.env.DEV,
    allowDevelopmentEmailSend,
    date,
    recipients,
    recordCount: records.length,
    disabledMessage: getDevelopmentSendDisabledMessage(),
    endpoint: ENDPOINT,
  });

  const finalRecipients = resolveCensusEmailRecipients(recipients);

  const response = await sendCensusEmailRequest({
    endpoint: ENDPOINT,
    userEmail,
    userRole,
    body: buildCensusEmailRequestBody({
      date,
      records,
      recipients: finalRecipients,
      nursesSignature,
      body,
      sheetDescriptors,
    }),
  });

  const result = CensusEmailResponseSchema.parse(await response.json());

  if (result.exportPassword && result.censusDate) {
    await savePasswordToFirestore(
      result.censusDate,
      result.exportPassword,
      userEmail || undefined,
      'email'
    );
  }

  return result;
};
