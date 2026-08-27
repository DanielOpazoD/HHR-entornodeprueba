import React, { useState } from 'react';
import { CheckSquare, Loader2, Trash2, X } from 'lucide-react';

interface AdminCudyrBulkRemovalToolbarProps {
  availableCount: number;
  selectedCount: number;
  isActive: boolean;
  isBusy: boolean;
  onStart: () => void;
  onCancel: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onConfirmRemoval: () => Promise<boolean>;
}

export const AdminCudyrBulkRemovalToolbar: React.FC<AdminCudyrBulkRemovalToolbarProps> = ({
  availableCount,
  selectedCount,
  isActive,
  isBusy,
  onStart,
  onCancel,
  onSelectAll,
  onClearSelection,
  onConfirmRemoval,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);

  if (availableCount === 0 && !isActive) return null;

  if (!isActive) {
    return (
      <div className="mb-3 flex justify-end print:hidden">
        <button
          type="button"
          onClick={() => {
            setIsConfirming(false);
            onStart();
          }}
          disabled={isBusy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
          data-testid="admin-cudyr-bulk-start"
        >
          <CheckSquare size={14} />
          Eliminar varios resultados
        </button>
      </div>
    );
  }

  if (isConfirming) {
    return (
      <div
        className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 print:hidden"
        data-testid="admin-cudyr-bulk-confirmation"
      >
        <p className="text-sm font-bold text-red-900">
          ¿Eliminar {selectedCount} {selectedCount === 1 ? 'resultado' : 'resultados'} CUDYR?
        </p>
        <p className="mt-0.5 text-xs text-red-800">
          Se eliminarán sólo los resultados importados. Braden, Downton y los puntajes CUDYR locales
          se conservarán.
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            disabled={isBusy}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={() => void onConfirmRemoval()}
            disabled={isBusy || selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-50"
            data-testid="admin-cudyr-bulk-confirm"
          >
            {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {isBusy ? 'Eliminando…' : 'Confirmar eliminación'}
          </button>
        </div>
      </div>
    );
  }

  const allSelected = selectedCount === availableCount;
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 print:hidden"
      data-testid="admin-cudyr-bulk-toolbar"
    >
      <span className="text-xs font-bold text-indigo-900">
        {selectedCount} de {availableCount} seleccionados
      </span>
      <button
        type="button"
        onClick={allSelected ? onClearSelection : onSelectAll}
        disabled={isBusy}
        className="rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
      >
        {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onCancel}
        disabled={isBusy}
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <X size={12} />
        Cancelar
      </button>
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        disabled={selectedCount === 0 || isBusy}
        className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 size={12} />
        Eliminar seleccionados
      </button>
    </div>
  );
};
