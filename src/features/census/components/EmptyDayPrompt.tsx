import React, { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { MONTH_NAMES } from '@/constants/export';
import {
  shouldRecordCensusEmptyStateDiagnostic,
  type CensusEmptyStateDiagnostic,
} from '@/hooks/controllers/dailyRecordBootstrapController';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';
import { RayenDayBootstrapButton, resolveCensusSyncTarget } from '@/features/rayen-import/public';

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
  ) => void | Promise<void>;
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
  selectedDay,
  selectedMonth,
  currentDateString,
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
  // date_mismatch is emitted only for a different selected date after confirmed_empty.
  const dayConfirmedEmpty =
    diagnosticSource === 'remote_missing' || diagnosticSource === 'date_mismatch';
  const canCreate =
    Boolean(onRayenBootstrapReady) && dayConfirmedEmpty && rayenTarget.kind !== 'unsupported';

  return (
    <div className="card mt-8 flex flex-col items-center justify-center px-5 py-14 text-center print:hidden animate-fade-in">
      <div className="mb-5 rounded-full bg-slate-50 p-5">
        <Calendar size={48} className="text-medical-200" aria-hidden="true" />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-slate-800">
        {selectedDay} de {MONTH_NAMES[selectedMonth]}
      </h2>
      <p
        className="mb-6 max-w-md text-sm text-slate-500"
        role="status"
        aria-live="polite"
        data-testid="empty-day-diagnostic-message"
      >
        {emptyDayMessage(diagnosticSource)}
      </p>
      {readOnly ? (
        <p className="max-w-sm text-sm text-amber-800">Pide a enfermería que inicie el censo.</p>
      ) : canCreate ? (
        <RayenDayBootstrapButton
          historical={rayenTarget.kind === 'historical'}
          onCreateBlank={() => Promise.resolve(onCreateDay(false))}
          onReady={() => onRayenBootstrapReady?.()}
        />
      ) : rayenTarget.kind === 'unsupported' && dayConfirmedEmpty ? (
        <p className="max-w-md text-sm text-slate-600">
          No se puede crear este día desde Eloísa. La reconstrucción está disponible hasta siete
          días atrás.
        </p>
      ) : null}
    </div>
  );
};
