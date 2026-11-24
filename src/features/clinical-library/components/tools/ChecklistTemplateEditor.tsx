import React, { useState } from 'react';
import {
  clinicalChecklist,
  type ChecklistField,
  type ChecklistTemplate,
} from '@/services/clinical-checklists/checklistService';

const inputStyle = 'w-full rounded border border-slate-300 px-2 py-1 text-sm';
const newField = (): ChecklistField => ({
  id: 'f-' + crypto.randomUUID(),
  label: '',
  type: 'text',
  required: true,
});
const newTemplate = (): ChecklistTemplate => ({
  id: 'p-' + crypto.randomUUID(),
  title: '',
  version: 0,
  fields: [newField()],
});
const fieldTypes = {
  text: 'Texto',
  choice: 'Opciones',
  date: 'Fecha',
  time: 'Hora',
  'positive-integer': 'N.º entero positivo',
};

export function ChecklistTemplateEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: ChecklistTemplate;
  onSaved: (template: ChecklistTemplate) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ChecklistTemplate>(() => initial || newTemplate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (id: string, change: Partial<ChecklistField> | null) => {
    setDraft(current => {
      const old = current.fields.find(f => f.id === id)!;
      const replacement = change ? { ...old, ...change } : null;
      const fields = current.fields
        .filter(f => f.id !== id || replacement)
        .map(f => {
          if (f.id === id) return replacement!;
          if (f.requiredWhen?.field !== id) return f;
          const options = replacement?.type === 'choice' ? replacement.options : undefined;
          if (options?.some(o => o.label === f.requiredWhen?.equals)) return f;
          // A renamed option keeps its condition. A removed option or field releases it.
          const position = old.options?.findIndex(o => o.label === f.requiredWhen?.equals) ?? -1;
          const renamed = options?.length === old.options?.length ? options?.[position] : null;
          return { ...f, requiredWhen: renamed ? { field: id, equals: renamed.label } : null };
        });
      return { ...current, fields };
    });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { template } = await clinicalChecklist({
        action: 'configure',
        template: draft,
        version: draft.version,
      });
      onSaved(template);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar la plantilla.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Nombre de la pauta
          <input
            required
            className={inputStyle}
            maxLength={160}
            value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        {draft.fields.map((field, index) => (
          <fieldset key={field.id} className="space-y-2 rounded border p-2">
            <legend>Campo {index + 1}</legend>
            <label className="block">
              Título
              <input
                required
                className={inputStyle}
                maxLength={160}
                value={field.label}
                onChange={e => update(field.id, { label: e.target.value })}
              />
            </label>
            <div className="flex items-center gap-3">
              <label>
                Tipo{' '}
                <select
                  value={field.type}
                  onChange={e => {
                    const type = e.target.value as ChecklistField['type'];
                    update(
                      field.id,
                      type === 'choice'
                        ? { type, options: [{ label: 'Sí' }, { label: 'No' }] }
                        : { type }
                    );
                  }}
                >
                  {Object.entries(fieldTypes).map(([value, name]) => (
                    <option value={value} key={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={e => update(field.id, { required: e.target.checked })}
                />{' '}
                Obligatorio
              </label>
              <button
                type="button"
                disabled={draft.fields.length < 2}
                onClick={() => update(field.id, null)}
              >
                Quitar
              </button>
            </div>
            {!field.required && draft.fields.slice(0, index).some(f => f.type === 'choice') && (
              <label className="block">
                Exigir respuesta si
                <select
                  className={inputStyle}
                  value={field.requiredWhen ? JSON.stringify(field.requiredWhen) : ''}
                  onChange={e =>
                    update(field.id, {
                      requiredWhen: e.target.value ? JSON.parse(e.target.value) : null,
                    })
                  }
                >
                  <option value="">Sin condición</option>
                  {draft.fields
                    .slice(0, index)
                    .filter(f => f.type === 'choice')
                    .flatMap(
                      f =>
                        f.options?.map((o, n) => (
                          <option
                            key={f.id + '-' + n}
                            value={JSON.stringify({ field: f.id, equals: o.label })}
                          >
                            {f.label} · {o.label}
                          </option>
                        )) || []
                    )}
                </select>
              </label>
            )}
            {field.type === 'choice' && (
              <>
                <small>Opciones y puntos (opcional)</small>
                {field.options?.map((option, n) => (
                  <div key={n} className="flex gap-2">
                    <input
                      aria-label={'Opción ' + (n + 1)}
                      className={inputStyle}
                      required
                      maxLength={160}
                      value={option.label}
                      onChange={e =>
                        update(field.id, {
                          options: field.options?.map((o, k) =>
                            k === n ? { ...o, label: e.target.value } : o
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={'Puntos de opción ' + (n + 1)}
                      className="w-16 rounded border px-1"
                      type="number"
                      min={0}
                      max={1000}
                      value={option.points ?? ''}
                      onChange={e =>
                        update(field.id, {
                          options: field.options?.map((o, k) =>
                            k === n
                              ? e.target.value === ''
                                ? { label: o.label }
                                : { ...o, points: Number(e.target.value) }
                              : o
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label={'Quitar opción ' + (n + 1)}
                      disabled={field.options!.length <= 2}
                      onClick={() =>
                        update(field.id, { options: field.options?.filter((_, k) => k !== n) })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={(field.options?.length || 0) >= 30}
                  onClick={() =>
                    update(field.id, { options: [...(field.options || []), { label: '' }] })
                  }
                >
                  Añadir opción
                </button>
              </>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          disabled={draft.fields.length >= 40}
          onClick={() => setDraft({ ...draft, fields: [...draft.fields, newField()] })}
        >
          Añadir campo
        </button>
        <div className="flex gap-3">
          <button className="rounded bg-medical-700 px-3 py-1 text-white" type="submit">
            Guardar plantilla
          </button>
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
