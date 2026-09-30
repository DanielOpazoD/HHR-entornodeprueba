import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { requestClinicalAction, type ClinicalActionResult } from '@/features/rayen-import';
import { ClinicalPanelUnavailable } from './ClinicalPanelUnavailable';
import { ClinicalAntecedentCard } from './ClinicalAntecedentCard';
import { formatClinicalAntecedentDate } from './clinicalAntecedentDate';
const sameResult = (left: ClinicalActionResult | null, right: ClinicalActionResult): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
type OlderPage = { requestedEnd: string; data: ClinicalActionResult };

const mergePartialResult = (
  current: ClinicalActionResult | null,
  value: ClinicalActionResult
): ClinicalActionResult =>
  value.ok && value.unavailableSources?.length && current?.ok
    ? {
        ...value,
        entries: [
          ...new Map(
            [
              ...(current.entries ?? []).filter(entry =>
                value.unavailableSources?.includes(entry.source as 'Primaria' | 'Secundaria')
              ),
              ...(value.entries ?? []),
            ].map(entry => [`${entry.source}:${entry.id}`, entry])
          ).values(),
        ],
      }
    : value;

const ClinicalPanelAntecedentsForEpisode: React.FC<{ clinicalEpisodeId: string }> = ({
  clinicalEpisodeId,
}) => {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ClinicalActionResult | null>(null);
  const [olderPages, setOlderPages] = useState<OlderPage[]>([]);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const hasSuccessfulResult = useRef(false);
  const olderRequest = useRef<AbortController | null>(null);
  useEffect(() => () => olderRequest.current?.abort(), []);
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
            const next = mergePartialResult(current, value);
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
  const lastOlderPage = olderPages.at(-1);
  const nextBeforeDate = lastOlderPage
    ? lastOlderPage.data.warnings?.length
      ? lastOlderPage.requestedEnd
      : lastOlderPage.data.nextBeforeDate
    : result?.nextBeforeDate;
  const loadOlder = async (): Promise<void> => {
    if (!nextBeforeDate || olderLoading) return;
    const controller = new AbortController();
    olderRequest.current = controller;
    setOlderLoading(true);
    setOlderError('');
    try {
      const value = await requestClinicalAction(
        clinicalEpisodeId,
        'list',
        undefined,
        controller.signal,
        nextBeforeDate
      );
      if (controller.signal.aborted) return;
      if (!value.ok) {
        setOlderError(value.error || 'No se pudo consultar el período anterior.');
        return;
      }
      setOlderPages(pages => {
        const existing = pages.findIndex(page => page.requestedEnd === nextBeforeDate);
        const next = {
          requestedEnd: nextBeforeDate,
          data: mergePartialResult(existing < 0 ? null : pages[existing].data, value),
        };
        return existing < 0
          ? [...pages, next]
          : pages.map((page, index) => (index === existing ? next : page));
      });
    } finally {
      if (!controller.signal.aborted) setOlderLoading(false);
    }
  };
  const currentKeys = new Set((result?.entries ?? []).map(entry => `${entry.source}:${entry.id}`));
  const entries = [
    ...(result?.entries ?? []),
    ...olderPages.flatMap(page => page.data.entries ?? []),
  ].filter(
    (entry, index, all) =>
      all.findIndex(other => other.source === entry.source && other.id === entry.id) === index
  );
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-teal-100 bg-teal-50 p-2.5">
        <p className="text-xs font-semibold text-teal-900">Antecedentes de Eloísa</p>
        <p className="mt-1 text-[11px] text-teal-800">
          Atenciones ambulatorias y secundarias por períodos. Puedes cargar períodos anteriores para
          consultar el historial disponible.
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
          {olderPages.flatMap(page =>
            (page.data.warnings ?? []).map(warning => (
              <p
                key={`${page.requestedEnd}:${warning}`}
                role="status"
                className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800"
              >
                Período hasta {formatClinicalAntecedentDate(page.requestedEnd)}: {warning}
              </p>
            ))
          )}
          {!!result.warnings?.length && (
            <button
              type="button"
              onClick={() => setAttempt(value => value + 1)}
              className="text-xs font-semibold text-teal-700"
            >
              Reintentar antecedentes
            </button>
          )}
          {!entries.length && !result.warnings?.length && (
            <p className="py-8 text-center text-xs text-slate-500">
              No se encontraron atenciones en los períodos consultados.
            </p>
          )}
          {entries.map(entry => (
            <ClinicalAntecedentCard
              key={`${entry.source}:${entry.id}`}
              entry={entry}
              episode={clinicalEpisodeId}
              autoLoadDetail={currentKeys.has(`${entry.source}:${entry.id}`)}
            />
          ))}
          {olderError && (
            <p role="alert" className="text-xs text-amber-800">
              {olderError}
            </p>
          )}
          {nextBeforeDate && (
            <button
              type="button"
              disabled={olderLoading}
              onClick={() => void loadOlder()}
              className="rounded-md border border-teal-200 px-3 py-2 text-xs font-semibold text-teal-700 disabled:opacity-60"
            >
              {olderLoading
                ? 'Consultando período anterior…'
                : lastOlderPage?.data.warnings?.length
                  ? 'Reintentar período anterior'
                  : 'Cargar período anterior'}
            </button>
          )}
        </>
      )}
    </div>
  );
};

export const ClinicalPanelAntecedents: React.FC<{ clinicalEpisodeId: string }> = ({
  clinicalEpisodeId,
}) => (
  <ClinicalPanelAntecedentsForEpisode
    key={clinicalEpisodeId}
    clinicalEpisodeId={clinicalEpisodeId}
  />
);
