import type { Dispatch, SetStateAction } from 'react';

import { applyTransferPatch } from '@/features/census/controllers/censusModalStateController';
import { buildTransferRuntimeActions } from '@/features/census/controllers/censusActionRuntimeAdapterController';
import { executeTransferController } from '@/features/census/controllers/censusActionRuntimeController';
import {
  buildTransferErrorNotification,
  type CensusActionNotification,
} from '@/features/census/controllers/censusActionNotificationController';
import type { CensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useCensusModalCommand } from '@/features/census/hooks/useCensusModalCommand';
import type { TransferExecutionInput } from '@/features/census/domain/movements/contracts';
import type { TransferState } from '@/features/census/types/censusActionTypes';
import { useAuth } from '@/context/AuthContext';
import {
  completeTransferWithResult,
  createFinalizedTransferRequestWithResult,
  getLatestOpenTransferRequestByBedId,
} from '@/services/transfers/transferService';
import {
  resolveTransferDestinationHospital,
  syncCensusTransferRequest,
} from '@/features/census/controllers/censusTransferSyncController';
import { dispatchCanonicalTransfer } from '@/features/census/controllers/transferCanonicalAdoptionController';
import { recordCriticalClinicalAction } from '@/services/observability/criticalClinicalActionRecorder';
import { createScopedLogger } from '@/services/utils/loggerScope';
import { isFeatureEnabled } from '@/services/utils/featureFlags';
import { resolveAuditActor } from '@/context/AuditContext';

const censusTransferCommandLogger = createScopedLogger('CensusTransferCommand');

interface UseCensusTransferCommandParams extends Pick<
  CensusActionRuntimeRefs,
  'transferStateRef' | 'stabilityRulesRef' | 'addTransferRef' | 'updateTransferRef' | 'recordRef'
> {
  setTransferState: Dispatch<SetStateAction<TransferState>>;
  getCurrentTime: () => string;
  notifyError: (notification: CensusActionNotification) => void;
}

export const useCensusTransferCommand = ({
  transferStateRef,
  stabilityRulesRef,
  addTransferRef,
  updateTransferRef,
  recordRef,
  setTransferState,
  getCurrentTime,
  notifyError,
}: UseCensusTransferCommandParams) => {
  const { currentUser } = useAuth();
  const createdByEmail = currentUser?.email ?? 'census-auto@local';

  return useCensusModalCommand<TransferExecutionInput>(async data => {
    const transferState = transferStateRef.current;
    const record = recordRef.current;
    const bedId = transferState.bedId;
    const patient = bedId ? record?.beds?.[bedId] : undefined;
    const destinationHospital = resolveTransferDestinationHospital(
      transferState.receivingCenter,
      transferState.receivingCenterOther
    );
    const recordTransferCriticalAction = (
      action: string,
      outcome: 'success' | 'failed',
      issues?: string[],
      context?: Record<string, unknown>
    ) => {
      recordCriticalClinicalAction({
        category: 'daily_record',
        action,
        outcome,
        clinicalDate: record?.date,
        bedId: bedId ?? undefined,
        patientRut: patient?.rut,
        userId: createdByEmail,
        issues,
        context,
      });
    };

    const runLegacyTransfer = (): boolean => {
      const result = executeTransferController({
        transferState,
        data,
        stabilityRules: stabilityRulesRef.current,
        nowTime: getCurrentTime(),
        actions: buildTransferRuntimeActions(addTransferRef.current, updateTransferRef.current),
      });

      if (!result.ok) {
        recordTransferCriticalAction('census_transfer_created', 'failed', [result.error.message], {
          errorCode: result.error.code,
        });
        notifyError(buildTransferErrorNotification(result.error.code, result.error.message));
        return false;
      }

      recordTransferCriticalAction('census_transfer_created', 'success', undefined, {
        destinationHospital,
        linkedTransferRequestId: transferState.recordId,
      });
      setTransferState(prev => applyTransferPatch(prev, result.value.closeModalPatch));
      return true;
    };

    let legacyOk = false;
    if (
      isFeatureEnabled('USE_TRANSFER_PATIENT_COMMAND') &&
      bedId &&
      patient &&
      destinationHospital &&
      record?.date
    ) {
      const actor = resolveAuditActor(currentUser);
      const canonicalOutcome = await dispatchCanonicalTransfer({
        actor,
        recordDate: record.date,
        entry: {
          bedId,
          patientName: patient.patientName ?? '',
          rut: patient.rut ?? '',
          destination: destinationHospital,
        },
        performLegacyPersist: () => {
          legacyOk = runLegacyTransfer();
          if (!legacyOk) {
            throw new Error('Transfer persistence rejected by legacy pipeline.');
          }
        },
      });

      if (
        canonicalOutcome.status.status !== 'ready' &&
        canonicalOutcome.status.status !== 'degraded' &&
        legacyOk
      ) {
        notifyError({
          title: 'Traslado auditoría',
          message:
            canonicalOutcome.applicationOutcome.userSafeMessage ||
            canonicalOutcome.applicationOutcome.issues[0]?.message ||
            'No se pudo registrar el evento canónico de auditoría.',
        });
      }
    } else {
      legacyOk = runLegacyTransfer();
    }

    if (!legacyOk) {
      return;
    }

    if (!transferState.recordId && bedId && patient && destinationHospital) {
      try {
        const linkedTransferRequest = await getLatestOpenTransferRequestByBedId(bedId, {
          referenceDate: record?.date,
        });
        await syncCensusTransferRequest({
          bedId,
          patient,
          recordDate: record?.date,
          data,
          destinationHospital,
          createdByEmail,
          getLatestOpenTransferRequestByBedId: async () => linkedTransferRequest,
          createFinalizedTransferRequestWithResult,
          completeTransferWithResult,
        });
        if (linkedTransferRequest?.id) {
          recordTransferCriticalAction(
            'census_transfer_linked_request_finalized',
            'success',
            undefined,
            { linkedTransferRequestId: linkedTransferRequest.id }
          );
        }
      } catch (syncError) {
        censusTransferCommandLogger.error(
          'Failed to sync census transfer with transfer management',
          syncError
        );
        recordTransferCriticalAction(
          'census_transfer_management_sync',
          'failed',
          [
            syncError instanceof Error
              ? syncError.message
              : 'No se pudo sincronizar Gestión de Traslados.',
          ],
          { destinationHospital }
        );
        notifyError({
          title: 'Traslado registrado con advertencia',
          message:
            'Se registró el traslado en Censo, pero no se pudo sincronizar automáticamente con Gestión de Traslados.',
        });
      }
    }
  });
};
