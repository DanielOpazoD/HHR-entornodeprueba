import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useNotification } from '@/context/UIContext';
import { RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS } from '../bridge/extensionHealthBridge';
import { useRayenExtensionHealth } from '../hooks/useRayenExtensionHealth';

interface RayenDayBootstrapButtonProps {
  historical?: boolean;
  onCreateBlank: () => Promise<boolean>;
  onReady: () => void;
  copySourceDate?: string;
  onCopyPrevious?: () => Promise<boolean>;
}

export const RayenDayBootstrapButton: React.FC<RayenDayBootstrapButtonProps> = ({
  historical = false,
  onCreateBlank,
  onReady,
  copySourceDate,
  onCopyPrevious,
}) => {
  const extension = useRayenExtensionHealth();
  const { warning } = useNotification();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [manualAvailable, setManualAvailable] = React.useState(false);
  const [confirmManual, setConfirmManual] = React.useState(false);
  const [step, setStep] = React.useState<'checking' | 'creating' | 'copying' | 'manual' | null>(
    null
  );

  const handleClick = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setManualAvailable(false);
    setConfirmManual(false);
    if (copySourceDate && onCopyPrevious) {
      setStep('checking');
      let canSync = false;
      try {
        const health = await extension.refresh({
          timeoutMs: RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
          showChecking: true,
        });
        canSync = health.canSync;
      } catch {
        // The census may still be copied; an unavailable extension only delays import.
      }
      setStep('copying');
      try {
        const copied = await onCopyPrevious();
        if (!copied) {
          setError('No se pudo copiar el censo anterior. Inténtalo de nuevo.');
          return;
        }
        if (canSync) {
          onReady();
        } else {
          warning(
            'Censo copiado',
            'Eloísa no está disponible. Usa Sincronizar cuando vuelva la conexión.'
          );
        }
      } catch {
        setError('No se pudo copiar el censo anterior. Inténtalo de nuevo.');
      } finally {
        setBusy(false);
        setStep(null);
      }
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
    if (busy) return;
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
  const actionLabel = copySourceDate
    ? `Copiar pacientes del ${Number(copySourceDate.slice(-2))}`
    : historical
      ? 'Reconstruir desde Eloísa'
      : 'Crear desde Eloísa';
  return (
    <div className="flex w-64 flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy || (checking && !copySourceDate)}
        className="btn btn-primary group !h-auto !p-6 shadow-lg shadow-medical-500/30 flex-col"
        data-testid="create-from-rayen-btn"
      >
        <div className="flex items-center gap-2 text-lg font-bold">
          <RefreshCw size={20} className={busy ? 'animate-spin' : undefined} />
          <span>{busy ? (copySourceDate ? 'Copiando…' : 'Preparando…') : actionLabel}</span>
        </div>
        <span className="text-xs font-normal text-medical-100">
          {copySourceDate
            ? 'Conserva especialidades y abre la sincronización para revisar'
            : historical
              ? 'Revisar evidencia del día antes de importar'
              : 'Revisar pacientes y camas antes de importar'}
        </span>
      </button>
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
