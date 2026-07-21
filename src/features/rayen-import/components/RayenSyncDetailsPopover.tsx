import React from 'react';
import { Clock3, Info } from 'lucide-react';

interface RayenSyncDetailsPopoverProps {
  lastSync: string | null;
  statusLabel: string | null;
  statusClassName: string;
  responsible: string;
  coverage: string;
}

export const RayenSyncDetailsPopover: React.FC<RayenSyncDetailsPopoverProps> = ({
  lastSync,
  statusLabel,
  statusClassName,
  responsible,
  coverage,
}) => {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative min-w-[190px] lg:pr-4">
      <div className="flex items-center gap-1">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
          <Clock3 size={11} aria-hidden="true" />
          Última sincronización
        </p>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(current => !current)}
          aria-expanded={open}
          aria-controls="rayen-sync-details"
          aria-label="Ver información de la última sincronización"
          title="Información de la última sincronización"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          data-testid="rayen-sync-details-button"
        >
          <Info size={13} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] font-semibold tabular-nums text-slate-700">
        {lastSync ?? 'Sin sincronización registrada'}
        {lastSync && statusLabel && <span className={statusClassName}>· {statusLabel}</span>}
      </p>
      {open && (
        <div
          id="rayen-sync-details"
          role="region"
          aria-label="Detalle de la última sincronización"
          className="absolute left-0 top-8 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
            Información de sincronización
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
            <dt className="text-slate-500">Responsable</dt>
            <dd className="min-w-0 truncate font-semibold text-slate-700">{responsible}</dd>
            <dt className="text-slate-500">Registro</dt>
            <dd className="font-medium tabular-nums text-slate-700">
              {lastSync ?? 'Sin registro'}
            </dd>
            <dt className="text-slate-500">Estado</dt>
            <dd className="font-medium text-slate-700">{statusLabel || 'Sin sincronización'}</dd>
            <dt className="text-slate-500">Cobertura</dt>
            <dd className="font-medium text-slate-700">{coverage}</dd>
          </dl>
        </div>
      )}
    </div>
  );
};
