import React, { useRef, useState } from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { requestClinicalAction } from '@/features/rayen-import';

export const ClinicalPanelPrescriptionButton: React.FC<{ clinicalEpisodeId: string }> = ({
  clinicalEpisodeId,
}) => {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const print = async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await requestClinicalAction(clinicalEpisodeId, 'prescription');
      if (!result.ok || !result.opened) setError(result.error || 'No se pudo abrir la receta.');
    } catch {
      setError('No se pudo abrir la receta.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => void print()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
        title="Abrir receta completa vigente para imprimir o guardar en PDF"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}Imprimir
        receta vigente
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-amber-700">
          {error}
        </p>
      )}
    </div>
  );
};
