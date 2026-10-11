import { useEffect, useRef, useState } from 'react';
import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type {
  CudyrReviewDecision,
  CudyrReviewEvidence,
  CudyrReviewSource,
  SavedCudyrReview,
} from '@/types/domain/cudyrReview';
import { buildCudyrReviewEvidence } from '@/services/cudyr/cudyrReviewEvidence';
import { loadCudyrReviews, saveCudyrReview } from '@/services/cudyr/cudyrReviewService';

export const useCudyrReviews = (
  data: CudyrReportDataset,
  items: CudyrComparisonItem[],
  sources: CudyrReviewSource[],
  canReview: boolean,
  enabled: boolean
) => {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    data: CudyrReportDataset;
    items: CudyrComparisonItem[];
    sources: CudyrReviewSource[];
    records: SavedCudyrReview[];
    evidence: Record<string, CudyrReviewEvidence>;
    ready: boolean;
    busy: boolean;
    error: string;
  }>({ data, items, sources, records: [], evidence: {}, ready: false, busy: false, error: '' });
  const active = useRef<AbortController | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    const request = new AbortController();
    active.current = request;
    saving.current = false;
    setState({
      data,
      items,
      sources,
      records: [],
      evidence: {},
      ready: false,
      busy: enabled,
      error: '',
    });
    if (enabled)
      void Promise.all([
        loadCudyrReviews(data.from.slice(0, 7), request.signal),
        buildCudyrReviewEvidence(data, items, sources),
      ])
        .then(([records, evidence]) => {
          if (!request.signal.aborted)
            setState({
              data,
              items,
              sources,
              records,
              evidence,
              ready: true,
              busy: false,
              error: '',
            });
        })
        .catch(() => {
          if (!request.signal.aborted)
            setState(previous => ({
              ...previous,
              busy: false,
              error: 'No se pudo leer toda la revisión guardada. Recargue para continuar.',
            }));
        });
    return () => request.abort();
  }, [data, items, sources, enabled, canReview, reload]);
  const current =
    enabled && state.data === data && state.items === items && state.sources === sources;
  const save = async (entryKey: string, decision: CudyrReviewDecision) => {
    const request = active.current;
    if (
      !canReview ||
      !current ||
      !state.ready ||
      state.busy ||
      saving.current ||
      !request ||
      request.signal.aborted ||
      !state.evidence[entryKey]
    )
      return;
    saving.current = true;
    setState(previous => ({ ...previous, busy: true, error: '' }));
    try {
      const result = await saveCudyrReview(
        {
          month: data.from.slice(0, 7),
          entryKey,
          decision,
          evidence: state.evidence[entryKey],
          expectedRevision: state.records.find(r => r.entryKey === entryKey)?.revision || 0,
          operationId: crypto.randomUUID(),
        },
        request.signal
      );
      if (!result.persisted || result.review.entryKey !== entryKey)
        throw new Error('No acknowledgement');
      if (!request.signal.aborted)
        setState(previous => ({
          ...previous,
          busy: false,
          records: [...previous.records.filter(r => r.entryKey !== entryKey), result.review],
        }));
      return !request.signal.aborted;
    } catch {
      if (!request.signal.aborted)
        setState(previous => ({
          ...previous,
          busy: false,
          ready: false,
          error:
            'No se confirmó el guardado o existe una revisión más reciente. Recargue antes de continuar; su borrador sigue visible.',
        }));
    } finally {
      if (active.current === request) saving.current = false;
    }
  };
  return {
    records: current ? state.records : [],
    evidence: current ? state.evidence : {},
    ready: current && state.ready,
    busy: current && state.busy,
    error: current ? state.error : '',
    save,
    refresh: () => setReload(value => value + 1),
  };
};
export type CudyrReviewController = ReturnType<typeof useCudyrReviews>;
