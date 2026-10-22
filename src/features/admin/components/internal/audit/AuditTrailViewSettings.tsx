import React from 'react';
import clsx from 'clsx';
import { SlidersHorizontal } from 'lucide-react';
import {
  DEFAULT_AUDIT_TRAIL_VIEW,
  type AuditTrailColumns,
  type AuditTrailDensity,
  type AuditTrailViewPreferences,
} from '@/services/admin/auditTrail/auditTrailPreferences';
import { FOCUS_RING } from './auditTrailDisplay';

interface AuditTrailViewSettingsProps {
  preferences: AuditTrailViewPreferences;
  onChange: (patch: Partial<AuditTrailViewPreferences>) => void;
}

const COLUMN_LABELS: Record<keyof AuditTrailColumns, string> = {
  document: 'RUT o documento',
  bed: 'Cama',
  device: 'Dispositivo e IP',
};

const DENSITY_LABELS: Record<AuditTrailDensity, string> = {
  compact: 'Compacta',
  comfortable: 'Cómoda',
};

/** How this device shows the trail; saved locally and kept across logins. */
export const AuditTrailViewSettings: React.FC<AuditTrailViewSettingsProps> = ({
  preferences,
  onChange,
}) => {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
        className={clsx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition',
          FOCUS_RING,
          open
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        )}
      >
        <SlidersHorizontal size={14} />
        Vista
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Personalizar vista"
          className="absolute right-0 z-30 mt-1.5 w-64 space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-lg"
        >
          <fieldset className="space-y-2">
            <legend className="font-medium text-slate-900">Densidad</legend>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {(Object.keys(DENSITY_LABELS) as AuditTrailDensity[]).map(density => (
                <button
                  key={density}
                  type="button"
                  aria-pressed={preferences.density === density}
                  onClick={() => onChange({ density })}
                  className={clsx(
                    'rounded-md px-2.5 py-1 font-medium',
                    FOCUS_RING,
                    preferences.density === density
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500'
                  )}
                >
                  {DENSITY_LABELS[density]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="mb-1 font-medium text-slate-900">Mostrar</legend>
            {(Object.keys(COLUMN_LABELS) as Array<keyof AuditTrailColumns>).map(column => (
              <label key={column} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={preferences.columns[column]}
                  onChange={event =>
                    onChange({
                      columns: { ...preferences.columns, [column]: event.target.checked },
                    })
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600"
                />
                {COLUMN_LABELS[column]}
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preferences.expandGroups}
                onChange={event => onChange({ expandGroups: event.target.checked })}
                className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600"
              />
              Grupos abiertos
            </label>
          </fieldset>

          <button
            type="button"
            onClick={() => onChange(DEFAULT_AUDIT_TRAIL_VIEW)}
            className={clsx('text-slate-500 underline-offset-2 hover:underline', FOCUS_RING)}
          >
            Restablecer vista
          </button>
        </div>
      )}
    </div>
  );
};
