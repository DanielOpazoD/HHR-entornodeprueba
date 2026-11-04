import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

interface MedicalIndicationsListSectionProps {
  remainingSlots: number;
  activeIndications: string[];
  maxIndications: number;
  isOrderingIndications: boolean;
  setIsOrderingIndications: React.Dispatch<React.SetStateAction<boolean>>;
  isEditingIndications: boolean;
  setIsEditingIndications: React.Dispatch<React.SetStateAction<boolean>>;
  resetEditing: () => void;
  indicationDraft: string;
  setIndicationDraft: (value: string) => void;
  addIndication: () => void;
  editingIndex: number | null;
  editingValue: string;
  setEditingValue: (value: string) => void;
  saveEditedIndication: () => void;
  startEditing: (index: number, text: string) => void;
  removeIndication: (index: number) => void;
  moveIndication: (index: number, direction: 'up' | 'down') => void;
}

export const MedicalIndicationsListSection: React.FC<MedicalIndicationsListSectionProps> = ({
  remainingSlots,
  activeIndications,
  maxIndications,
  isOrderingIndications,
  setIsOrderingIndications,
  isEditingIndications,
  setIsEditingIndications,
  resetEditing,
  indicationDraft,
  setIndicationDraft,
  addIndication,
  editingIndex,
  editingValue,
  setEditingValue,
  saveEditedIndication,
  startEditing,
  removeIndication,
  moveIndication,
}) => (
  <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white shadow-sm">
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-medical-100 text-medical-600">
          <ClipboardList size={14} />
        </span>
        <div>
          <p className="text-[13px] font-bold text-slate-700">Indicaciones clínicas</p>
          <p className="text-[11px] text-slate-400">
            {activeIndications.length} de {maxIndications}
            {remainingSlots > 0 && ` \u00B7 ${remainingSlots} disponibles`}
          </p>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${
            isOrderingIndications
              ? 'bg-medical-600 text-white shadow-sm shadow-medical-600/20'
              : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
          onClick={() => setIsOrderingIndications(current => !current)}
        >
          <GripVertical size={12} />
          Ordenar
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${
            isEditingIndications
              ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20'
              : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
          onClick={() => {
            setIsEditingIndications(current => !current);
            resetEditing();
          }}
        >
          <Pencil size={11} />
          {isEditingIndications ? 'Editando' : 'Editar'}
        </button>
      </div>
    </div>

    <div className="border-b border-slate-100 bg-white px-4 py-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 pr-10 text-[13px] text-slate-700 transition-all placeholder:text-slate-300 focus:border-medical-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-medical-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            value={indicationDraft}
            disabled={!isEditingIndications}
            onChange={event => setIndicationDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addIndication();
              }
            }}
            placeholder="Escribe una indicación y presiona Enter…"
          />
          {indicationDraft.trim() && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
              Enter
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={addIndication}
          disabled={
            !isEditingIndications ||
            !indicationDraft.trim() ||
            activeIndications.length >= maxIndications
          }
          className="inline-flex items-center gap-1.5 rounded-xl bg-medical-600 px-4 py-2.5 text-[12px] font-semibold text-white shadow-sm shadow-medical-600/20 transition-all hover:bg-medical-700 hover:shadow-md hover:shadow-medical-600/25 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none"
        >
          <Plus size={14} />
          Agregar
        </button>
      </div>
    </div>

    <div className="divide-y divide-slate-100/80">
      {activeIndications.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
            <ClipboardList size={22} />
          </span>
          <p className="text-[13px] font-medium text-slate-400">Sin indicaciones</p>
          <p className="mt-0.5 text-[11px] text-slate-300">
            Escribe arriba para agregar la primera indicación
          </p>
        </div>
      ) : (
        activeIndications.map((item, index) => (
          <div
            key={`${item}-${index}`}
            className="group/row flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50/60"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-medical-100/70 text-[11px] font-bold text-medical-600">
              {index + 1}
            </span>

            <div className="min-w-0 flex-1">
              {editingIndex === index ? (
                <div className="space-y-2">
                  <input
                    className="w-full rounded-xl border border-medical-200 bg-white px-3.5 py-2 text-[13px] text-slate-700 shadow-sm focus:border-medical-400 focus:outline-none focus:ring-4 focus:ring-medical-500/10"
                    value={editingValue}
                    onChange={event => setEditingValue(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        saveEditedIndication();
                      }
                      if (event.key === 'Escape') {
                        resetEditing();
                      }
                    }}
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={saveEditedIndication}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-all hover:bg-emerald-600 active:scale-[0.98]"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={resetEditing}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-600"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] leading-relaxed text-slate-600">{item}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
              {isOrderingIndications && (
                <>
                  <button
                    type="button"
                    onClick={() => moveIndication(index, 'up')}
                    disabled={index === 0}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                    aria-label={`Subir indicación #${index + 1}`}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveIndication(index, 'down')}
                    disabled={index === activeIndications.length - 1}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                    aria-label={`Bajar indicación #${index + 1}`}
                  >
                    <ArrowDown size={13} />
                  </button>
                </>
              )}
              {isEditingIndications && editingIndex !== index && (
                <button
                  type="button"
                  onClick={() => startEditing(index, item)}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-medical-50 hover:text-medical-600"
                  aria-label={`Editar indicación #${index + 1}`}
                  title={`Editar indicación #${index + 1}`}
                >
                  <Pencil size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => removeIndication(index)}
                disabled={!isEditingIndications}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:pointer-events-none disabled:opacity-30"
                aria-label={`Quitar indicación #${index + 1}`}
                title={`Quitar indicación #${index + 1}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);
