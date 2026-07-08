import React, { useEffect, useMemo, useState } from 'react';
import { MONTH_NAMES } from '@/constants/export';
import { Copy, Calendar, Plus, ChevronDown, ShieldCheck, Shield } from 'lucide-react';
import clsx from 'clsx';
import {
  buildCopyUnlockDescription,
  resolveCreateDayCopyAvailability,
} from '@/features/census/controllers/censusCreateDayAvailabilityController';
import {
  shouldRecordCensusEmptyStateDiagnostic,
  type CensusEmptyStateDiagnostic,
} from '@/hooks/controllers/dailyRecordBootstrapController';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';

interface EmptyDayPromptProps {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  previousRecordAvailable: boolean;
  previousRecordDate?: string; // YYYY-MM-DD format
  availableDates?: string[]; // All dates with records
  onCreateDay: (
    copyFromPrevious: boolean,
    specificDate?: string,
    options?: { forceCopyScheduleOverride?: boolean }
  ) => void;
  readOnly?: boolean;
  allowAdminCopyOverride?: boolean;
  emptyStateDiagnostic?: CensusEmptyStateDiagnostic;
}

export const EmptyDayPrompt: React.FC<EmptyDayPromptProps> = ({
  selectedDay,
  selectedMonth,
  currentDateString,
  previousRecordAvailable,
  previousRecordDate,
  availableDates = [],
  onCreateDay,
  readOnly = false,
  allowAdminCopyOverride = false,
  emptyStateDiagnostic,
}) => {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isConfirmingBlank, setIsConfirmingBlank] = useState(false);
  const [blankConfirmationText, setBlankConfirmationText] = useState('');
  const [now, setNow] = useState(() => new Date());
  const diagnosticSource = emptyStateDiagnostic?.source;
  const diagnosticMessage = emptyStateDiagnostic?.message;

  const copyAvailability = useMemo(
    () => resolveCreateDayCopyAvailability(currentDateString, now),
    [currentDateString, now]
  );

  useEffect(() => {
    if (!copyAvailability.isCopyLocked) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [copyAvailability.isCopyLocked]);

  useEffect(() => {
    if (
      !diagnosticSource ||
      !diagnosticMessage ||
      !shouldRecordCensusEmptyStateDiagnostic({
        branch: 'empty',
        source: diagnosticSource,
        isVisible: true,
      })
    ) {
      return;
    }

    dailyRecordObservability.recordEvent('census_empty_state_visible', 'degraded', {
      date: currentDateString,
      runtimeState: 'retryable',
      issues: [diagnosticMessage],
      context: {
        source: diagnosticSource,
      },
    });
  }, [currentDateString, diagnosticMessage, diagnosticSource]);

  const isDatePickerVisible = showDatePicker && !copyAvailability.isCopyLocked;
  const canForceCopyPrevious =
    allowAdminCopyOverride && previousRecordAvailable && !!previousRecordDate;
  const diagnosticLabelBySource: Record<CensusEmptyStateDiagnostic['source'], string> = {
    remote_missing: 'Firebase/local confirmado',
    local_cache_empty: 'Solo copia local',
    sync_pending: 'Sincronizacion pendiente',
    post_deploy_refresh: 'Actualizacion reciente',
    date_mismatch: 'Fecha seleccionada',
  };

  // Format date for display (DD de Mes)
  const formatDate = (dateStr: string) => {
    const [_year, month, day] = dateStr.split('-');
    const monthName = MONTH_NAMES[parseInt(month, 10) - 1];
    return `${parseInt(day, 10)} de ${monthName} `;
  };

  const handleSelectDate = (date: string) => {
    setShowDatePicker(false);
    onCreateDay(true, date);
  };

  const unlockDescription = buildCopyUnlockDescription(currentDateString, now);

  return (
    <div className="card flex flex-col items-center justify-center py-16 mt-8 print:hidden animate-fade-in overflow-visible">
      <div className="bg-slate-50 p-6 rounded-full mb-6">
        <Calendar size={64} className="text-medical-200" />
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">
        {selectedDay} de {MONTH_NAMES[selectedMonth]}
      </h2>
      <div className="mb-8 max-w-md text-center">
        <p
          aria-live="polite"
          className="text-slate-500"
          data-testid="empty-day-diagnostic-message"
          role="status"
        >
          {emptyStateDiagnostic?.message || 'No existe registro para esta fecha.'}
        </p>
        {emptyStateDiagnostic && (
          <span
            className="mt-3 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
            data-testid="empty-day-diagnostic-source"
            data-source={emptyStateDiagnostic.source}
          >
            {diagnosticLabelBySource[emptyStateDiagnostic.source]}
          </span>
        )}
      </div>

      {!readOnly ? (
        <div className="flex flex-col sm:flex-row gap-4 flex-wrap justify-center items-start">
          {/* Copy from Previous Day Button with subtle date picker */}
          {previousRecordAvailable && previousRecordDate && (
            <div className="flex flex-col gap-2">
              <div className="relative flex items-stretch">
                {/* Main Copy Button */}
                <button
                  onClick={() => onCreateDay(true, previousRecordDate)}
                  disabled={copyAvailability.isCopyLocked}
                  className={clsx(
                    'btn group !p-6 !h-auto border-2 border-slate-300 text-medical-700 bg-white shadow-sm flex-col rounded-r-none border-r-0',
                    copyAvailability.isCopyLocked
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:bg-medical-50'
                  )}
                  style={{ width: '230px' }}
                  data-testid="copy-previous-btn"
                >
                  <div className="flex items-center gap-2 text-lg font-bold">
                    <Copy size={20} />
                    <span>Copiar del {formatDate(previousRecordDate)}</span>
                  </div>
                  {copyAvailability.isCopyLocked ? (
                    <span className="text-xs text-center font-semibold text-amber-700 leading-snug">
                      {unlockDescription}
                      <span className="block text-[11px] font-normal text-amber-600">
                        Se habilita en {copyAvailability.countdownLabel}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs font-normal text-medical-600/80">
                      Incluye pacientes, camas y entregas de turno
                    </span>
                  )}
                </button>

                {/* Subtle "+" expander for other dates */}
                {availableDates.length > 1 && (
                  <>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (copyAvailability.isCopyLocked) {
                          return;
                        }
                        setShowDatePicker(!showDatePicker);
                      }}
                      disabled={copyAvailability.isCopyLocked}
                      className={clsx(
                        'border-2 border-slate-300 text-slate-400 bg-white shadow-sm rounded-l-none px-2 transition-colors',
                        copyAvailability.isCopyLocked
                          ? 'cursor-not-allowed opacity-60'
                          : 'hover:bg-slate-50 hover:text-slate-600',
                        isDatePickerVisible && 'bg-medical-50 text-medical-600'
                      )}
                      title="Seleccionar otra fecha"
                      aria-label="Seleccionar otra fecha para copiar"
                    >
                      <ChevronDown
                        size={16}
                        className={clsx(
                          'transition-transform',
                          isDatePickerVisible && 'rotate-180'
                        )}
                      />
                    </button>

                    {/* Date Picker Dropdown - Opens Upward */}
                    {isDatePickerVisible && (
                      <div className="absolute bottom-full right-0 mb-2 w-56 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50 animate-fade-in">
                        <div className="p-2">
                          <p className="text-[10px] text-slate-400 uppercase font-bold px-2 py-1">
                            Otras fechas
                          </p>
                          {availableDates
                            .filter(d => d !== previousRecordDate)
                            .map(date => (
                              <button
                                key={date}
                                onClick={() => handleSelectDate(date)}
                                className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-medical-50 hover:text-medical-700"
                              >
                                {formatDate(date)}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {canForceCopyPrevious && copyAvailability.isCopyLocked && (
                <button
                  onClick={() =>
                    onCreateDay(true, previousRecordDate, { forceCopyScheduleOverride: true })
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800 shadow-sm transition-colors hover:bg-amber-100"
                  data-testid="admin-copy-override-btn"
                >
                  <Shield size={14} />
                  <span>Crear ahora como admin</span>
                </button>
              )}
            </div>
          )}

          {/* Blank Record Button */}
          <button
            onClick={() => setIsConfirmingBlank(true)}
            className="btn btn-primary group !p-6 !h-auto shadow-lg shadow-medical-500/30 flex-col w-64"
            data-testid="blank-record-btn"
          >
            <div className="flex items-center gap-2 text-lg font-bold">
              <Plus size={20} />
              <span>Registro en Blanco</span>
            </div>
            <span className="text-xs font-normal text-medical-100">Iniciar turno desde cero</span>
          </button>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl text-amber-800 flex flex-col items-center gap-2 max-w-sm text-center">
          <ShieldCheck size={32} className="text-amber-500 mb-2" />
          <p className="font-bold">Acceso de Invitado</p>
          <p className="text-sm">
            No tienes permisos para iniciar nuevos registros. Por favor, contacta a una enfermera o
            administrador.
          </p>
        </div>
      )}

      {/* Confirmation Modal for Blank Record */}
      {isConfirmingBlank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-scale-up">
            <div className="flex items-center gap-3 mb-4 text-amber-600">
              <ShieldCheck size={28} />
              <h3 className="text-xl font-bold">¿Registro en Blanco?</h3>
            </div>
            <p className="text-slate-600 mb-4">
              ¿Realmente quieres iniciar un registro nuevo{' '}
              <strong>sin copiar los datos previos</strong>? Se perderán las camas, pacientes y
              diagnósticos anteriores para el inicio de este día.
            </p>
            <p className="text-slate-600 mb-2 text-sm">
              Si estás seguro, por favor escribe <strong>Registroenblanco</strong> para continuar:
            </p>
            <input
              type="text"
              value={blankConfirmationText}
              onChange={e => setBlankConfirmationText(e.target.value)}
              className="input w-full mb-6 font-mono text-center"
              placeholder="Registroenblanco"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setIsConfirmingBlank(false);
                  setBlankConfirmationText('');
                }}
                className="btn btn-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setIsConfirmingBlank(false);
                  setBlankConfirmationText('');
                  onCreateDay(false);
                }}
                disabled={blankConfirmationText !== 'Registroenblanco'}
                className="btn btn-primary bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
