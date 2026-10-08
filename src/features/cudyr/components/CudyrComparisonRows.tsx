import { useState } from 'react';
import type { CudyrReviewController } from '../hooks/useCudyrReviews';
import { isCurrentCudyrReview } from '@/services/cudyr/cudyrReviewEvidence';
import { CudyrSavedReview } from './CudyrSavedReview';
import { CudyrLinkReviewForm } from './CudyrLinkReviewForm';
import {
  CUDYR_LINK_LABELS,
  isReviewableCudyrSource,
  type CudyrLinkDraft,
} from '@/services/cudyr/cudyrLinkReview';
import type {
  CudyrComparisonItem,
  CudyrComparisonStatus,
} from '@/types/domain/cudyrReconciliation';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { CUDYR_COMPARISON_LABELS } from '@/services/cudyr/cudyrMonthlyComparison';
import {
  CUDYR_MODALITY_LABELS,
  CUDYR_ELIGIBILITY_LABELS,
  CUDYR_GROUP_LABELS,
  cudyrSystemDischargeLabel,
} from '@/services/cudyr/cudyrReportPresentation';

export const CudyrComparisonRows = ({
  items,
  data,
  onView,
  canReview = false,
  review,
}: {
  canReview?: boolean;
  review?: CudyrReviewController;
  items: CudyrComparisonItem[];
  data: CudyrReportDataset;
  onView: (key: string) => void;
}) => {
  const [reviewFilter, setReviewFilter] = useState('');
  const [session, setSession] = useState<{
    data: CudyrReportDataset;
    items: CudyrComparisonItem[];
    drafts: Record<string, CudyrLinkDraft>;
    canReview: boolean;
    revision: number;
  }>({ data, items, canReview, revision: 0, drafts: {} });
  const sameRead =
    session.data === data && session.items === items && session.canReview === canReview;
  if (!sameRead) setSession({ data, items, canReview, revision: session.revision + 1, drafts: {} });
  const drafts = sameRead && canReview ? session.drafts : {};
  const saved = review?.records || [];
  const currentSaved = saved.filter(r => isCurrentCudyrReview(r, review?.evidence[r.entryKey]));
  const decisions = {
    ...Object.fromEntries(currentSaved.map(r => [r.entryKey, r.decision])),
    ...drafts,
  };
  const needsReview = new Set(
    saved.filter(r => !isCurrentCudyrReview(r, review?.evidence[r.entryKey])).map(r => r.entryKey)
  );
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const rows = items.filter(
    r =>
      (!filter || r.status === filter) &&
      (!canReview ||
        !reviewFilter ||
        (reviewFilter === 'unreviewed'
          ? isReviewableCudyrSource(r) && !decisions[r.key] && !needsReview.has(r.key)
          : reviewFilter === 'stale'
            ? needsReview.has(r.key)
            : decisions[r.key]?.action === reviewFilter)) &&
      `${r.patientName} ${r.document}`
        .toLocaleLowerCase('es')
        .includes(search.toLocaleLowerCase('es'))
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  return (
    <div className="space-y-3">
      {canReview && (!review || Object.keys(drafts).length > 0) && (
        <p className="rounded bg-teal-50 p-3 text-xs" role="status">
          {Object.keys(drafts).length} decisiones en borrador ·{' '}
          {review
            ? 'use Guardar revisión en HHR para conservarlas. Cambiar fuentes o salir descarta solo los borradores.'
            : 'se pierden al cambiar la fuente, volver a consultar el período o salir. No se guardan en HHR ni en el Excel.'}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {canReview && (
          <label>
            Revisión manual
            <select
              className="mt-1 block rounded border p-2"
              value={reviewFilter}
              onChange={e => {
                setReviewFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas las entradas</option>
              <option value="unreviewed">Filas fuente sin revisar</option>
              {review && (
                <option value="stale">Requieren nueva revisión ({needsReview.size})</option>
              )}
              {Object.entries(CUDYR_LINK_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label} ({Object.values(decisions).filter(d => d.action === value).length})
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Resultado del cotejo
          <select
            className="mt-1 block rounded border p-2"
            value={filter}
            onChange={e => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(CUDYR_COMPARISON_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label} ({items.filter(r => r.status === key).length})
              </option>
            ))}
          </select>
        </label>
        <label>
          Buscar en la conciliación
          <input
            className="mt-1 block rounded border p-2"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Nombre o documento"
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {rows.length} entradas de cotejo; no son pacientes-día ni una nueva estadística de
        cumplimiento.
      </p>
      <div className="space-y-2">
        {rows.slice(currentPage * 20, currentPage * 20 + 20).map(item => (
          <article key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-semibold">
                {item.patientName || 'Nombre no informado'} · {item.document || 'Sin documento'}
              </p>
              <span className={item.status === 'compatible' ? 'text-teal-800' : 'text-amber-900'}>
                {CUDYR_COMPARISON_LABELS[item.status as CudyrComparisonStatus]}
              </span>
            </div>
            <p className="mt-1">
              {item.source} · {item.sourceDate} · {item.sourceValue}
              {item.sourceRow ? ` · fila ${item.sourceRow}` : ''}
            </p>
            <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-teal-800">
                Contexto HHR ({item.candidateKeys.length} filas candidatas)
              </summary>
              <ul className="mt-2 space-y-2">
                {item.candidateKeys.map(key => {
                  const r = data.rows.find(row => row.key === key);
                  return (
                    r && (
                      <li key={key} className="rounded border bg-white p-2 text-xs">
                        <p>
                          {r.patientName} · Censo {r.date} · {r.bedId || 'Cama no informada'} ·{' '}
                          {CUDYR_GROUP_LABELS[r.group]} · {CUDYR_MODALITY_LABELS[r.modality]} ·{' '}
                          {CUDYR_ELIGIBILITY_LABELS[r.eligibility]}
                        </p>
                        <p>{r.diagnosis || 'Diagnóstico no informado'}</p>
                        <p>
                          CUDYR {r.evaluation?.category || 'Sin resultado'} ·{' '}
                          {r.evaluation?.source || 'Sin fuente'} · Autor:{' '}
                          {r.evaluation?.author || 'No informado'}
                        </p>
                        <p>
                          Aplicación original: {r.evaluation?.recordedAt || 'No informada'} ·
                          Episodio: {r.clinicalEpisodeId || 'No informado'}
                        </p>
                        <p>
                          Alta sistema: {cudyrSystemDischargeLabel(r)} · Alta real:{' '}
                          {r.correction?.actualDischarge
                            ? `${r.correction.actualDischarge.date} ${r.correction.actualDischarge.time || '(hora no informada)'}`
                            : 'No verificada'}
                        </p>
                        <button
                          type="button"
                          className="mt-1 underline"
                          onClick={() => onView(key)}
                        >
                          Ver detalle HHR
                        </button>
                      </li>
                    )
                  );
                })}
              </ul>
            </details>
            {review && isReviewableCudyrSource(item) && (
              <CudyrSavedReview
                review={review}
                inlineSave
                entryKey={item.key}
                draft={canReview ? drafts[item.key] : undefined}
                onSaved={() => {
                  setSession(previous => {
                    if (
                      previous.data !== data ||
                      previous.items !== items ||
                      previous.drafts[item.key] !== drafts[item.key]
                    )
                      return previous;
                    const next = { ...previous.drafts };
                    delete next[item.key];
                    return { ...previous, drafts: next };
                  });
                }}
              />
            )}
            {canReview && isReviewableCudyrSource(item) && (
              <fieldset disabled={review?.busy}>
                <CudyrLinkReviewForm
                  key={`${item.key}:${session.revision}:${saved.find(r => r.entryKey === item.key)?.revision || 0}`}
                  item={item}
                  rows={data.rows}
                  draft={drafts[item.key]}
                  initialDecision={saved.find(r => r.entryKey === item.key)?.decision}
                  savedDecision={currentSaved.find(r => r.entryKey === item.key)?.decision}
                  saveDisabled={review ? !review.ready || review.busy : false}
                  saving={review?.busy && Boolean(drafts[item.key])}
                  onSave={
                    review
                      ? next => {
                          void review.save(item.key, next).then(persisted => {
                            if (persisted)
                              setSession(previous => {
                                if (previous.data !== data || previous.items !== items)
                                  return previous;
                                const remaining = { ...previous.drafts };
                                delete remaining[item.key];
                                return { ...previous, drafts: remaining };
                              });
                          });
                        }
                      : undefined
                  }
                  onView={onView}
                  onChange={draft => {
                    const next = { ...drafts };
                    if (draft) next[item.key] = draft;
                    else delete next[item.key];
                    setSession({
                      data,
                      items,
                      canReview,
                      revision: session.revision,
                      drafts: next,
                    });
                  }}
                />
              </fieldset>
            )}
          </article>
        ))}
      </div>
      {!rows.length && <p>No hay entradas para estos filtros.</p>}
      <nav aria-label="Páginas de conciliación" className="flex items-center justify-between">
        <button
          type="button"
          disabled={!currentPage}
          className="rounded border px-3 py-2 disabled:opacity-40"
          onClick={() => setPage(currentPage - 1)}
        >
          Anterior
        </button>
        <span>
          Página {currentPage + 1} de {Math.max(1, Math.ceil(rows.length / 20))}
        </span>
        <button
          type="button"
          disabled={(currentPage + 1) * 20 >= rows.length}
          className="rounded border px-3 py-2 disabled:opacity-40"
          onClick={() => setPage(currentPage + 1)}
        >
          Siguiente
        </button>
      </nav>
    </div>
  );
};
