import React from 'react';
import { RefreshCw } from 'lucide-react';
import { RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS } from '../bridge/extensionHealthBridge';
import { useRayenExtensionHealth } from '../hooks/useRayenExtensionHealth';

interface RayenDayBootstrapButtonProps {
  historical?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onCreateBlank?: () => Promise<boolean>;
  onReady: () => void;
  copySourceDate?: string;
  onCopyPrevious?: () => Promise<boolean>;
}

export const RayenDayBootstrapButton: React.FC<RayenDayBootstrapButtonProps> = ({
  historical = false,
  disabled = false,
  disabledReason,
  onCreateBlank,
  onReady,
  copySourceDate,
  onCopyPrevious,
}) => {
  const extension = useRayenExtensionHealth();
  const connectionDetailId = React.useId();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [manualAvailable, setManualAvailable] = React.useState(false);
  const [confirmManual, setConfirmManual] = React.useState(false);
  const [step, setStep] = React.useState<'checking' | 'creating' | 'copying' | 'manual' | null>(
    null
  );

  const handleClick = async (): Promise<void> => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    setManualAvailable(false);
    setConfirmManual(false);
    if (copySourceDate && onCopyPrevious) {
      setStep('copying');
      try {
        const copied = await onCopyPrevious();
        if (!copied) {
          setError('No se pudo copiar el censo anterior. Inténtalo de nuevo.');
          return;
        }
        // The request waits in the sync button until both sources answer, so a slow or sleeping
        // Eloísa tab delays the sync instead of dropping it. The first import is still reviewed.
        onReady();
      } catch {
        setError('No se pudo copiar el censo anterior. Inténtalo de nuevo.');
      } finally {
        setBusy(false);
        setStep(null);
      }
      return;
    }
    if (!onCreateBlank) {
      setBusy(false);
      return;
    }
    setStep('checking');
    try {
      let health;
      try {
        health = await extension.refresh({
          timeoutMs: RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
          showChecking: true,
        });
      } catch {
        setError('No se pudo comprobar la conexión con Eloísa. Inténtalo de nuevo.');
        setManualAvailable(!historical);
        return;
      }
      if (!health.canSync) {
        setError(health.message);
        setManualAvailable(!historical);
        return;
      }
      setStep('creating');
      const created = await onCreateBlank();
      if (!created) {
        setError('No se pudo crear el día. No se importó información desde Eloísa.');
        return;
      }
      onReady();
    } catch {
      setError('No se pudo crear el día. No se importó información desde Eloísa.');
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const handleManualStart = async (): Promise<void> => {
    if (busy || disabled || !onCreateBlank) return;
    setBusy(true);
    setError(null);
    setStep('manual');
    try {
      const created = await onCreateBlank();
      if (!created) {
        setError('No se pudo iniciar el censo. Inténtalo de nuevo.');
        return;
      }
      setConfirmManual(false);
    } catch {
      setError('No se pudo iniciar el censo. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const checking = extension.connection === 'checking';
  const status =
    step === 'copying'
      ? 'Copiando pacientes'
      : step === 'creating'
        ? 'Preparando sincronización'
        : step === 'manual'
          ? 'Iniciando censo manual'
          : step === 'checking' || checking
            ? 'Comprobando conexión'
            : !error && extension.canSync
              ? 'Lista para sincronizar'
              : 'Extensión requiere atención';
  const statusTone =
    step || checking
      ? 'bg-blue-500'
      : !error && extension.canSync
        ? 'bg-emerald-500'
        : 'bg-amber-500';
  const connectionLabel = checking
    ? 'Comprobando conexiones…'
    : extension.canSync
      ? 'Listo para sincronizar'
      : extension.connection === 'offline'
        ? 'Sin conexión'
        : 'Conexión incompleta';
  const connectionTone = checking
    ? 'bg-amber-500'
    : extension.canSync
      ? 'bg-emerald-500'
      : extension.connection === 'offline'
        ? 'bg-slate-400'
        : 'bg-amber-500';
  const connectionDetail = extension.canSync
    ? 'Extensión, Ficha Médico y Gestión de Camas disponibles, con sesiones vigentes.'
    : extension.message;
  const sourceDateLabel = copySourceDate
    ? new Intl.DateTimeFormat('es-CL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${copySourceDate}T12:00:00Z`))
    : '';
  const actionLabel = copySourceDate
    ? 'Copiar censo y sincronizar'
    : historical
      ? 'Reconstruir desde Eloísa'
      : 'Crear desde Eloísa';
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3">
      {copySourceDate && (
        <p className="text-sm text-slate-500">
          Copiar censo del{' '}
          <time dateTime={copySourceDate} className="font-semibold text-slate-700">
            {sourceDateLabel}
          </time>
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled || busy || (checking && !copySourceDate)}
        className="btn btn-primary group w-full !h-auto !p-4 shadow-md shadow-medical-500/15 flex-col disabled:!bg-slate-200 disabled:!text-slate-400 disabled:!shadow-none disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="create-from-rayen-btn"
      >
        <div className="flex items-center gap-2 text-base font-semibold">
          {!copySourceDate && (
            <RefreshCw
              size={20}
              className={busy ? 'animate-spin motion-reduce:animate-none' : undefined}
            />
          )}
          <span>
            {busy
              ? step === 'copying'
                ? 'Copiando censo…'
                : 'Preparando sincronización…'
              : actionLabel}
          </span>
        </div>
        {!copySourceDate && (
          <span className="text-xs font-normal text-medical-100">
            {historical
              ? 'Revisar evidencia del día antes de importar'
              : 'Revisar pacientes y camas antes de importar'}
          </span>
        )}
      </button>
      {disabledReason && <p className="text-xs text-slate-500">{disabledReason}</p>}
      {copySourceDate ? (
        <div className="group relative text-xs text-slate-500">
          <div
            tabIndex={0}
            aria-label="Estado conjunto de conexiones"
            aria-describedby={connectionDetailId}
            title={connectionDetail}
            className="flex items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-500"
            data-testid="eloisa-bootstrap-status"
            role="status"
            aria-live="polite"
          >
            <span className={`h-2 w-2 rounded-full ${connectionTone}`} aria-hidden="true" />
            <span>{connectionLabel}</span>
          </div>
          <p
            id={connectionDetailId}
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-md group-hover:block group-focus-within:block"
          >
            {connectionDetail}
          </p>
        </div>
      ) : (
        <div
          className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs"
          role="status"
          aria-live="polite"
          data-testid="eloisa-bootstrap-status"
        >
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${statusTone}`} aria-hidden="true" />
          <div>
            <strong className="text-slate-700">{status}</strong>
            <p className="text-slate-500">
              {error ??
                (extension.canSync
                  ? 'Ficha Médico y Gestión de Camas conectados.'
                  : extension.message)}
            </p>
          </div>
        </div>
      )}
      {copySourceDate && error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {manualAvailable && !confirmManual && (
        <button
          type="button"
          onClick={() => setConfirmManual(true)}
          className="text-xs font-semibold text-medical-700 underline underline-offset-2"
        >
          Iniciar censo sin Eloísa
        </button>
      )}
      {manualAvailable && confirmManual && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p>Se iniciará un censo vacío. Los pacientes deberán ingresarse manualmente.</p>
          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmManual(false)}
              disabled={busy}
              className="font-semibold"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleManualStart()}
              disabled={busy}
              className="font-semibold underline underline-offset-2"
            >
              Confirmar censo vacío
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
