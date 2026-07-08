import React from 'react';
import { BookmarkPlus, Check, Edit3, Library, Plus, Trash2 } from 'lucide-react';
import type { MedicalIndicationTemplate } from '@/shared/contracts/medicalIndications';

interface MedicalIndicationsLibraryPanelProps {
  templates: MedicalIndicationTemplate[];
  draftText: string;
  setDraftText: (value: string) => void;
  editingTemplateId: string | null;
  setEditingTemplateId: (value: string | null) => void;
  editingText: string;
  setEditingText: (value: string) => void;
  isLoading: boolean;
  isSaving: boolean;
  disabled: boolean;
  onCreateTemplate: () => void;
  onUpdateTemplate: (templateId: string, text: string) => void;
  onArchiveTemplate: (templateId: string) => void;
  onInsertTemplate: (template: MedicalIndicationTemplate) => void;
}

export const MedicalIndicationsLibraryPanel: React.FC<MedicalIndicationsLibraryPanelProps> = ({
  templates,
  draftText,
  setDraftText,
  editingTemplateId,
  setEditingTemplateId,
  editingText,
  setEditingText,
  isLoading,
  isSaving,
  disabled,
  onCreateTemplate,
  onUpdateTemplate,
  onArchiveTemplate,
  onInsertTemplate,
}) => (
  <aside className="flex min-h-[320px] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm">
    <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
        <Library size={14} />
      </span>
      <div>
        <p className="text-[13px] font-bold text-slate-700">Mis indicaciones</p>
        <p className="text-[11px] text-slate-400">Biblioteca personal</p>
      </div>
    </div>

    <div className="border-b border-slate-100 px-3 py-3">
      <textarea
        className="min-h-[74px] w-full resize-none rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[12px] leading-relaxed text-slate-700 placeholder:text-slate-300 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        value={draftText}
        onChange={event => setDraftText(event.target.value)}
        placeholder="Guardar una indicación frecuente..."
        disabled={disabled || isSaving}
      />
      <button
        type="button"
        onClick={onCreateTemplate}
        disabled={disabled || isSaving || !draftText.trim()}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white shadow-sm shadow-emerald-600/20 transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
      >
        <BookmarkPlus size={14} />
        Guardar en biblioteca
      </button>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto">
      {disabled ? (
        <div className="px-4 py-8 text-center text-[12px] text-slate-400">
          Inicia sesión para usar tu biblioteca personal.
        </div>
      ) : isLoading ? (
        <div className="px-4 py-8 text-center text-[12px] text-slate-400">Cargando...</div>
      ) : templates.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-slate-400">
          Aún no hay indicaciones guardadas.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {templates.map(template => (
            <div key={template.id} className="px-3 py-3">
              {editingTemplateId === template.id ? (
                <div className="space-y-2">
                  <textarea
                    className="min-h-[76px] w-full resize-none rounded-xl border border-emerald-200 px-3 py-2 text-[12px] leading-relaxed text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
                    value={editingText}
                    onChange={event => setEditingText(event.target.value)}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateTemplate(template.id, editingText)}
                      disabled={isSaving || !editingText.trim()}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                    >
                      <Check size={12} />
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingTemplateId(null)}
                      className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-600"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[12px] leading-relaxed text-slate-600">{template.text}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onInsertTemplate(template)}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1 rounded-lg bg-medical-50 px-2.5 py-1.5 text-[11px] font-semibold text-medical-700 hover:bg-medical-100 disabled:opacity-40"
                    >
                      <Plus size={12} />
                      Insertar
                    </button>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTemplateId(template.id);
                          setEditingText(template.text);
                        }}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Editar indicación guardada"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onArchiveTemplate(template.id)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                        aria-label="Archivar indicación guardada"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  </aside>
);
