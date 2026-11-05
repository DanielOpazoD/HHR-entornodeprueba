import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient as appQueryClient } from '@/config/queryClient';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import {
  SYSLAB_LIST_RETENTION_MS,
  SYSLAB_LIST_REUSE_MS,
} from '@/services/laboratory/syslabLinkPolicy';
import {
  cleanRutForSyslab,
  fetchSyslabExamDetails,
  searchSyslabExams,
} from '@/services/laboratory/syslabService';
import { onSessionChange } from '@/services/storage/sessionStorageTransition';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';
import { buildAnalysisData } from '../controllers/labAnalyticsController';
import { parseDateDDMMYYYY } from '../controllers/labFormattingController';
import { useSyslabAccess, type SyslabAccessModel } from './useSyslabAccess';

export type SyslabHospitalizationPhase =
  | 'checking'
  | 'login-required'
  | 'unavailable'
  | 'listing'
  | 'reading'
  | 'empty'
  | 'ready'
  | 'error';

export interface SyslabHospitalizationReports {
  phase: SyslabHospitalizationPhase;
  access: SyslabAccessModel;
  message: string;
  progress: { completed: number; total: number } | null;
  exams: SyslabExamItem[];
  analysis: LabAnalysisData | null;
  /** Reports Syslab listed but could not deliver yet; they are asked again on the next refresh. */
  pending: number;
  retry: () => void;
}

interface HospitalizationAnalysis {
  analysis: LabAnalysisData;
  pending: number;
}

interface UseSyslabHospitalizationReportsParams {
  rut: string;
  episodeId: string;
  /** ISO day; reports before it belong to an earlier attention and are left out. */
  admissionDate: string;
  enabled: boolean;
}

/** Reports of one hospitalization; under the laboratory namespace of the query cache. */
const HOSPITALIZATION_KEY = ['laboratory', 'hospitalization'] as const;

/** Reports of this hospitalization: with a link, and not before the admission day. */
const filterHospitalizationExams = (
  items: SyslabExamItem[] | undefined,
  admissionDate: string
): SyslabExamItem[] =>
  (items ?? []).filter(
    exam => exam.link && (!admissionDate || parseDateDDMMYYYY(exam.date) >= admissionDate)
  );

// Several people share one computer: a new Eloísa session forgets every hospitalization read,
// whether or not a reader is mounted at that moment; the session epoch keeps old keys from coming
// back.
onSessionChange(() => {
  void appQueryClient.removeQueries({ queryKey: HOSPITALIZATION_KEY });
});

/**
 * Lab reports of one patient's hospitalization: the Syslab list, then every report read once and
 * kept in memory for this tab only. A failed read is a failure, never an empty list (SAVE-01).
 * The census clinical explorer renders this; the laboratory feature owns how Syslab is read.
 */
export const useSyslabHospitalizationReports = ({
  rut,
  episodeId,
  admissionDate,
  enabled,
}: UseSyslabHospitalizationReportsParams): SyslabHospitalizationReports => {
  const access = useSyslabAccess(enabled);
  const queryClient = useQueryClient();
  const rutBody = cleanRutForSyslab(rut);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  // Part of every key: what was on screen leaves with the session that read it.
  const generation = useSessionEpoch();

  const connected = enabled && access.state === 'connected' && rutBody.length > 0;
  const listKey = [...HOSPITALIZATION_KEY, generation, 'exams', rutBody];
  const list = useQuery({
    queryKey: listKey,
    enabled: connected,
    staleTime: SYSLAB_LIST_REUSE_MS,
    gcTime: SYSLAB_LIST_RETENTION_MS,
    retry: false,
    queryFn: async () => {
      const response = await searchSyslabExams(rut);
      if (!response.success) throw new Error(response.error || 'Syslab no respondió.');
      return response.data;
    },
  });

  // Search links expire (see syslabLinkPolicy). A stale list is renewed before any report is asked.
  const listFresh = list.isSuccess && !list.isStale;
  useEffect(() => {
    if (connected && list.isSuccess && list.isStale && !list.isFetching) void list.refetch();
  }, [connected, list]);

  const exams = useMemo(
    () => filterHospitalizationExams(list.data, admissionDate),
    [list.data, admissionDate]
  );
  const examIds = exams.map(exam => exam.id).join(',');

  const analysis = useQuery<HospitalizationAnalysis, Error>({
    queryKey: [...HOSPITALIZATION_KEY, generation, 'analysis', rutBody, episodeId, examIds],
    enabled: listFresh && exams.length > 0,
    // Reports already read do not change; reports Syslab could not deliver are asked again.
    staleTime: query => (query.state.data?.pending ? SYSLAB_LIST_REUSE_MS : Infinity),
    gcTime: SYSLAB_LIST_RETENTION_MS,
    retry: false,
    queryFn: async ({ signal }): Promise<HospitalizationAnalysis> => {
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

  const phase: SyslabHospitalizationPhase =
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
