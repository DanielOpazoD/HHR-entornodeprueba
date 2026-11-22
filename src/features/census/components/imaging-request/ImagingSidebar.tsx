import React from 'react';
import { Target, Type, Undo2 } from 'lucide-react';
import { DocumentOption, DocumentTypeOption } from './types';
import type { CustomMark } from '@/features/census/components/imaging-request/imagingRequestPdfService';

interface ImagingSidebarProps {
  documents: DocumentTypeOption[];
  selectedDoc: DocumentOption;
  setSelectedDoc: (doc: DocumentOption) => void;
  requestingPhysician: string;
  setRequestingPhysician: (val: string) => void;
  toolMode: 'cross' | 'text';
  setToolMode: (mode: 'cross' | 'text') => void;
  marks: CustomMark[];
  handleUndoMark: () => void;
}

export const ImagingSidebar: React.FC<ImagingSidebarProps> = ({
  documents,
  selectedDoc,
  setSelectedDoc,
  requestingPhysician,
  setRequestingPhysician,
  toolMode,
  setToolMode,
  marks,
  handleUndoMark,
}) => {
  return (
    <div className="w-72 flex-shrink-0 self-start overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 shadow-sm ring-1 ring-black/[0.02]">
      {/* Physician Input */}
      <div className="border-b border-slate-100 px-3.5 py-3">
        <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Médico Solicitante
        </label>
        <input
          type="text"
          placeholder="Nombre y Apellido"
          value={requestingPhysician}
          onChange={e => setRequestingPhysician(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
        />
      </div>

      {/* Documents */}
      <div className="border-b border-slate-100 px-3.5 py-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Documentos
        </h3>
        <div className="flex flex-col gap-1.5">
          {documents.map(doc => {
            const Icon = doc.icon;
            const isSelected = selectedDoc === doc.id;

            return (
              <button
                key={doc.id}
                onClick={() => !doc.disabled && setSelectedDoc(doc.id)}
                disabled={doc.disabled}
                className={`
                  group/doc w-full text-left px-3 py-2.5 rounded-xl border flex items-start gap-2.5 transition-all duration-200
                  ${
                    doc.disabled
                      ? 'opacity-40 cursor-not-allowed border-transparent bg-slate-50'
                      : isSelected
                        ? 'border-indigo-500 bg-indigo-50/80 shadow-sm shadow-indigo-500/10'
                        : 'border-slate-200/80 bg-white hover:border-indigo-300 hover:bg-indigo-50/30 active:scale-[0.99]'
                  }
                `}
              >
                <div
                  className={`shrink-0 p-1.5 rounded-lg mt-0.5 transition-all duration-200 ${
                    isSelected
                      ? 'bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-sm shadow-indigo-500/20'
                      : 'bg-slate-100 text-slate-400 group-hover/doc:bg-indigo-100 group-hover/doc:text-indigo-500'
                  }`}
                >
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-[13px] font-semibold ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}
                  >
                    {doc.title}
                  </p>
                  <p
                    className={`text-[11px] mt-0.5 leading-snug ${isSelected ? 'text-indigo-600/70' : 'text-slate-400'}`}
                  >
                    {doc.subtitle}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Marking tools */}
      <div className="px-3.5 py-3">
        <div className="rounded-xl bg-gradient-to-br from-indigo-50/80 to-indigo-100/40 p-3 border border-indigo-200/50">
          <h4 className="flex items-center gap-2 text-[12px] font-bold text-indigo-900">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-indigo-700 text-white">
              <Target size={10} />
            </span>
            Marcado Interactivo
          </h4>
          <p className="mt-1.5 text-[11px] leading-relaxed text-indigo-800/60">
            Haz clic en el formulario para agregar cruces (
            <span className="font-bold text-indigo-700">X</span>) o texto libre.
          </p>

          <div className="mt-2.5 flex gap-1.5">
            <button
              onClick={() => setToolMode('cross')}
              className={`flex-1 py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 text-[11px] font-bold transition-all duration-200 ${
                toolMode === 'cross'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-sm shadow-indigo-600/20'
                  : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 active:scale-[0.98]'
              }`}
            >
              <Target size={11} /> Cruz (X)
            </button>
            <button
              onClick={() => setToolMode('text')}
              className={`flex-1 py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 text-[11px] font-bold transition-all duration-200 ${
                toolMode === 'text'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-sm shadow-indigo-600/20'
                  : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 active:scale-[0.98]'
              }`}
            >
              <Type size={11} /> Texto
            </button>
          </div>
          {marks.length > 0 && (
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-indigo-600">
                {marks.length} {marks.length === 1 ? 'marca' : 'marcas'}
              </span>
              <button
                onClick={handleUndoMark}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-500 shadow-sm transition-all hover:bg-rose-50 hover:border-rose-300 active:scale-[0.98]"
              >
                <Undo2 size={11} /> Deshacer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
