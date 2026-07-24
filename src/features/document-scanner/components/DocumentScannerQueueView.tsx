import React from 'react';
import { CheckCircle2, ExternalLink, FileText, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import {
  confirmScannedDocumentUploaded,
  listScannedDocuments,
  type ScannedDocumentQueueRecord,
} from '../services/documentScannerQueueService';

const formatCreatedAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export const DocumentScannerQueueView: React.FC = () => {
  const [documents, setDocuments] = React.useState<ScannedDocumentQueueRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [confirmedIds, setConfirmedIds] = React.useState<Set<string>>(() => new Set());
  const [purgingId, setPurgingId] = React.useState<string | null>(null);

  const loadDocuments = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await listScannedDocuments();
      setDocuments(result.documents);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo cargar la bandeja temporal.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const purgeDocument = async (id: string) => {
    if (!confirmedIds.has(id)) return;
    setPurgingId(id);
    setErrorMessage(null);
    try {
      await confirmScannedDocumentUploaded(id);
      setDocuments(current => current.filter(document => document.id !== id));
      setConfirmedIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo eliminar el documento.');
    } finally {
      setPurgingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-800 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
              HHR · Gestor documental
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Documentos por subir a Eloísa
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Abre el PDF, súbelo al paciente correcto y verifica que aparezca en Eloísa. Solo
              entonces confirma para eliminar la copia temporal de HHR.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDocuments()}
            disabled={loading}
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal-600 px-4 text-sm font-bold text-teal-700 disabled:opacity-50 sm:mt-0"
          >
            <RefreshCcw size={17} className={loading ? 'animate-spin' : undefined} /> Actualizar
          </button>
        </header>

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-slate-600">
            <Loader2 size={22} className="animate-spin" /> Cargando documentos…
          </div>
        ) : documents.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-700" />
            <p className="mt-3 font-bold text-emerald-900">No hay documentos pendientes</p>
          </div>
        ) : (
          <ul className="space-y-4">
            {documents.map(document => {
              const confirmed = confirmedIds.has(document.id);
              const purging = purgingId === document.id;
              return (
                <li
                  key={document.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                      <FileText size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-bold text-slate-900">
                        {document.bedId} · {document.patientName}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        RUN {document.patientRut} · {document.pageCount}{' '}
                        {document.pageCount === 1 ? 'página' : 'páginas'} ·{' '}
                        {formatCreatedAt(document.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {document.downloadUrl ? (
                      <a
                        href={document.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white"
                      >
                        <ExternalLink size={17} /> Abrir PDF para subir
                      </a>
                    ) : (
                      <span className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-4 text-sm text-slate-500">
                        PDF temporal no disponible
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void purgeDocument(document.id)}
                      disabled={!confirmed || purging}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {purging ? (
                        <Loader2 size={17} className="animate-spin" />
                      ) : (
                        <Trash2 size={17} />
                      )}
                      Eliminar copia temporal
                    </button>
                  </div>
                  <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={event => {
                        setConfirmedIds(current => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(document.id);
                          else next.delete(document.id);
                          return next;
                        });
                      }}
                      className="mt-0.5 h-4 w-4 accent-teal-700"
                    />
                    Confirmo que abrí la ficha del paciente correcto y que el documento aparece
                    correctamente en Eloísa.
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
};

export default DocumentScannerQueueView;
