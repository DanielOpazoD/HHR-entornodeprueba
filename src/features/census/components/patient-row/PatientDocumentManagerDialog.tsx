import React, { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useNotification } from '@/context/UIContext';
import {
  requestPatientDocumentOpen,
  type RayenPatientDocument,
} from '@/features/rayen-import';

interface PatientDocumentManagerDialogProps {
  patientName: string;
  clinicalEpisodeId: string;
  documents: RayenPatientDocument[] | null;
  error?: string;
  onClose: () => void;
}

const formatDate = (value: string): string => {
  if (!value) return 'No informada';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('es-CL', { dateStyle: 'short' }).format(parsed);
};

export const PatientDocumentManagerDialog: React.FC<PatientDocumentManagerDialogProps> = ({
  patientName,
  clinicalEpisodeId,
  documents,
  error,
  onClose,
}) => {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { error: notifyError } = useNotification();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const openDocument = async (document: RayenPatientDocument): Promise<void> => {
    if (openingId) return;
    setOpeningId(document.id);
    try {
      const result = await requestPatientDocumentOpen(clinicalEpisodeId, document.id);
      if (!result.ok || !result.opened) {
        notifyError(
          'No se pudo abrir el archivo',
          result.error || 'La extensión no confirmó la apertura.'
        );
      }
    } catch (openError) {
      notifyError(
        'No se pudo abrir el archivo',
        openError instanceof Error ? openError.message : String(openError)
      );
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Documentos de ${patientName}`}
        tabIndex={-1}
        className="flex max-h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800">Documentos del paciente</h3>
            <p className="truncate text-xs text-slate-500">{patientName} · consulta de solo lectura</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar documentos del paciente"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-40 flex-1 overflow-auto p-4 sm:p-6">
          {documents === null && !error && (
            <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 size={17} className="animate-spin" aria-hidden="true" />
              Cargando documentos desde Eloísa…
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {error}
            </div>
          )}
          {documents && documents.length === 0 && (
            <div className="flex min-h-36 items-center justify-center text-sm text-slate-500">
              No hay documentos visibles para este paciente.
            </div>
          )}
          {documents && documents.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-700">
                    {['Clasificación', 'Archivo', 'Nombre', 'Adjuntado por', 'Establecimiento', 'Fecha'].map(label => (
                      <th key={label} scope="col" className="px-3 py-3 font-semibold first:rounded-l-lg last:rounded-r-lg">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {documents.map(document => (
                    <tr key={document.id} className="border-b border-slate-100 text-slate-700">
                      <td className="border-b border-slate-100 px-3 py-4">{document.classification}</td>
                      <td className="border-b border-slate-100 px-3 py-4">
                        <button
                          type="button"
                          onClick={() => void openDocument(document)}
                          disabled={openingId !== null}
                          className="inline-flex max-w-48 items-center gap-1.5 text-left font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 disabled:cursor-progress disabled:opacity-60"
                        >
                          {openingId === document.id && (
                            <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />
                          )}
                          <span className="break-words">{document.fileName}</span>
                        </button>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-4">{document.name}</td>
                      <td className="border-b border-slate-100 px-3 py-4">{document.attachedBy}</td>
                      <td className="border-b border-slate-100 px-3 py-4">{document.facility}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-4">{formatDate(document.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="flex justify-end border-t border-slate-200 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Cerrar
          </button>
        </footer>
      </section>
    </div>
  );
};
