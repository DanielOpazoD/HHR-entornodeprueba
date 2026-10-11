import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import {
  requestClinicalAction,
  type ClinicalActionResult,
  type ClinicalAntecedentEntry,
} from '@/features/rayen-import/clinical-panel';
import { formatClinicalAntecedentDate } from './clinicalAntecedentDate';
import { ClinicalAntecedentContent } from './ClinicalAntecedentContent';

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
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
        <time className="font-semibold tabular-nums text-slate-700">
          {formatClinicalAntecedentDate(entry.date)}
        </time>
        <span
          className={`rounded px-1.5 py-0.5 font-medium ${result?.detail?.careType === 'emergency' ? 'bg-orange-50 text-orange-800' : 'bg-teal-50 text-teal-800'}`}
        >
          {result?.detail?.careType === 'emergency'
            ? 'Urgencia (UEA)'
            : result?.detail?.careType === 'outpatient'
              ? 'Atención ambulatoria (APS)'
              : entry.type || entry.source}
        </span>
      </div>
      {entry.facility && <p className="mt-1 text-[10px] text-slate-500">{entry.facility}</p>}
      {!result?.detail?.diagnoses?.length && (
        <h4 className="mt-0.5 text-xs font-semibold text-slate-800">
          {entry.diagnosis || 'Atención sin diagnóstico informado'}
        </h4>
      )}
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
              <ClinicalAntecedentContent detail={result.detail} entry={entry} />
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
