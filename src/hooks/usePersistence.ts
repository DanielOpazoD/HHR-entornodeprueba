import { useCallback } from 'react';
import { useNotification } from '@/context/UIContext';
import { useRepositories } from '@/services/RepositoryContext';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { getUserFriendlyErrorMessage } from '@/services/utils/errorService';
import { hasCriticalLegacyRepairSignal } from '@/hooks/controllers/legacyRepairWarningController';
import {
  buildCreateDayNotifications,
  resolveCreateDayFailureNotice,
} from '@/hooks/controllers/persistenceFeedbackController';
import { executeInitializeDailyRecord } from '@/application/daily-record/initializeDailyRecordUseCase';
import { useAuditContext } from '@/context/AuditContext';
import {
  buildCopyUnlockDescription,
  resolveCreateDayCopyAvailability,
} from '@/hooks/controllers/createDayCopyAvailabilityController';
import {
  defaultDailyRecordReadPort,
  defaultDailyRecordWritePort,
} from '@/application/ports/dailyRecordPort';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { getPreviousDay as getPreviousCalendarDay } from '@/utils/clinicalDayUtils';
import { defaultDailyRecordSyncPort } from '@/application/ports/dailyRecordPort';
import { executeDeleteDailyRecord } from '@/application/daily-record/commands/deleteDailyRecordCommand';
import { getCurrentUserEmail } from '@/services/admin/utils/auditUtils';

interface UsePersistenceProps {
  currentDateString: string;
  markLocalChange: () => void;
  setRecord: (record: DailyRecord | null) => void;
}

/**
 * Hook to manage day lifecycle and persistence operations.
 * Extracts "Create", "Delete", and "Demo" logic from useDailyRecord.
 */
export const usePersistence = ({
  currentDateString,
  markLocalChange,
  setRecord,
}: UsePersistenceProps) => {
  const { success, warning, error: notifyError } = useNotification();
  const { dailyRecord } = useRepositories();
  const { logDailyRecordCreated } = useAuditContext();

  /**
   * Creates a new daily record for the current date.
   */
  const createDay = useCallback(
    async (
      copyFromPrevious: boolean,
      specificDate?: string,
      options?: { forceCopyScheduleOverride?: boolean }
    ) => {
      let prevDate: string | undefined = undefined;
      let copySourceMeta: {
        compatibilityIntensity: string;
        migrationRulesApplied: string[];
      } | null = null;

      try {
        if (copyFromPrevious) {
          const copyAvailability = resolveCreateDayCopyAvailability(currentDateString, new Date());
          if (copyAvailability.isCopyLocked && !options?.forceCopyScheduleOverride) {
            recordOperationalTelemetry({
              category: 'create_day',
              status: 'degraded',
              operation: 'copy_day_locked_by_schedule',
              date: currentDateString,
              issues: ['La copia del día previo aún no está habilitada por horario.'],
              context: { targetDate: currentDateString },
            });
            warning(
              'Copia con observaciones',
              `La copia del día previo aún no está disponible. ${buildCopyUnlockDescription(currentDateString, new Date())}`
            );
            return;
          }
        }

        if (copyFromPrevious) {
          const defaultPreviousDate = getPreviousCalendarDay(currentDateString);
          const requestedSourceDate = specificDate || defaultPreviousDate;

          if (requestedSourceDate) {
            await defaultDailyRecordSyncPort.syncWithFirestoreDetailed(requestedSourceDate);
          }

          if (specificDate) {
            const source = await defaultDailyRecordReadPort.getForDateWithMeta(
              requestedSourceDate,
              true
            );
            if (!source.record) {
              warning(
                'No se encontró registro anterior',
                'No hay datos del día seleccionado para copiar.'
              );
              return;
            }
            prevDate = requestedSourceDate;
            copySourceMeta = source;
          } else {
            const prevRecord = await defaultDailyRecordReadPort.getForDateWithMeta(
              requestedSourceDate,
              true
            );
            if (!prevRecord.record) {
              warning(
                'No se encontró registro anterior',
                'No hay datos sincronizados del día previo para copiar.'
              );
              return;
            }
            prevDate = requestedSourceDate;
            copySourceMeta = prevRecord;
          }
        }

        const initOutcome = await executeInitializeDailyRecord({
          date: currentDateString,
          copyFromDate: prevDate,
          repository: dailyRecord,
        });
        recordOperationalOutcome('create_day', 'initialize_daily_record', initOutcome, {
          date: currentDateString,
          context: { copyFromPrevious, sourceDate: prevDate || null },
          allowSuccess: true,
        });
        const initResult = initOutcome.data?.initialization;
        const newRecord = initOutcome.data?.record;
        if (!initResult || !newRecord) {
          const failureNotice = resolveCreateDayFailureNotice(initOutcome.issues);
          recordOperationalTelemetry({
            category: 'create_day',
            status: 'failed',
            operation: 'initialize_daily_record',
            date: currentDateString,
            issues: [failureNotice.message || failureNotice.title],
            context: { copyFromPrevious, sourceDate: prevDate || null, reason: initOutcome.reason },
          });
          notifyError(failureNotice.title, failureNotice.message);
          return;
        }
        markLocalChange();
        setRecord(newRecord);

        const notifications = buildCreateDayNotifications({
          sourceDate: prevDate,
          outcome: initResult.outcome,
          hasCriticalLegacyRepair:
            hasCriticalLegacyRepairSignal(copySourceMeta) ||
            hasCriticalLegacyRepairSignal(initResult),
        });
        for (const notification of notifications) {
          if (notification.channel === 'success') {
            success(notification.title, notification.message);
          } else {
            warning(notification.title, notification.message);
          }
        }

        logDailyRecordCreated(
          currentDateString,
          copyFromPrevious ? specificDate || 'previous_day' : 'blank'
        );
      } catch (error) {
        recordOperationalTelemetry({
          category: 'create_day',
          status: 'failed',
          operation: 'initialize_daily_record',
          date: currentDateString,
          issues: [getUserFriendlyErrorMessage(error)],
          context: { copyFromPrevious, sourceDate: prevDate || null },
        });
        notifyError('No se pudo crear el día', getUserFriendlyErrorMessage(error));
      }
    },
    [
      currentDateString,
      warning,
      success,
      notifyError,
      markLocalChange,
      setRecord,
      dailyRecord,
      logDailyRecordCreated,
    ]
  );

  /**
   * Deletes the current day's record.
   */
  const resetDay = useCallback(async () => {
    // Fail closed: audit-first via the delete use-case. If the audit cannot be written, the record is
    // NOT deleted — a daily record is never removed without a guaranteed audit trail (Ley 20.584).
    const outcome = await executeDeleteDailyRecord({
      date: currentDateString,
      deletedBy: getCurrentUserEmail(),
      deleteRecord: date => defaultDailyRecordWritePort.delete(date),
    });
    if (outcome.status === 'failed') {
      // The outcome is 'failed' for both an audit-write failure (abort) and a delete failure, so the
      // message stays generic rather than attributing every case to auditing.
      notifyError('No se pudo eliminar', 'No se eliminó el registro del día.');
      return;
    }
    recordOperationalTelemetry(
      {
        category: 'create_day',
        status: 'success',
        operation: 'delete_daily_record',
        date: currentDateString,
      },
      { allowSuccess: true }
    );
    setRecord(null);
    success('Registro eliminado', 'El registro del día ha sido eliminado.');
  }, [currentDateString, setRecord, success, notifyError]);

  return {
    createDay,
    resetDay,
  };
};
