import React from 'react';
import { FileHeart, Unplug, Clock3, RefreshCw } from 'lucide-react';

export const ClinicalPanelUnavailable: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => {
  const expired = /401|session_expired|sesi[oó]n.*(?:venci|expir)|sin token/i.test(message);
  const disconnected = /extensi[oó]n|tiempo de espera|receiving end|conexi[oó]n/i.test(message);
  const Icon = expired ? Clock3 : Unplug;
  return (
    <section
      role="status"
      className="mx-auto my-8 max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
    >
      <div
        aria-hidden="true"
        className="relative mx-auto mb-5 flex size-20 items-center justify-center rounded-2xl bg-teal-50 text-teal-600"
      >
        <FileHeart size={42} strokeWidth={1.4} />
        <span className="absolute -bottom-2 -right-2 rounded-full border-4 border-white bg-amber-100 p-2 text-amber-700">
          <Icon size={20} />
        </span>
      </div>
      <h3 className="text-sm font-semibold text-slate-800">
        {expired
          ? 'Renueva tu sesión en Eloísa'
          : disconnected
            ? 'Conectemos tu ficha clínica'
            : 'La ficha no pudo cargarse'}
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        {expired
          ? 'Tu sesión clínica venció. Inicia sesión de nuevo en Ficha Médico y vuelve aquí para consultar al paciente.'
          : disconnected
            ? 'Abre Ficha Médico con la extensión Eloísa activa. Cuando la conexión esté disponible, podrás consultar los registros del paciente.'
            : 'Eloísa no pudo completar la consulta. Puedes volver a intentarlo en unos momentos.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
      >
        <RefreshCw size={14} />
        Reintentar
      </button>
      <details className="mt-4 text-left text-[11px] text-slate-400">
        <summary className="cursor-pointer">Detalle de la conexión</summary>
        <p className="mt-2 break-words">{message}</p>
      </details>
    </section>
  );
};
