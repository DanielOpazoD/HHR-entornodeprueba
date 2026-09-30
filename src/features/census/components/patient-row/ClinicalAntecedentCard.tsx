import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import {
  requestClinicalAction,
  type ClinicalActionResult,
  type ClinicalAntecedentEntry,
} from '@/features/rayen-import';
import { formatClinicalAntecedentDate } from './clinicalAntecedentDate';

export const ClinicalAntecedentCard = ({
  entry,
  episode,
  autoLoadDetail = true,
}: {
  entry: ClinicalAntecedentEntry;
  episode: string;
  autoLoadDetail?: boolean;
}) => {
  const [result, setResult] = useState<ClinicalActionResult | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [detailRequested, setDetailRequested] = useState(autoLoadDetail);
  const [attachmentError, setAttachmentError] = useState('');
  useEffect(() => {
    if (entry.source !== 'Primaria' || !detailRequested) return;
    const controller = new AbortController();
    const id = `${entry.source}:${entry.id}`;
    const historicalWindowEnd = autoLoadDetail ? undefined : entry.windowEnd;
    const request = historicalWindowEnd
      ? requestClinicalAction(episode, 'detail', id, controller.signal, historicalWindowEnd)
      : requestClinicalAction(episode, 'detail', id, controller.signal);
    void request.then(value => {
      if (!controller.signal.aborted) setResult(value);
    });
    return () => controller.abort();
  }, [
    episode,
    entry.source,
    entry.id,
    entry.windowEnd,
    autoLoadDetail,
    detailAttempt,
    detailRequested,
  ]);

  const openAttachment = async (attachmentId: string): Promise<void> => {
    setAttachmentError('');
    const id = `${entry.source}:${entry.id}:${attachmentId}`;
    const historicalWindowEnd = autoLoadDetail ? undefined : entry.windowEnd;
    const value = historicalWindowEnd
      ? await requestClinicalAction(episode, 'attachment', id, undefined, historicalWindowEnd)
      : await requestClinicalAction(episode, 'attachment', id);
    if (!value.opened) setAttachmentError(value.error || 'No se pudo abrir el adjunto.');
  };

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="text-[10px] text-slate-500">
        {formatClinicalAntecedentDate(entry.date)} · {entry.type || entry.source} · {entry.facility}
      </p>
      <h4 className="mt-0.5 text-xs font-semibold text-slate-800">
        {entry.diagnosis || 'Atención sin diagnóstico informado'}
      </h4>
      {entry.source === 'Primaria' && !detailRequested && (
        <button
          type="button"
          onClick={() => setDetailRequested(true)}
          className="mt-2 text-xs font-semibold text-teal-700"
        >
          Ver detalle de la atención
        </button>
      )}
      {entry.source === 'Primaria' && detailRequested && (
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
