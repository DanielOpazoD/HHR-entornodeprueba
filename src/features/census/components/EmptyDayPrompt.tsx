import React, { useEffect, useState } from 'react';
import {
  shouldRecordCensusEmptyStateDiagnostic,
  type CensusEmptyStateDiagnostic,
} from '@/hooks/controllers/dailyRecordBootstrapController';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';
import { RayenDayBootstrapButton, resolveCensusSyncTarget } from '@/features/rayen-import/public';
import { CensusEmptyMoa } from './CensusEmptyMoa';
import {
  resolveCreateDayCopyAvailability,
  buildCopyUnlockDescription,
} from '@/hooks/controllers/createDayCopyAvailabilityController';
import { getPreviousDay } from '@/utils/clinicalDayUtils';

interface EmptyDayPromptProps {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  previousRecordAvailable: boolean;
  previousRecordDate?: string;
  availableDates?: string[];
  onCreateDay: (
    copyFromPrevious: boolean,
    specificDate?: string,
    options?: { forceCopyScheduleOverride?: boolean }
  ) => Promise<boolean>;
  onRayenBootstrapReady?: () => void;
  readOnly?: boolean;
  allowAdminCopyOverride?: boolean;
  emptyStateDiagnostic?: CensusEmptyStateDiagnostic;
}

const emptyDayMessage = (source?: CensusEmptyStateDiagnostic['source']): string => {
  switch (source) {
    case 'sync_pending':
    case 'post_deploy_refresh':
      return 'Comprobando si ya existe un censo para esta fecha…';
    case 'local_cache_empty':
      return 'No se pudo comprobar el censo. Revisa tu conexión e inténtalo de nuevo.';
    case 'date_mismatch':
      return 'No hay censo para esta fecha. Comprueba el día seleccionado.';
    default:
      return 'No hay censo para esta fecha.';
  }
};

export const EmptyDayPrompt: React.FC<EmptyDayPromptProps> = ({
  currentDateString,
  previousRecordAvailable,
  previousRecordDate,
  onCreateDay,
  onRayenBootstrapReady,
  readOnly = false,
  emptyStateDiagnostic,
}) => {
  // Calendar midnight and the morning clinical handoff can both change eligibility.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const interval = window.setInterval(refresh, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  const diagnosticSource = emptyStateDiagnostic?.source;
  const diagnosticMessage = emptyStateDiagnostic?.message;

  useEffect(() => {
    if (
      !diagnosticSource ||
      !diagnosticMessage ||
      !shouldRecordCensusEmptyStateDiagnostic({
        branch: 'empty',
        source: diagnosticSource,
        isVisible: true,
      })
    )
      return;
    dailyRecordObservability.recordEvent('census_empty_state_visible', 'degraded', {
      date: currentDateString,
      runtimeState: 'retryable',
      issues: [diagnosticMessage],
      context: { source: diagnosticSource },
    });
  }, [currentDateString, diagnosticMessage, diagnosticSource]);

  const rayenTarget = resolveCensusSyncTarget(currentDateString, now);
  const copySourceDate =
    previousRecordAvailable && previousRecordDate === getPreviousDay(currentDateString)
      ? previousRecordDate
      : undefined;
  // date_mismatch is emitted only for a different selected date after confirmed_empty.
  const dayConfirmedEmpty =
    diagnosticSource === 'remote_missing' || diagnosticSource === 'date_mismatch';
  const canCreate = dayConfirmedEmpty && Boolean(onRayenBootstrapReady);
  const creationLocked =
    resolveCreateDayCopyAvailability(currentDateString, now).isCopyLocked ||
    rayenTarget.kind === 'unsupported';

  return (
    <div className="mt-6 flex flex-col items-center justify-center px-5 py-4 text-center print:hidden">
      <CensusEmptyMoa />
      {!canCreate && !readOnly && (
        <p
          className="mb-6 max-w-md text-sm text-slate-500"
          role="status"
          data-testid="empty-day-diagnostic-message"
        >
          {emptyDayMessage(diagnosticSource)}
        </p>
      )}
      {readOnly ? (
        <p className="max-w-sm text-sm text-amber-800">Pide a enfermería que inicie el censo.</p>
      ) : canCreate ? (
        <RayenDayBootstrapButton
          disabled={creationLocked}
          disabledReason={
            creationLocked ? buildCopyUnlockDescription(currentDateString, now) : undefined
          }
          historical={rayenTarget.kind === 'historical'}
          copySourceDate={copySourceDate}
          onCopyPrevious={() => onCreateDay(true, copySourceDate)}
          onCreateBlank={() => onCreateDay(false)}
          onReady={() => onRayenBootstrapReady?.()}
        />
      ) : rayenTarget.kind === 'unsupported' && dayConfirmedEmpty ? (
        <p className="max-w-md text-sm text-slate-600">
          Selecciona una fecha válida, actual o pasada, para consultar Eloísa.
        </p>
      ) : null}
    </div>
  );
};
