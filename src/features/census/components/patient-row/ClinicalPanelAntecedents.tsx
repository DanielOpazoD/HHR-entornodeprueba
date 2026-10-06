import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  requestClinicalAction,
  type ClinicalActionResult,
} from '@/features/rayen-import/clinical-panel';
import { ClinicalPanelUnavailable } from './ClinicalPanelUnavailable';
import { ClinicalAntecedentCard } from './ClinicalAntecedentCard';
import { formatClinicalAntecedentDate } from './clinicalAntecedentDate';
import {
  clinicalAntecedentEntryKey,
  uniqueClinicalAntecedentEntries,
} from './clinicalAntecedentEntries';
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
            ].map(entry => [clinicalAntecedentEntryKey(entry), entry])
          ).values(),
        ],
      }
    : value;

type AntecedentsProps = { clinicalEpisodeId: string; isActive?: boolean };

const ClinicalPanelAntecedentsForEpisode: React.FC<AntecedentsProps> = ({
  clinicalEpisodeId,
  isActive = true,
}) => {
  const active = useRef(isActive);
  const updateRefreshSchedule = useRef<() => void>(() => undefined);
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
    let timer: number | undefined;
    let lastRefreshStarted = Number.NEGATIVE_INFINITY;
    const refresh = (): void => {
      if (refreshing || !active.current || document.visibilityState === 'hidden') return;
      lastRefreshStarted = Date.now();
      window.clearInterval(timer);
      timer = window.setInterval(refresh, 300000);
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
          if (!controller.signal.aborted && Date.now() - lastRefreshStarted >= 300000) refresh();
        });
    };
    refresh();
    // Retain the original deadline and pending request while the panel tab is inactive.
    const onVisibilityChange = (): void => {
      window.clearInterval(timer);
      if (!active.current || document.visibilityState === 'hidden') return;
      const remaining = 300000 - (Date.now() - lastRefreshStarted);
      if (remaining > 0) {
        timer = window.setTimeout(refresh, remaining);
      } else {
        timer = window.setInterval(refresh, 300000);
        refresh();
      }
    };
    updateRefreshSchedule.current = onVisibilityChange;
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controller.abort();
      updateRefreshSchedule.current = () => undefined;
    };
  }, [clinicalEpisodeId, attempt]);
  useEffect(() => {
    active.current = isActive;
    updateRefreshSchedule.current();
  }, [isActive]);
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
  const currentKeys = new Set((result?.entries ?? []).map(clinicalAntecedentEntryKey));
  const entries = uniqueClinicalAntecedentEntries([
    ...(result?.entries ?? []),
    ...olderPages.flatMap(page => page.data.entries ?? []),
  ]);
  return (
    <div className="space-y-2">
      <div className="px-1 py-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Antecedentes de Eloísa
        </p>
      </div>
      {!result ? (
        <p className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Consultando antecedentes…
        </p>
      ) : !result.ok ? (
        <ClinicalPanelUnavailable
          message={result.error || 'No se pudieron consultar los antecedentes.'}
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
          {!!result.warnings?.length && (
            <aside className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-600">
              <p role="status" className="font-medium">
                Historial parcial · Los antecedentes cargados siguen disponibles.
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer text-slate-500">
                  Ver estado de las fuentes
                </summary>
                {result.warnings.map(warning => (
                  <p key={warning} className="mt-1">
                    {warning}
                  </p>
                ))}
              </details>
            </aside>
          )}
          {(refreshError || !!result.warnings?.length) && (
            <button
              type="button"
              onClick={() => setAttempt(value => value + 1)}
              className="text-xs font-semibold text-teal-700"
            >
              Reintentar antecedentes
            </button>
          )}
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
          {!entries.length && !result.warnings?.length && (
            <p className="py-8 text-center text-xs text-slate-500">
              No se encontraron atenciones en los períodos consultados.
            </p>
          )}
          {entries.map(entry => (
            <ClinicalAntecedentCard
              key={clinicalAntecedentEntryKey(entry)}
              entry={entry}
              episode={clinicalEpisodeId}
              autoLoadDetail={currentKeys.has(clinicalAntecedentEntryKey(entry))}
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

export const ClinicalPanelAntecedents: React.FC<AntecedentsProps> = ({
  clinicalEpisodeId,
  isActive = true,
}) => (
  <ClinicalPanelAntecedentsForEpisode
    key={clinicalEpisodeId}
    clinicalEpisodeId={clinicalEpisodeId}
    isActive={isActive}
  />
);
