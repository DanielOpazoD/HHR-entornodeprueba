import { Download, History, RefreshCw, UsersRound } from 'lucide-react';

/** Matches the synchronization card without loading its runtime or claiming connection health. */
export const RayenOperationsLoadingCard = () => (
  <div
    className="h-full min-h-20 w-full rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    role="status"
    aria-busy="true"
    aria-label="Cargando panel de Eloísa"
    data-testid="rayen-operations-loading"
  >
    <div className="flex h-full min-w-0 flex-col justify-between gap-1 px-2 py-1">
      <div className="relative flex min-w-[210px] items-center gap-2">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
          <img src="/images/logos/rayen-mark.png" alt="" className="size-7 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <button
            disabled
            type="button"
            aria-label="Estado de conexión de Eloísa"
            className="flex w-full min-w-0 items-center gap-1.5 rounded"
          >
            <span className="text-[13px] font-semibold leading-tight text-slate-800">Eloísa</span>
          </button>
          <p className="mt-0.5 text-[10px] font-medium tabular-nums text-slate-500">
            Cargando controles…
          </p>
        </div>
        <button
          disabled
          type="button"
          aria-label="Descargar extensión"
          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500"
        >
          <Download size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">
        <button
          disabled
          type="button"
          aria-label="Abrir historial de sincronización del día"
          className="relative inline-flex size-8 min-h-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500"
        >
          <History size={14} aria-hidden="true" />
        </button>
        <button
          disabled
          type="button"
          className="relative inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0 text-[10px] font-semibold text-slate-600 disabled:opacity-50"
        >
          <UsersRound size={14} aria-hidden="true" /> Dotación
        </button>
        <button
          disabled
          type="button"
          className="inline-flex h-7 w-28 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-teal-700 px-1.5 py-0 text-[10px] font-semibold text-white disabled:opacity-70"
        >
          <RefreshCw size={13} strokeWidth={2.5} aria-hidden="true" /> Sincronizar
        </button>
      </div>
    </div>
  </div>
);
