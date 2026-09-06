import { useEffect, useRef, useState } from 'react';
import { History, Loader2 } from 'lucide-react';

export const RecoverCensusStaffButton = () => {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  const recover = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const { recoverCensusStaff } = await import('@/services/staff/recoverCensusStaff');
      const result = await recoverCensusStaff(
        count => setMessage(`${count} censos revisados…`),
        controller.signal
      );
      if (!controller.signal.aborted)
        setMessage(
          `Catálogo compartido actualizado. ${result.censuses} censos · ${result.nurseCount} nombres de Enfermería · ${result.tensCount} de TENS encontrados.`
        );
    } catch {
      if (!controller.signal.aborted)
        setMessage(
          'No se pudo completar la búsqueda o confirmar el guardado. Puedes reintentar; no se borran funcionarios.'
        );
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void recover()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />} Buscar
        profesionales en censos
      </button>
      <p role="status" className="text-xs text-slate-500">
        {message || 'Actuales e históricos · Enfermería y TENS · sin eliminar funcionarios'}
      </p>
    </div>
  );
};
