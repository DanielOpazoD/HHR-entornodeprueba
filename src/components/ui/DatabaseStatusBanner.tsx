import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';
import { useDatabaseFallbackStatus } from '@/hooks/useDatabaseFallbackStatus';

export const DatabaseStatusBanner: React.FC = () => {
  const isFallbackMode = useDatabaseFallbackStatus();

  if (!isFallbackMode) return null;

  return (
    <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between shadow-lg sticky top-0 z-[100] animate-pulse">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5" />
        <div>
          <span className="font-bold">MODO DE EMERGENCIA:</span>
          <span className="ml-2 text-sm opacity-90">
            La base de datos local falló. Los cambios se perderán al cerrar o refrescar el
            navegador.
          </span>
        </div>
      </div>

      <button
        onClick={defaultBrowserWindowRuntime.reload}
        className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-3 py-1 rounded text-sm transition-colors border border-white/50"
      >
        <RefreshCw className="h-4 w-4" />
        Intentar Recuperar
      </button>
    </div>
  );
};
