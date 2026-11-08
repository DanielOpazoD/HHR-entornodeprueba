import { useEffect, useRef, useState } from 'react';
import { FileDown } from 'lucide-react';

export const ClinicalAntecedentDau = ({
  request,
}: {
  request: (signal: AbortSignal) => Promise<{ opened?: boolean; error?: string }>;
}) => {
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => pending.current?.abort(), []);
  const download = async (): Promise<void> => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await request(controller.signal);
      if (!controller.signal.aborted && !result.opened)
        setError(result.error || 'No se pudo descargar el DAU oficial. Reintenta.');
    } catch {
      if (!controller.signal.aborted) setError('No se pudo descargar el DAU oficial. Reintenta.');
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="mt-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="inline-flex items-center gap-1 font-semibold text-teal-700 disabled:opacity-50"
      >
        <FileDown size={12} aria-hidden="true" />
        {busy ? 'Descargando DAU…' : 'Descargar DAU oficial (PDF)'}
      </button>
      {error && (
        <p role="alert" className="text-amber-800">
          {error}
        </p>
      )}
    </div>
  );
};
