import { useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  ApplyDailyRecordPatch,
  DailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import {
  buildSpecialistHistoricalEditFailure,
  executeEnsureMedicalHandoffSignatureLink,
  executeMarkMedicalHandoffAsSent,
  executeSendMedicalHandoff,
  resolveSpecialistHistoricalEditNotice,
} from '@/application/handoff';
import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { presentHandoffManagementFailure } from '@/hooks/controllers/handoffManagementOutcomeController';
import { canEditMedicalHandoffForDate } from '@/shared/access/operationalAccessPolicy';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';

interface HandoffManagementDeliveryInput {
  recordRef: RefObject<DailyRecord | null>;
  recordDate: string | undefined;
  role?: string;
  patchRecord: ApplyDailyRecordPatch;
  success: (title: string, message: string) => void;
  notifyError: (title: string, message: string) => void;
}

export const useHandoffManagementDelivery = ({
  recordRef,
  recordDate,
  role,
  patchRecord,
  success,
  notifyError,
}: HandoffManagementDeliveryInput) => {
  const isCurrentRecord = useCallback(
    () => recordRef.current?.date === recordDate,
    [recordDate, recordRef]
  );
  const presentSpecialistHistoricalEditError = useCallback(() => {
    const notice = resolveSpecialistHistoricalEditNotice();
    notifyError(notice.title, notice.message);
  }, [notifyError]);

  const canMutateCurrentMedicalRecord = useCallback(
    () =>
      canEditMedicalHandoffForDate({
        role,
        readOnly: false,
        recordDate: recordRef.current?.date,
      }),
    [recordRef, role]
  );

  const markMedicalHandoffAsSent = useCallback(
    async (doctorName?: string, scope: MedicalHandoffScope = 'all') => {
      if (!isCurrentRecord()) return;
      if (!canMutateCurrentMedicalRecord()) {
        presentSpecialistHistoricalEditError();
        return;
      }

      const currentRecord = recordRef.current;
      const outcome = await executeMarkMedicalHandoffAsSent({
        doctorName,
        patchRecord,
        record: currentRecord,
        scope,
      });
      if (!isCurrentRecord() || outcome.status === 'failed' || !outcome.data) {
        return;
      }
      recordRef.current = outcome.data.nextRecord;
    },
    [
      canMutateCurrentMedicalRecord,
      isCurrentRecord,
      patchRecord,
      presentSpecialistHistoricalEditError,
      recordRef,
    ]
  );

  const ensureMedicalHandoffSignatureLink = useCallback(
    async (
      scope: MedicalHandoffScope = 'all'
    ): Promise<ApplicationOutcome<{ handoffUrl: string } | null>> => {
      if (!isCurrentRecord())
        return createApplicationFailed(null, [], { reason: 'record_changed' });
      if (!canMutateCurrentMedicalRecord()) {
        return buildSpecialistHistoricalEditFailure(null);
      }

      const outcome = await executeEnsureMedicalHandoffSignatureLink({
        patchRecord,
        record: recordRef.current,
        scope,
      });
      if (!isCurrentRecord())
        return createApplicationFailed(null, [], { reason: 'record_changed' });
      if (outcome.status === 'failed' || !outcome.data) {
        return createApplicationFailed(null, outcome.issues, {
          userSafeMessage: resolveApplicationOutcomeMessage(
            outcome,
            'No se pudo copiar el enlace de firma médica.'
          ),
        });
      }

      recordRef.current = outcome.data.nextRecord;
      return createApplicationSuccess({ handoffUrl: outcome.data.handoffUrl });
    },
    [canMutateCurrentMedicalRecord, isCurrentRecord, patchRecord, recordRef]
  );

  const sendMedicalHandoff = useCallback(
    async (templateContent: string, targetGroupId: string) => {
      if (!isCurrentRecord()) return;
      if (!canMutateCurrentMedicalRecord()) {
        presentSpecialistHistoricalEditError();
        return;
      }

      const currentRecord = recordRef.current;
      if (!currentRecord) {
        recordOperationalTelemetry({
          category: 'handoff',
          status: 'failed',
          operation: 'send_medical_handoff',
          issues: ['No hay entrega médica disponible para enviar.'],
          context: { targetGroupId, scope: 'all' },
        });
        notifyError('Error al enviar', 'No hay entrega médica disponible para enviar.');
        return;
      }

      const outcome = await executeSendMedicalHandoff({
        record: currentRecord,
        templateContent,
        targetGroupId,
        patchRecord,
        getPreviousDay: defaultDailyRecordReadPort.getPreviousDay,
        scope: 'all',
      });
      if (!isCurrentRecord()) return;
      recordOperationalOutcome('handoff', 'send_medical_handoff', outcome, {
        date: currentRecord.date,
        context: { targetGroupId, scope: 'all' },
      });

      if (outcome.status === 'failed' || !outcome.data) {
        const notice = presentHandoffManagementFailure(outcome, {
          fallbackMessage: 'No se pudo enviar la entrega médica.',
          fallbackTitle: 'Error al enviar',
        });
        notifyError(notice.title, notice.message);
        return;
      }
      recordRef.current = outcome.data.nextRecord;
      success('WhatsApp Enviado', 'Entrega médica enviada correctamente.');
    },
    [
      canMutateCurrentMedicalRecord,
      isCurrentRecord,
      notifyError,
      patchRecord,
      presentSpecialistHistoricalEditError,
      recordRef,
      success,
    ]
  );

  return {
    markMedicalHandoffAsSent,
    ensureMedicalHandoffSignatureLink,
    sendMedicalHandoff,
  };
};
