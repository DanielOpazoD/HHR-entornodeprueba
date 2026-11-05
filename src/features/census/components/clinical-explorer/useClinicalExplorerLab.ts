import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient as appQueryClient } from '@/config/queryClient';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { onSessionChange } from '@/services/storage/sessionStorageTransition';
import {
  buildAnalysisData,
  cleanRutForSyslab,
  fetchSyslabExamDetails,
  parseDateDDMMYYYY,
  searchSyslabExams,
  useSyslabAccess,
  type SyslabAccessModel,
} from '@/features/laboratory';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';

export type ClinicalExplorerLabPhase =
  | 'checking'
  | 'login-required'
  | 'unavailable'
  | 'listing'
  | 'reading'
  | 'empty'
  | 'ready'
  | 'error';

export interface ClinicalExplorerLabResult {
  phase: ClinicalExplorerLabPhase;
  access: SyslabAccessModel;
  message: string;
  progress: { completed: number; total: number } | null;
  exams: SyslabExamItem[];
  analysis: LabAnalysisData | null;
  /** Reports Syslab listed but could not deliver yet; they are asked again on the next refresh. */
  pending: number;
  retry: () => void;
}

interface ExplorerLabAnalysis {
  analysis: LabAnalysisData;
  pending: number;
}

interface UseClinicalExplorerLabParams {
  rut: string;
  episodeId: string;
  /** ISO day; reports before it belong to an earlier attention and are left out. */
  admissionDate: string;
  enabled: boolean;
}

const EXPLORER_KEY = ['laboratory', 'explorer'] as const;

/** Reports of this hospitalization: with a link, and not before the admission day. */
const filterHospitalizationExams = (
  items: SyslabExamItem[] | undefined,
  admissionDate: string
): SyslabExamItem[] =>
  (items ?? []).filter(
    exam => exam.link && (!admissionDate || parseDateDDMMYYYY(exam.date) >= admissionDate)
  );
const LIST_STALE_MS = 10 * 60_000;
const GC_MS = 30 * 60_000;

// Several people share one computer: a new Eloísa session forgets every explorer read, whether or
// not the explorer is mounted at that moment; the session epoch keeps old keys from coming back.
onSessionChange(() => {
  void appQueryClient.removeQueries({ queryKey: EXPLORER_KEY });
});

/**
 * Lab reports of one patient's hospitalization: the Syslab list, then every report read once and
 * kept in memory for this tab only. A failed read is a failure, never an empty list (SAVE-01).
 */
export const useClinicalExplorerLab = ({
  rut,
  episodeId,
  admissionDate,
  enabled,
}: UseClinicalExplorerLabParams): ClinicalExplorerLabResult => {
  const access = useSyslabAccess(enabled);
  const queryClient = useQueryClient();
  const rutBody = cleanRutForSyslab(rut);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  // Part of every key: what was on screen leaves with the session that read it.
  const generation = useSessionEpoch();

  const connected = enabled && access.state === 'connected' && rutBody.length > 0;
  const listKey = [...EXPLORER_KEY, generation, 'exams', rutBody];
  const list = useQuery({
    queryKey: listKey,
    enabled: connected,
    staleTime: LIST_STALE_MS,
    gcTime: GC_MS,
    retry: false,
    queryFn: async () => {
      const response = await searchSyslabExams(rut);
      if (!response.success) throw new Error(response.error || 'Syslab no respondió.');
      return response.data;
    },
  });

  // Search links expire after 15 minutes. A stale list is renewed before any report is asked.
  const listFresh = list.isSuccess && !list.isStale;
  useEffect(() => {
    if (connected && list.isSuccess && list.isStale && !list.isFetching) void list.refetch();
  }, [connected, list]);

  const exams = useMemo(
    () => filterHospitalizationExams(list.data, admissionDate),
    [list.data, admissionDate]
  );
  const examIds = exams.map(exam => exam.id).join(',');

  const analysis = useQuery<ExplorerLabAnalysis, Error>({
    queryKey: [...EXPLORER_KEY, generation, 'analysis', rutBody, episodeId, examIds],
    enabled: listFresh && exams.length > 0,
    // Reports already read do not change; reports Syslab could not deliver are asked again.
    staleTime: query => (query.state.data?.pending ? LIST_STALE_MS : Infinity),
    gcTime: GC_MS,
    retry: false,
    queryFn: async ({ signal }): Promise<ExplorerLabAnalysis> => {
      // Links come from the list as cached now, not from the render that started this read, so a
      // retry after renewing the list never asks for links that already expired.
      const current = filterHospitalizationExams(
        queryClient.getQueryData<SyslabExamItem[]>(listKey),
        admissionDate
      );
      setProgress({ completed: 0, total: current.length });
      const response = await fetchSyslabExamDetails(
        current.map(exam => exam.link as string),
        {
          isCurrent: () => !signal.aborted,
          onProgress: ({ completed, total }) => setProgress({ completed, total }),
        }
      );
      if (!response.success) throw new Error(response.error || 'No se pudieron leer los informes.');
      return {
        analysis: buildAnalysisData(response.data, current),
        pending: response.omittedUrls?.length ?? 0,
      };
    },
  });

  const phase: ClinicalExplorerLabPhase =
    access.state === 'checking'
      ? 'checking'
      : access.state === 'login-required'
        ? 'login-required'
        : access.state === 'unavailable'
          ? 'unavailable'
          : list.isError || analysis.isError
            ? 'error'
            : list.isPending || list.isFetching && !list.data
              ? 'listing'
              : exams.length === 0
                ? 'empty'
                : analysis.data
                  ? 'ready'
                  : 'reading';

  const error = (list.error ?? analysis.error) as Error | null;
  const message =
    phase === 'error'
      ? error?.message || 'No se pudo leer Syslab.'
      : phase === 'unavailable' || phase === 'login-required' || phase === 'checking'
        ? access.message
        : '';

  const retry = (): void => {
    if (access.state !== 'connected') {
      void access.refresh();
      return;
    }
    // A failed read may come from expired links: renew the list first, then read again.
    void list.refetch().then(() => {
      if (analysis.isError) void analysis.refetch();
    });
  };

  return {
    phase,
    access,
    message,
    progress: phase === 'reading' ? progress : null,
    exams,
    analysis: analysis.data?.analysis ?? null,
    pending: analysis.data?.pending ?? 0,
    retry,
  };
};
