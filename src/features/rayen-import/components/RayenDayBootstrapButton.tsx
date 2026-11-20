import React from 'react';
import { calendarDayAtUtcNoon } from '@/utils/clinicalDateUtils';
import { useRayenExtensionHealth } from '../hooks/useRayenExtensionHealth';
import { SYNC_TONE, SYNC_TONE_INFO_VARIANT } from './syncTone';

// Nothing is lost when the copy stops: the message says what did not happen yet and what to do.
const COPY_PENDING = 'El censo anterior todavía no se copió. Vuelve a intentarlo.';

interface RayenDayBootstrapButtonProps {
  disabled?: boolean;
  disabledReason?: string;
  copySourceDate: string;
  onCopyPrevious: () => Promise<boolean>;
  onReady: () => void;
}

/** The empty day offers one action: copy the previous census, then synchronize with Eloísa. */
export const RayenDayBootstrapButton: React.FC<RayenDayBootstrapButtonProps> = ({
  disabled = false,
  disabledReason,
  copySourceDate,
  onCopyPrevious,
  onReady,
}) => {
  const extension = useRayenExtensionHealth();
  const connectionDetailId = React.useId();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleClick = async (): Promise<void> => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const copied = await onCopyPrevious();
      if (!copied) {
        setError(COPY_PENDING);
        return;
      }
      // The request waits in the sync button until both sources answer, so a slow or sleeping
      // Eloísa tab delays the sync instead of dropping it. The first import is still reviewed.
      onReady();
    } catch {
      setError(COPY_PENDING);
    } finally {
      setBusy(false);
    }
  };

  const checking = extension.connection === 'checking';
  const connectionLabel = checking
    ? 'Comprobando conexiones…'
    : extension.canSync
      ? 'Listo para sincronizar'
      : extension.connection === 'offline'
        ? 'Sin conexión'
        : 'Conexión incompleta';
  const connectionTone = checking
    ? SYNC_TONE_INFO_VARIANT.progress.dot
    : extension.canSync
      ? SYNC_TONE_INFO_VARIANT.ok.dot
      : extension.connection === 'offline'
        ? 'bg-slate-400'
        : SYNC_TONE.review.dot;
  const connectionDetail = extension.canSync
    ? 'Extensión, Ficha Médico y Gestión de Camas disponibles, con sesiones vigentes.'
    : extension.message;
  const sourceDateLabel = new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(calendarDayAtUtcNoon(copySourceDate));
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3">
      <p className="text-sm text-slate-500">
        Copiar censo del{' '}
        <time dateTime={copySourceDate} className="font-semibold text-slate-700">
          {sourceDateLabel}
        </time>
      </p>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled || busy}
        className="btn btn-primary group w-full !h-auto !p-4 shadow-md shadow-medical-500/15 flex-col disabled:!bg-slate-200 disabled:!text-slate-400 disabled:!shadow-none disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="create-from-rayen-btn"
      >
        <div className="flex items-center gap-2 text-base font-semibold">
          <span>{busy ? 'Copiando censo…' : 'Copiar censo y sincronizar'}</span>
        </div>
      </button>
      {disabledReason && <p className="text-xs text-slate-500">{disabledReason}</p>}
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
      {error && (
        <p role="alert" className={`text-sm ${SYNC_TONE.review.text}`}>
          {error}
        </p>
      )}
    </div>
  );
};
