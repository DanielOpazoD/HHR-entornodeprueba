import React from 'react';
import { Copy } from 'lucide-react';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { buildRayenSyncDiagnosticReport } from '../domain/rayenSyncDiagnosticReport';

export const RayenSyncSessionReportButton: React.FC<{ history: RayenSyncEvent[] }> = ({
  history,
}) => {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await writeClipboardText(JSON.stringify(buildRayenSyncDiagnosticReport(history), null, 2));
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copiar informe de sincronización"
        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1.5 font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <Copy size={13} aria-hidden="true" /> Copiar resumen
      </button>
      <span className="text-slate-500">
        Incluye pacientes, documentos y detalle de las incidencias.
      </span>
      <span role="status">
        {state === 'copied'
          ? 'Resumen copiado'
          : state === 'failed'
            ? 'No se pudo copiar. Intenta nuevamente.'
            : ''}
      </span>
    </div>
  );
};
