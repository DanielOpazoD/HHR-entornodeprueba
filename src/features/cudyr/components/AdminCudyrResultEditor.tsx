import React, { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import {
  CUDYR_RESULT_OPTIONS,
  isCudyrResultOption,
  type CudyrResultOption,
} from '@/domain/cudyr/adminCudyrResult';

const REMOVE_VALUE = '__remove__';

interface AdminCudyrResultEditorProps {
  currentCategory: string | null;
  disabledReason?: string;
  onSave: (category: CudyrResultOption | null) => Promise<boolean>;
}

export const AdminCudyrResultEditor: React.FC<AdminCudyrResultEditorProps> = ({
  currentCategory,
  disabledReason,
  onSave,
}) => {
  const normalizedCurrent =
    currentCategory && isCudyrResultOption(currentCategory.toUpperCase())
      ? currentCategory.toUpperCase()
      : '';
  const [isEditing, setIsEditing] = useState(false);
  const [selection, setSelection] = useState<string>(normalizedCurrent);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isEditing) setSelection(normalizedCurrent);
  }, [isEditing, normalizedCurrent]);

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        disabled={Boolean(disabledReason)}
        title={disabledReason || 'Modificar o eliminar el resultado CUDYR como administrador'}
        className="mt-1 inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
        data-testid="admin-cudyr-edit-button"
      >
        <Pencil size={9} />
        Editar
      </button>
    );
  }

  const isRemoval = selection === REMOVE_VALUE;
  const canSave = isRemoval || (isCudyrResultOption(selection) && selection !== normalizedCurrent);

  const handleSave = async () => {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    try {
      const saved = await onSave(isRemoval ? null : (selection as CudyrResultOption));
      if (saved) setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="mt-1 min-w-[118px] rounded-md border border-indigo-200 bg-white p-1.5 shadow-sm print:hidden"
      data-testid="admin-cudyr-result-editor"
    >
      <label className="mb-1 block text-left text-[9px] font-bold uppercase tracking-wide text-slate-600">
        Resultado CUDYR
      </label>
      <select
        value={selection}
        onChange={event => setSelection(event.target.value)}
        disabled={isSaving}
        className="h-7 w-full rounded border border-slate-300 bg-white px-1 text-[11px] font-bold text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        aria-label="Resultado CUDYR administrativo"
      >
        <option value="" disabled>
          Seleccionar…
        </option>
        {CUDYR_RESULT_OPTIONS.map(category => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
        {normalizedCurrent && <option value={REMOVE_VALUE}>Eliminar resultado</option>}
      </select>
      {isRemoval && (
        <p className="mt-1 text-left text-[9px] font-semibold leading-tight text-red-700">
          Se eliminará sólo el resultado CUDYR importado.
        </p>
      )}
      <div className="mt-1.5 flex justify-end gap-1">
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          disabled={isSaving}
          className="inline-flex h-6 items-center gap-0.5 rounded border border-slate-300 px-1.5 text-[9px] font-bold text-slate-600 hover:bg-slate-50"
        >
          <X size={9} />
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || isSaving}
          className={
            isRemoval
              ? 'inline-flex h-6 items-center gap-0.5 rounded bg-red-600 px-1.5 text-[9px] font-bold text-white hover:bg-red-700 disabled:opacity-50'
              : 'inline-flex h-6 items-center gap-0.5 rounded bg-indigo-600 px-1.5 text-[9px] font-bold text-white hover:bg-indigo-700 disabled:opacity-50'
          }
          data-testid="admin-cudyr-save-button"
        >
          {isSaving ? (
            <Loader2 size={9} className="animate-spin" />
          ) : isRemoval ? (
            <Trash2 size={9} />
          ) : (
            <Check size={9} />
          )}
          {isRemoval ? 'Eliminar' : 'Guardar'}
        </button>
      </div>
    </div>
  );
};
