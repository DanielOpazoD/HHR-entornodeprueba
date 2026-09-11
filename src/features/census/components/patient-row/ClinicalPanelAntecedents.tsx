import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import {
  requestClinicalAction,
  type ClinicalActionResult,
  type ClinicalAntecedentEntry,
} from '@/features/rayen-import';
import { ClinicalPanelUnavailable } from './ClinicalPanelUnavailable';
const sameResult = (left: ClinicalActionResult | null, right: ClinicalActionResult): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const AntecedentCard: React.FC<{ entry: ClinicalAntecedentEntry; episode: string }> = ({
  entry,
  episode,
}) => {
  const [result, setResult] = useState<ClinicalActionResult | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [attachmentError, setAttachmentError] = useState('');
  useEffect(() => {
    if (entry.source !== 'Primaria') return;
    const controller = new AbortController();
    void requestClinicalAction(
      episode,
      'detail',
      `${entry.source}:${entry.id}`,
      controller.signal
    ).then(value => {
      if (!controller.signal.aborted) setResult(value);
    });
    return () => controller.abort();
  }, [episode, entry.source, entry.id, detailAttempt]);
  const openAttachment = async (attachmentId: string): Promise<void> => {
    setAttachmentError('');
    const value = await requestClinicalAction(
      episode,
      'attachment',
      `${entry.source}:${entry.id}:${attachmentId}`
    );
    if (!value.opened) setAttachmentError(value.error || 'No se pudo abrir el adjunto.');
  };
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="text-[10px] text-slate-500">
        {entry.date} · {entry.type || entry.source} · {entry.facility}
      </p>
      <h4 className="mt-0.5 text-xs font-semibold text-slate-800">
        {entry.diagnosis || 'Atención sin diagnóstico informado'}
      </h4>
      {entry.source === 'Primaria' && (
        <div className="mt-2 whitespace-pre-wrap border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-600">
          {!result ? (
            <p>Cargando atención…</p>
          ) : result.error ? (
            <div className="flex items-center justify-between gap-2" role="alert">
              <span>{result.error}</span>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setDetailAttempt(value => value + 1);
                }}
                className="shrink-0 font-semibold text-teal-700"
              >
                Reintentar
              </button>
            </div>
          ) : result.detail ? (
            <>
              <p className="font-semibold">{result.detail.professional}</p>
              <p className="mt-1">{result.detail.reason}</p>
              <p className="mt-1">{result.detail.history}</p>
              {!!result.detail.attachments.length && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <p className="font-semibold text-slate-700">Archivos adjuntos</p>
                  {result.detail.attachments.map(attachment => (
                    <div key={attachment.id} className="mt-2">
                      <p className="text-[11px] text-slate-600">{attachment.label}</p>
                      <button
                        type="button"
                        onClick={() => void openAttachment(attachment.id)}
                        className="mt-1 flex items-center gap-1 font-semibold text-teal-700 underline-offset-2 hover:underline"
                      >
                        <Paperclip size={12} /> Descargar adjunto
                      </button>
                    </div>
                  ))}
                  {attachmentError && (
                    <p role="alert" className="mt-2 text-amber-800">
                      {attachmentError}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p>Sin detalle disponible.</p>
          )}
        </div>
      )}
    </article>
  );
};

export const ClinicalPanelAntecedents: React.FC<{ clinicalEpisodeId: string }> = ({
  clinicalEpisodeId,
}) => {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ClinicalActionResult | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const hasSuccessfulResult = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    const refresh = (): void => {
      if (refreshing) return;
      refreshing = true;
      void requestClinicalAction(clinicalEpisodeId, 'list', undefined, controller.signal)
        .then(value => {
          if (controller.signal.aborted) return;
          if (!value.ok && hasSuccessfulResult.current) {
            setRefreshError(value.error || 'No se pudieron actualizar los antecedentes.');
            return;
          }
          if (value.ok) {
            hasSuccessfulResult.current = true;
            setRefreshError('');
          }
          setResult(current => {
            const next =
              value.ok && value.unavailableSources?.length && current?.ok
                ? {
                    ...value,
                    entries: [
                      ...new Map(
                        [
                          ...(current.entries ?? []).filter(entry =>
                            value.unavailableSources?.includes(
                              entry.source as 'Primaria' | 'Secundaria'
                            )
                          ),
                          ...(value.entries ?? []),
                        ].map(entry => [`${entry.source}:${entry.id}`, entry])
                      ).values(),
                    ],
                  }
                : value;
            return sameResult(current, next) ? current : next;
          });
        })
        .finally(() => {
          refreshing = false;
        });
    };
    refresh();
    // El historial rara vez cambia durante una ficha abierta: refrescar en segundo plano,
    // sin desmontar la vista ni repetir el recorrido completo al cambiar de pestaña.
    const timer = window.setInterval(refresh, 300000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [clinicalEpisodeId, attempt]);
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-teal-100 bg-teal-50 p-2.5">
        <p className="text-xs font-semibold text-teal-900">Antecedentes de Eloísa</p>
        <p className="mt-1 text-[11px] text-teal-800">
          Atenciones ambulatorias y secundarias de los últimos 35 meses.
        </p>
      </div>
      {!result ? (
        <p className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Consultando antecedentes…
        </p>
      ) : result.error ? (
        <ClinicalPanelUnavailable
          message={result.error}
          onRetry={() => setAttempt(value => value + 1)}
        />
      ) : (
        <>
          {refreshError && (
            <p
              role="status"
              className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800"
            >
              {refreshError} Se conserva la última información cargada.
            </p>
          )}
          {result.warnings?.map(warning => (
            <p
              key={warning}
              role="status"
              className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800"
            >
              {warning}
            </p>
          ))}
          {!!result.warnings?.length && (
            <button
              type="button"
              onClick={() => setAttempt(value => value + 1)}
              className="text-xs font-semibold text-teal-700"
            >
              Reintentar antecedentes
            </button>
          )}
          {!result.entries?.length && !result.warnings?.length && (
            <p className="py-8 text-center text-xs text-slate-500">
              No se encontraron atenciones en el período consultado.
            </p>
          )}
          {result.entries?.map(entry => (
            <AntecedentCard
              key={`${entry.source}:${entry.id}`}
              entry={entry}
              episode={clinicalEpisodeId}
            />
          ))}
        </>
      )}
    </div>
  );
};
