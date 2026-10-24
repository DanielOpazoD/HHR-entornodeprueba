import { BEDS } from '@/constants/beds';
import type { ApplyDailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  executeEnsureMedicalHandoffSignatureLink,
  executeMarkMedicalHandoffAsSent,
} from './handoffDeliveryUseCases';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

export interface SendMedicalHandoffInput {
  record: DailyRecord;
  templateContent: string;
  targetGroupId: string;
  patchRecord: ApplyDailyRecordPatch;
  getPreviousDay: (date: string) => Promise<DailyRecord | null>;
  scope?: MedicalHandoffScope;
}

export interface SendMedicalHandoffOutput {
  sentAt: string;
  doctorName: string;
  handoffUrl: string;
  nextRecord: DailyRecord;
}

const resolveDoctorName = async (
  record: DailyRecord,
  getPreviousDay: (date: string) => Promise<DailyRecord | null>
): Promise<string> => {
  if (record.medicalHandoffDoctor) {
    return record.medicalHandoffDoctor;
  }

  const previousRecord = await getPreviousDay(record.date);
  return previousRecord?.medicalHandoffDoctor || 'Sin especificar';
};

const resolveHandoffStats = (record: DailyRecord) => {
  const activeExtras = record.activeExtraBeds || [];
  const visibleBeds = BEDS.filter(bed => !bed.isExtra || activeExtras.includes(bed.id));

  const hospitalized = visibleBeds.filter(
    b => record.beds[b.id]?.patientName && !record.beds[b.id]?.isBlocked
  ).length;
  const blockedBeds = visibleBeds.filter(b => record.beds[b.id]?.isBlocked).length;
  const freeBeds = visibleBeds.length - hospitalized - blockedBeds;

  return { hospitalized, freeBeds };
};

export const executeSendMedicalHandoff = async (
  input: SendMedicalHandoffInput
): Promise<ApplicationOutcome<SendMedicalHandoffOutput | null>> => {
  try {
    const { formatHandoffMessage, sendWhatsAppMessage } =
      await import('@/services/integrations/whatsapp/whatsappService');
    const scope = input.scope || 'all';
    const doctorName = await resolveDoctorName(input.record, input.getPreviousDay);
    const { hospitalized, freeBeds } = resolveHandoffStats(input.record);

    const linkOutcome = await executeEnsureMedicalHandoffSignatureLink({
      record: input.record,
      scope,
      patchRecord: input.patchRecord,
    });
    if (linkOutcome.status === 'failed') {
      return createApplicationFailed(null, linkOutcome.issues, {
        reason: linkOutcome.reason,
        userSafeMessage: linkOutcome.userSafeMessage,
        retryable: linkOutcome.retryable,
        severity: linkOutcome.severity,
        technicalContext: linkOutcome.technicalContext,
        telemetryTags: linkOutcome.telemetryTags,
      });
    }
    const handoffUrl = linkOutcome.data?.handoffUrl;
    if (!handoffUrl) {
      return createApplicationFailed(null, [
        {
          kind: 'unknown',
          message: 'No se pudo generar el enlace de firma médica.',
          userSafeMessage: 'No se pudo generar el enlace de firma médica.',
          severity: 'error',
          telemetryTags: ['handoff', 'send_medical_handoff', 'missing_signature_link'],
        },
      ]);
    }

    const [year, month, day] = input.record.date.split('-');
    const dateStr = `${day}-${month}-${year}`;
    const sentAt = new Date().toISOString();

    const message = formatHandoffMessage(input.templateContent, {
      date: dateStr,
      signedBy: doctorName,
      signedAt: new Date(sentAt).toLocaleTimeString('es-CL', {
        timeZone: CLINICAL_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
      }),
      hospitalized,
      freeBeds,
      newAdmissions: 0,
      discharges: 0,
      handoffUrl,
    });

    const result = await sendWhatsAppMessage(input.targetGroupId, message);
    if (!result.success) {
      const deliveryError = result.error || 'No se pudo enviar la entrega médica por WhatsApp.';
      return createApplicationFailed(
        null,
        [
          {
            kind: 'unknown',
            message: deliveryError,
            userSafeMessage: deliveryError,
            retryable: true,
            severity: 'error',
            technicalContext: { targetGroupId: input.targetGroupId, scope },
            telemetryTags: ['handoff', 'send_medical_handoff', 'whatsapp_delivery_failed'],
          },
        ],
        {
          reason: 'whatsapp_delivery_failed',
          userSafeMessage: deliveryError,
          retryable: true,
          severity: 'error',
          technicalContext: { targetGroupId: input.targetGroupId, scope },
          telemetryTags: ['handoff', 'send_medical_handoff', 'whatsapp_delivery_failed'],
        }
      );
    }

    const sentOutcome = await executeMarkMedicalHandoffAsSent({
      record: linkOutcome.data?.nextRecord || input.record,
      doctorName,
      patchRecord: input.patchRecord,
      scope,
    });
    if (sentOutcome.status === 'failed' || !sentOutcome.data) {
      return createApplicationFailed(null, sentOutcome.issues, {
        reason: sentOutcome.reason,
        userSafeMessage: sentOutcome.userSafeMessage,
        retryable: sentOutcome.retryable,
        severity: sentOutcome.severity,
        technicalContext: sentOutcome.technicalContext,
        telemetryTags: sentOutcome.telemetryTags,
      });
    }

    return createApplicationSuccess({
      sentAt: sentOutcome.data.sentAt || sentAt,
      doctorName,
      handoffUrl,
      nextRecord: sentOutcome.data.nextRecord,
    });
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo enviar la entrega médica.',
      },
    ]);
  }
};
