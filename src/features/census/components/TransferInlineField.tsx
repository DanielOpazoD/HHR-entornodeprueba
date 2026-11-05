import React, { useId, useState } from 'react';

interface TransferInlineFieldProps {
  label: string;
  value: string;
  options: readonly string[];
  onSave: (value: string) => Promise<boolean>;
}

/** Remains in the census row; a failed save keeps the user's draft available for retry. */
export const TransferInlineField: React.FC<TransferInlineFieldProps> = ({
  label,
  value,
  options,
  onSave,
}) => {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (!editing)
    return (
      <button
        type="button"
        className="text-left underline decoration-dotted underline-offset-4 hover:text-blue-700 print:no-underline"
        aria-label={`Editar ${label}`}
        onClick={() => {
          setDraft(value);
          setError(false);
          setEditing(true);
        }}
      >
        {value.trim() || 'Sin informar · Completar'}
      </button>
    );
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !draft.trim()) return;
    setSaving(true);
    setError(false);
    try {
      if (await onSave(draft.trim())) setEditing(false);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <span className="hidden print:inline">{value.trim() || 'Sin informar'}</span>
      <form onSubmit={event => void save(event)} className="space-y-1 print:hidden">
        <label htmlFor={id} className="block text-[10px] font-medium text-slate-500">
          {label}
        </label>
        <input
          id={id}
          list={`${id}-options`}
          value={draft}
          disabled={saving}
          autoFocus
          onChange={event => setDraft(event.target.value)}
          className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
        />
        <datalist id={`${id}-options`}>
          {options.map(option => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <div className="flex gap-2 text-xs">
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="font-medium text-blue-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" disabled={saving} onClick={() => setEditing(false)}>
            Cancelar
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-700">
            No se pudo guardar. Conservamos lo escrito para reintentar.
          </p>
        )}
      </form>
    </>
  );
};
