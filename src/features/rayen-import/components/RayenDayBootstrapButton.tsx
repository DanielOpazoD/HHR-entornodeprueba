import React from 'react';
import { RefreshCw } from 'lucide-react';
import { RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS } from '../bridge/extensionHealthBridge';
import { useRayenExtensionHealth } from '../hooks/useRayenExtensionHealth';

interface RayenDayBootstrapButtonProps {
  onCreateBlank: () => Promise<void>;
  onReady: () => void;
}

export const RayenDayBootstrapButton: React.FC<RayenDayBootstrapButtonProps> = ({
  onCreateBlank,
  onReady,
}) => {
  const extension = useRayenExtensionHealth();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleClick = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const health = await extension.refresh({
        timeoutMs: RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
        showChecking: true,
      });
      if (!health.canSync) {
        setError(health.message);
        return;
      }
      await onCreateBlank();
      onReady();
    } catch {
      setError('No se pudo crear el día. No se importó información desde Eloísa.');
    } finally {
      setBusy(false);
    }
  };

  const checking = extension.connection === 'checking';
  return (
    <div className="flex w-64 flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy || checking}
        className="btn btn-primary group !h-auto !p-6 shadow-lg shadow-medical-500/30 flex-col"
        data-testid="create-from-rayen-btn"
      >
        <div className="flex items-center gap-2 text-lg font-bold">
          <RefreshCw size={20} className={busy ? 'animate-spin' : undefined} />
          <span>{busy ? 'Preparando…' : checking ? 'Comprobando…' : 'Crear desde Eloísa'}</span>
        </div>
        <span className="text-xs font-normal text-medical-100">
          Revisar pacientes y camas antes de importar
        </span>
      </button>
      <p className="min-h-5 text-center text-xs text-slate-500" role="status" aria-live="polite">
        {error ??
          (extension.canSync ? 'Ficha Médico y Gestión de Camas conectados' : extension.message)}
      </p>
    </div>
  );
};
